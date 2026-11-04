import type { PayoutStatus } from '@payout/shared';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FINAL_STATUSES,
  IllegalTransition,
  TRANSITIONS,
  transition,
} from '../src/payouts/machine.ts';
import { createQuote, createTestContext, newIdempotencyKey, type TestContext } from './helpers.ts';

const ALL_STATUSES: PayoutStatus[] = [
  'created',
  'collecting',
  'transferring',
  'paying_out',
  'delivered',
  'failed',
  'refunding',
  'refunded',
];

async function seedPayout(ctx: TestContext): Promise<string> {
  const quoteRes = await createQuote(ctx, { mode: 'receive', amountMinor: 4_280_000 });
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/payouts',
    headers: {
      ...ctx.accountHeaders,
      'idempotency-key': newIdempotencyKey(),
    },
    payload: { quoteId: quoteRes.json().id },
  });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

function setStatus(ctx: TestContext, payoutId: string, status: PayoutStatus): void {
  ctx.db
    .prepare(`UPDATE payouts SET status = @status, finished_at = NULL WHERE id = @id`)
    .run({ id: payoutId, status });
}

describe('payouts/machine', () => {
  let ctx: TestContext | undefined;

  afterEach(async () => {
    if (ctx) {
      await ctx.close();
      ctx = undefined;
    }
  });

  it('every allowed transition in the table succeeds', async () => {
    ctx = await createTestContext();
    const payoutId = await seedPayout(ctx);

    for (const rule of TRANSITIONS) {
      setStatus(ctx, payoutId, rule.from);
      const row = transition(ctx.db, ctx.clock, ctx.app.log, payoutId, rule.to, rule.trigger);
      expect(row.status).toBe(rule.to);
      if (FINAL_STATUSES.has(rule.to)) {
        expect(row.finished_at).toBeTruthy();
      } else {
        expect(row.finished_at).toBeNull();
      }
    }
  });

  it('refuses delivered → collecting and records it', async () => {
    ctx = await createTestContext();
    const payoutId = await seedPayout(ctx);
    setStatus(ctx, payoutId, 'delivered');

    expect(() =>
      transition(ctx!.db, ctx!.clock, ctx!.app.log, payoutId, 'collecting', 'collect.request sent'),
    ).toThrow(IllegalTransition);

    const event = ctx.db
      .prepare(
        `SELECT level, data FROM ops_events
         WHERE payout_id = @id AND kind = 'state'
         ORDER BY id DESC LIMIT 1`,
      )
      .get({ id: payoutId }) as { level: string; data: string };
    expect(event.level).toBe('warn');
    expect(JSON.parse(event.data)).toMatchObject({
      refused: true,
      from: 'delivered',
      to: 'collecting',
    });

    const status = ctx.db
      .prepare(`SELECT status FROM payouts WHERE id = @id`)
      .get({ id: payoutId }) as { status: string };
    expect(status.status).toBe('delivered');
  });

  it('refuses every pair not in the table', async () => {
    ctx = await createTestContext();
    const payoutId = await seedPayout(ctx);
    const allowed = new Set(TRANSITIONS.map((r) => `${r.from}>${r.to}>${r.trigger}`));

    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        if (from === to) continue;
        for (const rule of TRANSITIONS) {
          const key = `${from}>${to}>${rule.trigger}`;
          if (allowed.has(key)) continue;
          setStatus(ctx, payoutId, from);
          expect(() =>
            transition(ctx!.db, ctx!.clock, ctx!.app.log, payoutId, to, rule.trigger),
          ).toThrow(IllegalTransition);
          const status = ctx.db
            .prepare(`SELECT status FROM payouts WHERE id = @id`)
            .get({ id: payoutId }) as { status: string };
          expect(status.status).toBe(from);
        }
      }
    }
  });

  it("a final state can't change", async () => {
    ctx = await createTestContext();
    const payoutId = await seedPayout(ctx);

    for (const final of FINAL_STATUSES) {
      for (const to of ALL_STATUSES) {
        if (to === final) continue;
        setStatus(ctx, payoutId, final);
        for (const rule of TRANSITIONS) {
          expect(() =>
            transition(ctx!.db, ctx!.clock, ctx!.app.log, payoutId, to, rule.trigger),
          ).toThrow(IllegalTransition);
        }
        const status = ctx.db
          .prepare(`SELECT status FROM payouts WHERE id = @id`)
          .get({ id: payoutId }) as { status: string };
        expect(status.status).toBe(final);
      }
    }
  });
});
