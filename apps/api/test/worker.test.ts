import { afterEach, describe, expect, it } from 'vitest';
import { assertBalanced } from '../src/ledger/balances.ts';
import { startWorker } from '../src/outbox/worker.ts';
import {
  createInstantProvider,
  createTimeoutProvider,
  type ProviderMap,
} from '../src/providers/types.ts';
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

function providers(map?: Partial<ProviderMap>): ProviderMap {
  const instant = createInstantProvider();
  return {
    collect: map?.collect ?? instant,
    transfer: map?.transfer ?? instant,
    deposit: map?.deposit ?? instant,
    refund: map?.refund ?? instant,
  };
}

describe('outbox worker', () => {
  let ctx: TestContext | undefined;

  afterEach(async () => {
    if (ctx) {
      await ctx.close();
      ctx = undefined;
    }
  });

  it('H11: a payout saved before a crash is sent after restart', async () => {
    ctx = await createTestContext();
    const payout = await createPayout(ctx);
    const collect = createInstantProvider();

    const worker1 = startWorker({
      db: ctx.db,
      clock: ctx.clock,
      log: ctx.app.log,
      config: ctx.config,
      providers: providers({ collect }),
    });
    // Crash before tick: stop without sending.
    worker1.stop();

    const worker2 = startWorker({
      db: ctx.db,
      clock: ctx.clock,
      log: ctx.app.log,
      config: ctx.config,
      providers: providers({ collect }),
    });
    await worker2.tickOnce();
    worker2.stop();

    expect(collect.submits).toHaveLength(1);
    expect(collect.submits[0]?.ref).toBe(`${payout.id}-C1`);
    const status = ctx.db
      .prepare(`SELECT status FROM payouts WHERE id = @id`)
      .get({ id: payout.id }) as { status: string };
    expect(status.status).toBe('collecting');
    assertBalanced(ctx.db, payout.id);
  });

  it('H11: a row sent and committed is not sent again after restart', async () => {
    ctx = await createTestContext();
    await createPayout(ctx);
    const collect = createInstantProvider();
    const map = providers({ collect });

    const worker1 = startWorker({
      db: ctx.db,
      clock: ctx.clock,
      log: ctx.app.log,
      config: ctx.config,
      providers: map,
    });
    await worker1.tickOnce();
    worker1.stop();
    expect(collect.submits).toHaveLength(1);

    const worker2 = startWorker({
      db: ctx.db,
      clock: ctx.clock,
      log: ctx.app.log,
      config: ctx.config,
      providers: map,
    });
    await worker2.tickOnce();
    worker2.stop();
    expect(collect.submits).toHaveLength(1);
  });

  it('H5: a timeout sets the leg to checking and queries status, never resubmits first', async () => {
    ctx = await createTestContext(undefined, {
      STATUS_BACKOFF_MS: '1000,2000',
      PROVIDER_WINDOW_MS: '30000',
    });
    const payout = await createPayout(ctx);
    const underlying = createInstantProvider();
    const collect = createTimeoutProvider(underlying);

    const worker = startWorker({
      db: ctx.db,
      clock: ctx.clock,
      log: ctx.app.log,
      config: ctx.config,
      providers: providers({ collect }),
    });
    await worker.tickOnce();

    const leg = ctx.db
      .prepare(`SELECT status FROM payout_legs WHERE payout_id = @id AND leg = 'collect'`)
      .get({ id: payout.id }) as { status: string };
    expect(leg.status).toBe('checking');

    const queries = ctx.db
      .prepare(`SELECT kind, sent_at FROM outbox WHERE payout_id = @id AND kind = 'status.query'`)
      .all({ id: payout.id }) as Array<{ kind: string; sent_at: string | null }>;
    expect(queries.length).toBeGreaterThanOrEqual(1);
    expect(queries.some((q) => q.sent_at === null)).toBe(true);

    // First status query is due after backoff; advance and tick — still no second collect.request.
    ctx.clock.advance(1000);
    await worker.tickOnce();
    const collectRequests = ctx.db
      .prepare(
        `SELECT COUNT(*) AS n FROM outbox WHERE payout_id = @id AND kind = 'collect.request'`,
      )
      .get({ id: payout.id }) as { n: number };
    expect(collectRequests.n).toBe(1);
    worker.stop();
    assertBalanced(ctx.db, payout.id);
  });

  it('P3: not found after the provider window resends with the same provider_ref', async () => {
    ctx = await createTestContext(undefined, {
      STATUS_BACKOFF_MS: '1000',
      PROVIDER_WINDOW_MS: '5000',
      CHECKING_GIVE_UP_MS: '600000',
    });
    const payout = await createPayout(ctx);
    const collect = createTimeoutProvider();

    const worker = startWorker({
      db: ctx.db,
      clock: ctx.clock,
      log: ctx.app.log,
      config: ctx.config,
      providers: providers({ collect }),
    });
    await worker.tickOnce(); // timeout → checking + status.query
    ctx.clock.advance(1000);
    await worker.tickOnce(); // not_found, still inside window → another query
    ctx.clock.advance(5000);
    await worker.tickOnce(); // past window → resend collect.request

    const requests = ctx.db
      .prepare(
        `SELECT payload FROM outbox WHERE payout_id = @id AND kind = 'collect.request' ORDER BY id`,
      )
      .all({ id: payout.id }) as Array<{ payload: string }>;
    expect(requests.length).toBe(2);
    const refs = requests.map(
      (r) => (JSON.parse(r.payload) as { providerRef: string }).providerRef,
    );
    expect(refs[0]).toBe(refs[1]);
    expect(refs[0]).toBe(`${payout.id}-C1`);
    worker.stop();
  });

  it('T4: every submit for a leg uses the same provider_ref', async () => {
    ctx = await createTestContext(undefined, {
      STATUS_BACKOFF_MS: '100',
      PROVIDER_WINDOW_MS: '100',
      CHECKING_GIVE_UP_MS: '600000',
    });
    const payout = await createPayout(ctx);
    const firstAttempt = createInstantProvider();
    const collect = createTimeoutProvider(firstAttempt);
    const worker = startWorker({
      db: ctx.db,
      clock: ctx.clock,
      log: ctx.app.log,
      config: ctx.config,
      providers: providers({ collect }),
    });

    await worker.tickOnce();
    ctx.clock.advance(200);
    await worker.tickOnce(); // resend after window
    const accepting = createInstantProvider();
    const worker2 = startWorker({
      db: ctx.db,
      clock: ctx.clock,
      log: ctx.app.log,
      config: ctx.config,
      providers: providers({ collect: accepting }),
    });
    await worker2.tickOnce();
    worker.stop();
    worker2.stop();

    const allRefs = [
      ...firstAttempt.submits.map((s) => s.ref),
      ...accepting.submits.map((s) => s.ref),
    ];
    expect(allRefs.length).toBeGreaterThanOrEqual(2);
    expect(new Set(allRefs)).toEqual(new Set([`${payout.id}-C1`]));
  });
});
