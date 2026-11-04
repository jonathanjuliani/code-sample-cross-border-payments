import { afterEach, describe, expect, it } from 'vitest';
import { accountBalance, assertBalanced } from '../src/ledger/balances.ts';
import { startWorker } from '../src/outbox/worker.ts';
import { NETWORK_FEE_ACTUAL_MINOR } from '../src/providers/sim/chain.ts';
import { consumeCrashAfterCommit, setFlags } from '../src/providers/sim/index.ts';
import { HOP_NORMAL_MS } from '../src/providers/sim/timing.ts';
import { createQuote, newIdempotencyKey } from './helpers.ts';
import { createSimTestContext, pumpOnce, runToFinal, type SimTestContext } from './sim-helpers.ts';

const FINAL = new Set(['delivered', 'failed', 'refunded']);

async function driveToFinal(ctx: SimTestContext, payoutId: string): Promise<string> {
  for (let i = 0; i < 800; i++) {
    await pumpOnce(ctx);
    const st = ctx.db
      .prepare(`SELECT status FROM payouts WHERE id = @id`)
      .get({ id: payoutId }) as {
      status: string;
    };
    if (FINAL.has(st.status)) return st.status;
    const now = ctx.clock.now().getTime();
    const nextSim = ctx.queued?.nextDueAt();
    if (nextSim != null && nextSim > now) {
      ctx.clock.advance(nextSim - now);
    } else if (ctx.queued && ctx.queued.pendingCount() > 0) {
      ctx.clock.advance(100);
    } else {
      ctx.clock.advance(50);
    }
  }
  throw new Error(`driveToFinal timed out for ${payoutId}`);
}

describe.each([['sim'], ['alt']] as const)('simulator scenarios (chain=%s)', (chain) => {
  let ctx: SimTestContext | undefined;

  function env(extra: Record<string, string> = {}) {
    return { CHAIN_PROVIDER: chain, ...extra };
  }

  afterEach(async () => {
    if (ctx) {
      await ctx.close();
      ctx = undefined;
    }
  });

  it('happy path ends delivered', async () => {
    ctx = await createSimTestContext(env());
    const { payout } = await runToFinal(ctx, {});
    expect(payout.status).toBe('delivered');
    assertBalanced(ctx.db, payout.id as string);
    const transfer = ctx.db
      .prepare(`SELECT tx_hash FROM payout_legs WHERE payout_id = @id AND leg = 'transfer'`)
      .get({ id: payout.id }) as { tx_hash: string };
    expect(transfer.tx_hash.startsWith(`0x${chain}_`)).toBe(true);
    expect(ctx.sim.chainProvider).toBe(chain);
  });

  it('slow: ends delivered, and the hop shows as slow on the way', async () => {
    ctx = await createSimTestContext(env(), { queued: true });
    setFlags({ slow: true });

    const quote = await createQuote(ctx, { mode: 'receive', amountMinor: 4_280_000 });
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/payouts',
      headers: { ...ctx.accountHeaders, 'idempotency-key': newIdempotencyKey() },
      payload: { quoteId: quote.json().id },
    });
    const payoutId = created.json().id as string;

    await ctx.worker.tickOnce();
    // Parked on collect delay (slow ×4). Cross the 3× threshold before releasing.
    ctx.clock.advance(HOP_NORMAL_MS.collect * 3 + 1);
    const mid = await ctx.app.inject({
      method: 'GET',
      url: `/payouts/${payoutId}`,
      headers: ctx.accountHeaders,
    });
    expect(mid.statusCode).toBe(200);
    const collectLeg = mid.json().legs.find((l: { leg: string }) => l.leg === 'collect');
    expect(collectLeg.slow).toBe(true);

    // Finish under the eager scheduler so the rest of the hops don't need manual pumping.
    const { createEagerSimScheduler, setSimScheduler } = await import(
      '../src/providers/sim/index.ts'
    );
    setSimScheduler(createEagerSimScheduler(ctx.clock));
    ctx.queued?.clear();
    ctx.queued = null;
    setFlags({ slow: true });

    const status = await driveToFinal(ctx, payoutId);
    expect(status).toBe('delivered');
    assertBalanced(ctx.db, payoutId);
  });

  it('H4: hop 1 declines, ends failed, nothing in the ledger', async () => {
    ctx = await createSimTestContext(env());
    const { payout } = await runToFinal(ctx, { 'collect.decline': true });
    expect(payout.status).toBe('failed');
    const n = ctx.db
      .prepare(`SELECT COUNT(*) AS n FROM ledger_entries WHERE payout_id = @id`)
      .get({ id: payout.id }) as { n: number };
    expect(n.n).toBe(0);
  });

  it("H5: hop 2 times out but happened, ends delivered with one transfer in the chain's record", async () => {
    ctx = await createSimTestContext(
      env({
        STATUS_BACKOFF_MS: '10,10,10,10',
        PROVIDER_WINDOW_MS: '1000',
      }),
    );
    const { payout } = await runToFinal(ctx, { 'transfer.timeout': true });
    expect(payout.status).toBe('delivered');
    const rec = ctx.sim.records.chain.get(`${payout.id}-T1`);
    expect(rec?.status).toBe('final');
    expect(
      [...ctx.sim.records.chain.keys()].filter((k) => k.startsWith(payout.id as string)),
    ).toHaveLength(1);
  });

  it("P3: hop 2 times out and didn't happen, resent with the same ref, ends delivered", async () => {
    ctx = await createSimTestContext(
      env({
        STATUS_BACKOFF_MS: '10,10,10,10',
        PROVIDER_WINDOW_MS: '50',
      }),
    );
    const { payout } = await runToFinal(ctx, { 'transfer.timeoutLost': true });
    expect(payout.status).toBe('delivered');
    const transfer = ctx.db
      .prepare(
        `SELECT attempt, provider_ref FROM payout_legs WHERE payout_id = @id AND leg = 'transfer'`,
      )
      .get({ id: payout.id }) as { attempt: number; provider_ref: string };
    expect(transfer.provider_ref).toBe(`${payout.id}-T1`);
    expect(transfer.attempt).toBeGreaterThanOrEqual(2);
  });

  it('P4: reorg at 2 of 3, resubmitted with the same ref, deposit requested only after final', async () => {
    ctx = await createSimTestContext(env());
    const { payout } = await runToFinal(ctx, { 'transfer.reorg': true });
    expect(payout.status).toBe('delivered');
    const transfer = ctx.db
      .prepare(`SELECT attempt, status FROM payout_legs WHERE payout_id = @id AND leg = 'transfer'`)
      .get({ id: payout.id }) as { attempt: number; status: string };
    expect(transfer.status).toBe('final');
    expect(transfer.attempt).toBeGreaterThanOrEqual(2);
    const deposits = ctx.db
      .prepare(
        `SELECT COUNT(*) AS n FROM outbox WHERE payout_id = @id AND kind = 'deposit.request'`,
      )
      .get({ id: payout.id }) as { n: number };
    expect(deposits.n).toBe(1);
  });

  it('H6: hop 3 rejects the bank details, ends refunded, sender_bank back to zero, fee included', async () => {
    ctx = await createSimTestContext(env());
    const { payout } = await runToFinal(ctx, { 'deposit.rejectBank': true });
    expect(payout.status).toBe('refunded');
    expect(accountBalance(ctx.db, payout.id as string, 'sender_bank', 'USD')).toBe(0);
    expect(accountBalance(ctx.db, payout.id as string, 'treasury_wallet', 'DUSD')).toBe(0);
    expect(accountBalance(ctx.db, payout.id as string, 'recipient_bank', 'MXN')).toBe(0);
  });

  it('H7: duplicate webhook is ignored', async () => {
    ctx = await createSimTestContext(env());
    const { payout } = await runToFinal(ctx, { 'webhook.duplicate': true });
    expect(payout.status).toBe('delivered');
    const dupes = ctx.db
      .prepare(`SELECT COUNT(*) AS n FROM ops_events WHERE message LIKE 'ignored duplicate%'`)
      .get() as { n: number };
    expect(dupes.n).toBeGreaterThanOrEqual(1);
  });

  it('H8: out-of-order deposit events end delivered', async () => {
    ctx = await createSimTestContext(env());
    const { payout } = await runToFinal(ctx, { 'webhook.outOfOrder': true });
    expect(payout.status).toBe('delivered');
  });

  it('H10 P1: rate moved 2%, recipient gets the quoted pesos, fx_variance holds the difference', async () => {
    ctx = await createSimTestContext(env());
    const { payout } = await runToFinal(ctx, { 'rate.move': true });
    expect(payout.status).toBe('delivered');
    expect(accountBalance(ctx.db, payout.id as string, 'recipient_bank', 'MXN')).toBe(
      payout.receiveMinor as number,
    );
    expect(accountBalance(ctx.db, payout.id as string, 'fx_variance', 'MXN')).toBeLessThan(0);
  });

  it("P2: network fee differs, posted to network_fee_expense, sender's numbers unchanged", async () => {
    ctx = await createSimTestContext(env());
    const { payout } = await runToFinal(ctx, {});
    expect(payout.status).toBe('delivered');
    expect(accountBalance(ctx.db, payout.id as string, 'network_fee_expense', 'USD')).toBe(
      NETWORK_FEE_ACTUAL_MINOR,
    );
  });

  it('H11: crash after commit, restart sends hop 1 once', async () => {
    ctx = await createSimTestContext(env());
    setFlags({ 'crash.afterCommit': true });

    const quote = await createQuote(ctx, { mode: 'receive', amountMinor: 4_280_000 });
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/payouts',
      headers: { ...ctx.accountHeaders, 'idempotency-key': newIdempotencyKey() },
      payload: { quoteId: quote.json().id },
    });
    expect(created.statusCode).toBe(201);
    expect(consumeCrashAfterCommit()).toBe(true);
    ctx.worker.stop();
    expect(ctx.sim.records.collect.size).toBe(0);

    ctx.worker = startWorker({
      db: ctx.db,
      clock: ctx.clock,
      log: ctx.app.log,
      config: ctx.config,
      providers: ctx.sim.providers,
    });
    setFlags({});

    const payoutId = created.json().id as string;
    const status = await driveToFinal(ctx, payoutId);
    expect(status).toBe('delivered');
    assertBalanced(ctx.db, payoutId);
  });

  it('S2: reads fail with 503 while client.readsFail is on', async () => {
    ctx = await createSimTestContext(env());
    setFlags({ 'client.readsFail': true });
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/payouts',
      headers: ctx.accountHeaders,
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('simulated_outage');
  });
});
