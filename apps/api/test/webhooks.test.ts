import { afterEach, describe, expect, it } from 'vitest';
import { accountBalance, assertBalanced } from '../src/ledger/balances.ts';
import { startWorker } from '../src/outbox/worker.ts';
import { createInstantProvider } from '../src/providers/types.ts';
import { createQuote, createTestContext, newIdempotencyKey, type TestContext } from './helpers.ts';

async function createPayout(ctx: TestContext) {
  const quote = await createQuote(ctx, { mode: 'receive', amountMinor: 4_280_000 });
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/payouts',
    headers: { ...ctx.accountHeaders, 'idempotency-key': newIdempotencyKey() },
    payload: { quoteId: quote.json().id },
  });
  expect(res.statusCode).toBe(201);
  return res.json();
}

async function sendCollect(ctx: TestContext, payoutId: string) {
  const collect = createInstantProvider();
  const worker = startWorker({
    db: ctx.db,
    clock: ctx.clock,
    log: ctx.app.log,
    config: ctx.config,
    providers: {
      collect,
      transfer: createInstantProvider(),
      deposit: createInstantProvider(),
      refund: createInstantProvider(),
    },
  });
  await worker.tickOnce();
  worker.stop();
  return `${payoutId}-C1`;
}

async function webhook(ctx: TestContext, provider: string, body: Record<string, unknown>) {
  return ctx.app.inject({
    method: 'POST',
    url: `/webhooks/${provider}`,
    payload: body,
  });
}

describe('webhooks', () => {
  let ctx: TestContext | undefined;

  afterEach(async () => {
    if (ctx) {
      await ctx.close();
      ctx = undefined;
    }
  });

  it('H7: the same event twice changes nothing the second time', async () => {
    ctx = await createTestContext();
    const payout = await createPayout(ctx);
    const ref = await sendCollect(ctx, payout.id);

    const event = {
      eventId: 'evt_dupetest0001',
      providerRef: ref,
      leg: 'collect',
      status: 'succeeded',
      seq: 1,
    };
    const first = await webhook(ctx, 'collect', event);
    expect(first.statusCode).toBe(200);

    const legs1 = ctx.db
      .prepare(`SELECT status, last_seq FROM payout_legs WHERE payout_id = @id AND leg = 'collect'`)
      .get({ id: payout.id });
    const ledger1 = ctx.db
      .prepare(`SELECT COUNT(*) AS n FROM ledger_entries WHERE payout_id = @id`)
      .get({ id: payout.id }) as { n: number };
    const status1 = ctx.db
      .prepare(`SELECT status FROM payouts WHERE id = @id`)
      .get({ id: payout.id });

    const second = await webhook(ctx, 'collect', event);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ ok: true, ignored: 'duplicate' });

    const legs2 = ctx.db
      .prepare(`SELECT status, last_seq FROM payout_legs WHERE payout_id = @id AND leg = 'collect'`)
      .get({ id: payout.id });
    const ledger2 = ctx.db
      .prepare(`SELECT COUNT(*) AS n FROM ledger_entries WHERE payout_id = @id`)
      .get({ id: payout.id }) as { n: number };
    const status2 = ctx.db
      .prepare(`SELECT status FROM payouts WHERE id = @id`)
      .get({ id: payout.id });

    expect(legs2).toEqual(legs1);
    expect(ledger2.n).toBe(ledger1.n);
    expect(status2).toEqual(status1);
    assertBalanced(ctx.db, payout.id);
  });

  it('H8: a newer event before an older one applies the newer and ignores the older', async () => {
    ctx = await createTestContext();
    const payout = await createPayout(ctx);
    const ref = await sendCollect(ctx, payout.id);

    const newer = await webhook(ctx, 'collect', {
      eventId: 'evt_newer0000001',
      providerRef: ref,
      leg: 'collect',
      status: 'succeeded',
      seq: 2,
    });
    expect(newer.statusCode).toBe(200);

    const older = await webhook(ctx, 'collect', {
      eventId: 'evt_older0000001',
      providerRef: ref,
      leg: 'collect',
      status: 'processing',
      seq: 1,
    });
    expect(older.json()).toMatchObject({ ignored: 'stale' });

    const leg = ctx.db
      .prepare(`SELECT status, last_seq FROM payout_legs WHERE payout_id = @id AND leg = 'collect'`)
      .get({ id: payout.id }) as { status: string; last_seq: number };
    expect(leg.status).toBe('succeeded');
    expect(leg.last_seq).toBe(2);
    assertBalanced(ctx.db, payout.id);
  });

  it('H8: a payout never moves backwards', async () => {
    ctx = await createTestContext();
    const payout = await createPayout(ctx);
    const ref = await sendCollect(ctx, payout.id);
    await webhook(ctx, 'collect', {
      eventId: 'evt_succ00000001',
      providerRef: ref,
      leg: 'collect',
      status: 'succeeded',
      seq: 1,
    });
    const status = ctx.db
      .prepare(`SELECT status FROM payouts WHERE id = @id`)
      .get({ id: payout.id }) as { status: string };
    expect(status.status).toBe('transferring');

    const declined = await webhook(ctx, 'collect', {
      eventId: 'evt_decl00000001',
      providerRef: ref,
      leg: 'collect',
      status: 'declined',
      seq: 2,
    });
    // Machine refuses collecting→failed from transferring; apply throws IllegalTransition → 400
    expect(declined.statusCode).toBe(400);
    const after = ctx.db
      .prepare(`SELECT status FROM payouts WHERE id = @id`)
      .get({ id: payout.id }) as { status: string };
    expect(after.status).toBe('transferring');
    assertBalanced(ctx.db, payout.id);
  });

  it("T5: an event can't set a payout status the machine doesn't allow", async () => {
    ctx = await createTestContext();
    const payout = await createPayout(ctx);
    const ref = await sendCollect(ctx, payout.id);
    await webhook(ctx, 'collect', {
      eventId: 'evt_t5succ000001',
      providerRef: ref,
      leg: 'collect',
      status: 'succeeded',
      seq: 1,
    });

    // Deposit succeeded while still transferring — illegal.
    const bad = await webhook(ctx, 'offramp', {
      eventId: 'evt_t5bad0000001',
      providerRef: `${payout.id}-D1`,
      leg: 'deposit',
      status: 'succeeded',
      seq: 1,
    });
    expect(bad.statusCode).toBe(400);
    const status = ctx.db
      .prepare(`SELECT status FROM payouts WHERE id = @id`)
      .get({ id: payout.id }) as { status: string };
    expect(status.status).toBe('transferring');
  });

  it('hop 3 is not requested before hop 2 is final', async () => {
    ctx = await createTestContext();
    const payout = await createPayout(ctx);
    const ref = await sendCollect(ctx, payout.id);
    await webhook(ctx, 'collect', {
      eventId: 'evt_hop3c0000001',
      providerRef: ref,
      leg: 'collect',
      status: 'succeeded',
      seq: 1,
    });

    const depositBefore = ctx.db
      .prepare(
        `SELECT COUNT(*) AS n FROM outbox WHERE payout_id = @id AND kind = 'deposit.request'`,
      )
      .get({ id: payout.id }) as { n: number };
    expect(depositBefore.n).toBe(0);

    const transfer = createInstantProvider();
    const worker = startWorker({
      db: ctx.db,
      clock: ctx.clock,
      log: ctx.app.log,
      config: ctx.config,
      providers: {
        collect: createInstantProvider(),
        transfer,
        deposit: createInstantProvider(),
        refund: createInstantProvider(),
      },
    });
    await worker.tickOnce();
    worker.stop();

    await webhook(ctx, 'chain', {
      eventId: 'evt_hop3t0000001',
      providerRef: `${payout.id}-T1`,
      leg: 'transfer',
      status: 'confirming',
      seq: 2,
      detail: { confirmations: 1 },
    });
    const still = ctx.db
      .prepare(
        `SELECT COUNT(*) AS n FROM outbox WHERE payout_id = @id AND kind = 'deposit.request'`,
      )
      .get({ id: payout.id }) as { n: number };
    expect(still.n).toBe(0);

    await webhook(ctx, 'chain', {
      eventId: 'evt_hop3f0000001',
      providerRef: `${payout.id}-T1`,
      leg: 'transfer',
      status: 'final',
      seq: 4,
      detail: { confirmations: 3 },
    });
    const afterFinal = ctx.db
      .prepare(
        `SELECT COUNT(*) AS n FROM outbox WHERE payout_id = @id AND kind = 'deposit.request'`,
      )
      .get({ id: payout.id }) as { n: number };
    expect(afterFinal.n).toBe(1);
    assertBalanced(ctx.db, payout.id);
  });

  it('happy path: collect, three confirmations, deposit end in delivered with a balanced ledger', async () => {
    ctx = await createTestContext();
    const payout = await createPayout(ctx);
    const instant = createInstantProvider();
    const worker = startWorker({
      db: ctx.db,
      clock: ctx.clock,
      log: ctx.app.log,
      config: ctx.config,
      providers: {
        collect: instant,
        transfer: instant,
        deposit: instant,
        refund: instant,
      },
    });

    await worker.tickOnce(); // collect.request
    await webhook(ctx, 'collect', {
      eventId: 'evt_hp_c_succ0001',
      providerRef: `${payout.id}-C1`,
      leg: 'collect',
      status: 'succeeded',
      seq: 1,
    });

    await worker.tickOnce(); // transfer.request
    await webhook(ctx, 'chain', {
      eventId: 'evt_hp_t_sub00001',
      providerRef: `${payout.id}-T1`,
      leg: 'transfer',
      status: 'submitted',
      seq: 1,
      detail: { txHash: '0xabc' },
    });
    await webhook(ctx, 'chain', {
      eventId: 'evt_hp_t_c100001',
      providerRef: `${payout.id}-T1`,
      leg: 'transfer',
      status: 'confirming',
      seq: 2,
      detail: { confirmations: 1 },
    });
    await webhook(ctx, 'chain', {
      eventId: 'evt_hp_t_c200001',
      providerRef: `${payout.id}-T1`,
      leg: 'transfer',
      status: 'confirming',
      seq: 3,
      detail: { confirmations: 2 },
    });
    await webhook(ctx, 'chain', {
      eventId: 'evt_hp_t_fin00001',
      providerRef: `${payout.id}-T1`,
      leg: 'transfer',
      status: 'final',
      seq: 4,
      detail: { confirmations: 3 },
    });

    await worker.tickOnce(); // deposit.request
    await webhook(ctx, 'offramp', {
      eventId: 'evt_hp_d_succ0001',
      providerRef: `${payout.id}-D1`,
      leg: 'deposit',
      status: 'succeeded',
      seq: 1,
    });

    worker.stop();

    const status = ctx.db
      .prepare(`SELECT status FROM payouts WHERE id = @id`)
      .get({ id: payout.id }) as { status: string };
    expect(status.status).toBe('delivered');
    assertBalanced(ctx.db, payout.id);
    expect(accountBalance(ctx.db, payout.id, 'recipient_bank', 'MXN')).toBe(payout.receiveMinor);
  });
});
