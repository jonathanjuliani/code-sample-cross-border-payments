import { afterEach, describe, expect, it } from 'vitest';
import { createSimTestContext, runToFinal, type SimTestContext } from './sim-helpers.ts';

describe('reconciliation', () => {
  let ctx: SimTestContext | undefined;

  afterEach(async () => {
    if (ctx) {
      await ctx.close();
      ctx = undefined;
    }
  });

  it('P6: a mismatch between our ledger and a simulator record is listed, not fixed', async () => {
    ctx = await createSimTestContext();
    const { payout } = await runToFinal(ctx, {});
    const ref = `${payout.id}-T1`;
    const before = ctx.sim.records.chain.get(ref);
    expect(before).toBeTruthy();
    if (!before) throw new Error('missing chain record');

    // Tamper the simulator record — reconciliation must report, not rewrite ledger.
    ctx.sim.records.chain.set(ref, {
      ...before,
      amountMinor: (before.amountMinor ?? 0) + 999,
      convertMinor: (before.convertMinor ?? 0) + 999,
    });

    const ledgerBefore = ctx.db
      .prepare(`SELECT COUNT(*) AS n FROM ledger_entries WHERE payout_id = @id`)
      .get({ id: payout.id }) as { n: number };

    const res = await ctx.app.inject({
      method: 'GET',
      url: '/reconciliation',
      headers: ctx.accountHeaders,
    });
    expect(res.statusCode).toBe(200);
    const item = res.json().items.find((i: { payoutId: string }) => i.payoutId === payout.id);
    expect(item).toBeTruthy();
    expect(item.mismatches.length).toBeGreaterThan(0);

    const ledgerAfter = ctx.db
      .prepare(`SELECT COUNT(*) AS n FROM ledger_entries WHERE payout_id = @id`)
      .get({ id: payout.id }) as { n: number };
    expect(ledgerAfter.n).toBe(ledgerBefore.n);
  });
});
