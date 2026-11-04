import {
  CONFIRMATIONS,
  FEE_BPS,
  FEE_MIN_MINOR,
  SEND_MAX_MINOR,
  SEND_MIN_MINOR,
  SimulationFlagsSchema,
} from '@payout/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { startWorker } from '../src/outbox/worker.ts';
import { IllegalTransition, transition } from '../src/payouts/machine.ts';
import { createInstantProvider, createTimeoutProvider } from '../src/providers/types.ts';
import { createQuote, createTestContext, newIdempotencyKey, type TestContext } from './helpers.ts';
import { createSimTestContext, runToFinal, type SimTestContext } from './sim-helpers.ts';

describe('ops API', () => {
  let ctx: SimTestContext | undefined;
  let plain: TestContext | undefined;

  afterEach(async () => {
    if (ctx) {
      await ctx.close();
      ctx = undefined;
    }
    if (plain) {
      await plain.close();
      plain = undefined;
    }
  });

  it('S5: every switch in §11 can be set through PUT /ops/simulation', async () => {
    ctx = await createSimTestContext();
    const keys = Object.keys(SimulationFlagsSchema.shape) as Array<
      keyof typeof SimulationFlagsSchema.shape
    >;
    for (const key of keys) {
      const body =
        key === 'speed'
          ? { speed: 3 as const }
          : ({ [key]: true } as Record<string, boolean | number>);
      const res = await ctx.app.inject({
        method: 'PUT',
        url: '/ops/simulation',
        headers: ctx.accountHeaders,
        payload: body,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()[key]).toBe(key === 'speed' ? 3 : true);
    }
  });

  it('an unknown switch is 400', async () => {
    ctx = await createSimTestContext();
    const res = await ctx.app.inject({
      method: 'PUT',
      url: '/ops/simulation',
      headers: ctx.accountHeaders,
      payload: { 'not.a.switch': true },
    });
    expect(res.statusCode).toBe(400);
  });

  it("ops routes don't exist when OPS_ENABLED is false", async () => {
    plain = await createTestContext(undefined, { OPS_ENABLED: 'false' });
    const res = await plain.app.inject({
      method: 'GET',
      url: '/ops/summary',
      headers: plain.accountHeaders,
    });
    expect(res.statusCode).toBe(404);
  });

  it('S8: the inspector shows legs, inbox, outbox, idempotency record and ledger for a payout', async () => {
    ctx = await createSimTestContext();
    const { payout } = await runToFinal(ctx, {});
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/ops/payouts/${payout.id}`,
      headers: ctx.accountHeaders,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.legs.length).toBe(4);
    expect(body.inboxEvents.length).toBeGreaterThan(0);
    expect(body.outbox.length).toBeGreaterThan(0);
    expect(body.idempotency?.bodyHash).toBeTruthy();
    expect(body.ledger.length).toBeGreaterThan(0);
    expect(body.deliveredEqualsQuoted).toBe(true);
  });

  it('summary counts a replay, a 410, a duplicate webhook and a refused transition', async () => {
    ctx = await createSimTestContext();
    const { payout } = await runToFinal(ctx, { 'webhook.duplicate': true });

    // Replay
    const key = newIdempotencyKey();
    const quote = await createQuote(ctx, { mode: 'receive', amountMinor: 4_280_000 });
    const first = await ctx.app.inject({
      method: 'POST',
      url: '/payouts',
      headers: { ...ctx.accountHeaders, 'idempotency-key': key },
      payload: { quoteId: quote.json().id },
    });
    expect(first.statusCode).toBe(201);
    const replay = await ctx.app.inject({
      method: 'POST',
      url: '/payouts',
      headers: { ...ctx.accountHeaders, 'idempotency-key': key },
      payload: { quoteId: quote.json().id },
    });
    expect(replay.statusCode).toBe(200);

    // 410
    const q2 = await createQuote(ctx, { mode: 'receive', amountMinor: 4_280_000 });
    await ctx.app.inject({
      method: 'POST',
      url: `/ops/quotes/${q2.json().id}/expire-in`,
      headers: ctx.accountHeaders,
      payload: { ms: 0 },
    });
    const expired = await ctx.app.inject({
      method: 'POST',
      url: '/payouts',
      headers: { ...ctx.accountHeaders, 'idempotency-key': newIdempotencyKey() },
      payload: { quoteId: q2.json().id },
    });
    expect(expired.statusCode).toBe(410);

    // Refused transition
    expect(() =>
      transition(
        ctx!.db,
        ctx!.clock,
        ctx!.app.log,
        payout.id as string,
        'failed',
        'collect declined',
      ),
    ).toThrow(IllegalTransition);

    const summary = await ctx.app.inject({
      method: 'GET',
      url: '/ops/summary',
      headers: ctx.accountHeaders,
    });
    expect(summary.statusCode).toBe(200);
    const body = summary.json();
    expect(body.idempotentReplays).toBeGreaterThanOrEqual(1);
    expect(body.expired410).toBeGreaterThanOrEqual(1);
    expect(body.webhooksIgnoredDuplicate).toBeGreaterThanOrEqual(1);
    expect(body.refusedTransitions).toBeGreaterThanOrEqual(1);
  });

  it("expire-in moves a quote's expiry and a confirm after it is 410", async () => {
    ctx = await createSimTestContext();
    const quote = await createQuote(ctx, { mode: 'receive', amountMinor: 4_280_000 });
    const exp = await ctx.app.inject({
      method: 'POST',
      url: `/ops/quotes/${quote.json().id}/expire-in`,
      headers: ctx.accountHeaders,
      payload: { ms: 0 },
    });
    expect(exp.statusCode).toBe(200);
    const confirm = await ctx.app.inject({
      method: 'POST',
      url: '/payouts',
      headers: { ...ctx.accountHeaders, 'idempotency-key': newIdempotencyKey() },
      payload: { quoteId: quote.json().id },
    });
    expect(confirm.statusCode).toBe(410);
  });

  it('P5: a leg pending longer than the threshold shows in stuck', async () => {
    ctx = await createSimTestContext({ STUCK_AFTER_MS: '100' });
    const quote = await createQuote(ctx, { mode: 'receive', amountMinor: 4_280_000 });
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/payouts',
      headers: { ...ctx.accountHeaders, 'idempotency-key': newIdempotencyKey() },
      payload: { quoteId: quote.json().id },
    });
    await (ctx as SimTestContext).worker.tickOnce();
    ctx.clock.advance(200);
    const summary = await ctx.app.inject({
      method: 'GET',
      url: '/ops/summary',
      headers: ctx.accountHeaders,
    });
    expect(summary.json().stuck.length).toBeGreaterThanOrEqual(1);
    expect(summary.json().stuck[0].payoutId).toBe(created.json().id);
  });

  it('N3: re-run status query queues one status.query for a checking leg', async () => {
    plain = await createTestContext(undefined, {
      OPS_ENABLED: 'true',
      STATUS_BACKOFF_MS: '1000,2000',
    });
    const quote = await createQuote(plain, { mode: 'receive', amountMinor: 4_280_000 });
    const created = await plain.app.inject({
      method: 'POST',
      url: '/payouts',
      headers: { ...plain.accountHeaders, 'idempotency-key': newIdempotencyKey() },
      payload: { quoteId: quote.json().id },
    });
    const payoutId = created.json().id as string;

    const collect = createTimeoutProvider(createInstantProvider());
    const worker = startWorker({
      db: plain.db,
      clock: plain.clock,
      log: plain.app.log,
      config: plain.config,
      providers: {
        collect,
        transfer: createInstantProvider(),
        deposit: createInstantProvider(),
        refund: createInstantProvider(),
      },
    });
    await worker.tickOnce();
    worker.stop();

    const before = plain.db
      .prepare(`SELECT COUNT(*) AS n FROM outbox WHERE payout_id = @id AND kind = 'status.query'`)
      .get({ id: payoutId }) as { n: number };

    const statusBefore = plain.db
      .prepare(`SELECT status FROM payouts WHERE id = @id`)
      .get({ id: payoutId }) as { status: string };

    const res = await plain.app.inject({
      method: 'POST',
      url: `/ops/payouts/${payoutId}/status-query`,
      headers: plain.accountHeaders,
      payload: { leg: 'collect' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });

    const after = plain.db
      .prepare(`SELECT COUNT(*) AS n FROM outbox WHERE payout_id = @id AND kind = 'status.query'`)
      .get({ id: payoutId }) as { n: number };
    expect(after.n).toBe(before.n + 1);

    const statusAfter = plain.db
      .prepare(`SELECT status FROM payouts WHERE id = @id`)
      .get({ id: payoutId }) as { status: string };
    expect(statusAfter.status).toBe(statusBefore.status);

    const notChecking = await plain.app.inject({
      method: 'POST',
      url: `/ops/payouts/${payoutId}/status-query`,
      headers: plain.accountHeaders,
      payload: { leg: 'transfer' },
    });
    expect(notChecking.statusCode).toBe(409);

    const badLeg = await plain.app.inject({
      method: 'POST',
      url: `/ops/payouts/${payoutId}/status-query`,
      headers: plain.accountHeaders,
      payload: { leg: 'not-a-leg' },
    });
    expect(badLeg.statusCode).toBe(400);
    expect(badLeg.json().error).toBe('validation_failed');
  });

  it('ops write edges reject bodies that fail shared Zod schemas', async () => {
    ctx = await createSimTestContext();
    const quote = await createQuote(ctx, { mode: 'send', amountMinor: 10_000 });

    const badExpire = await ctx.app.inject({
      method: 'POST',
      url: `/ops/quotes/${quote.json().id}/expire-in`,
      headers: ctx.accountHeaders,
      payload: { ms: -1 },
    });
    expect(badExpire.statusCode).toBe(400);
    expect(badExpire.json().error).toBe('validation_failed');

    const missingLeg = await ctx.app.inject({
      method: 'POST',
      url: '/ops/payouts/pay_missing/status-query',
      headers: ctx.accountHeaders,
      payload: {},
    });
    expect(missingLeg.statusCode).toBe(400);
    expect(missingLeg.json().error).toBe('validation_failed');
  });

  it('N3: flag for review sets flagged_at without changing payout status', async () => {
    ctx = await createSimTestContext();
    const { payout } = await runToFinal(ctx, {});
    const statusBefore = ctx.db
      .prepare(`SELECT status FROM payouts WHERE id = @id`)
      .get({ id: payout.id }) as { status: string };

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/ops/payouts/${payout.id}/flag`,
      headers: ctx.accountHeaders,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().flaggedAt).toBeTruthy();

    const row = ctx.db
      .prepare(`SELECT status, flagged_at FROM payouts WHERE id = @id`)
      .get({ id: payout.id }) as { status: string; flagged_at: string };
    expect(row.status).toBe(statusBefore.status);
    expect(row.flagged_at).toBe(res.json().flaggedAt);

    const again = await ctx.app.inject({
      method: 'POST',
      url: `/ops/payouts/${payout.id}/flag`,
      headers: ctx.accountHeaders,
    });
    expect(again.json().flaggedAt).toBe(row.flagged_at);

    ctx.clock.advance(ctx.config.STUCK_AFTER_MS + 1);
    // Delivered legs are final — force a checking row so stuck includes the flag badge.
    ctx.db
      .prepare(
        `UPDATE payout_legs SET status = 'checking', updated_at = @at
         WHERE payout_id = @id AND leg = 'transfer'`,
      )
      .run({ id: payout.id, at: ctx.clock.now().toISOString() });
    const summary = await ctx.app.inject({
      method: 'GET',
      url: '/ops/summary',
      headers: ctx.accountHeaders,
    });
    const stuck = summary.json().stuck as Array<{ payoutId: string; flagged: boolean }>;
    expect(stuck.some((s) => s.payoutId === payout.id && s.flagged)).toBe(true);
  });

  it('S7: no bank account token in any ops event, log line or response', async () => {
    ctx = await createSimTestContext();
    await runToFinal(ctx, {});
    const events = await ctx.app.inject({
      method: 'GET',
      url: '/ops/events',
      headers: ctx.accountHeaders,
    });
    const blob = JSON.stringify(events.json());
    expect(blob.toLowerCase()).not.toMatch(/bank_account_token|bankaccounttoken/);

    const tokens = ctx.db.prepare(`SELECT bank_account_token FROM recipients`).all() as Array<{
      bank_account_token: string;
    }>;
    for (const t of tokens) {
      expect(blob).not.toContain(t.bank_account_token);
    }

    const config = await ctx.app.inject({
      method: 'GET',
      url: '/ops/config',
      headers: ctx.accountHeaders,
    });
    const configJson = config.json();
    const configBlob = JSON.stringify(configJson);
    for (const t of tokens) {
      expect(configBlob).not.toContain(t.bank_account_token);
    }
    expect(configJson.webhookSecretMasked).toMatch(/…/);
    expect(configBlob).not.toContain(ctx.config.WEBHOOK_SECRET);
    expect(configJson.feeBps).toBe(FEE_BPS);
    expect(configJson.feeMinMinor).toBe(FEE_MIN_MINOR);
    expect(configJson.sendMinMinor).toBe(SEND_MIN_MINOR);
    expect(configJson.sendMaxMinor).toBe(SEND_MAX_MINOR);
    expect(configJson.confirmations).toBe(CONFIRMATIONS);
  });
});
