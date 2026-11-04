import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { accountBalance, assertBalanced } from '../src/ledger/balances.ts';
import { LedgerError, postJournal, postSignedJournal } from '../src/ledger/post.ts';
import {
  onCollectSucceeded,
  onDepositSucceeded,
  onRefundSucceeded,
  onTransferFinal,
} from '../src/ledger/postings.ts';
import { createQuote, createTestContext, newIdempotencyKey, type TestContext } from './helpers.ts';

async function createLivePayout(ctx: TestContext) {
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

describe('ledger', () => {
  let ctx: TestContext | undefined;

  afterEach(async () => {
    if (ctx) {
      await ctx.close();
      ctx = undefined;
    }
  });

  it("H12: post refuses a journal that doesn't sum to zero and writes nothing", async () => {
    ctx = await createTestContext();
    const payout = await createLivePayout(ctx);

    expect(() =>
      postSignedJournal(ctx!.db, ctx!.clock, ctx!.app.log, payout.id, 'bad', [
        { currency: 'USD', account: 'sender_bank', amountMinor: -100 },
        { currency: 'USD', account: 'usd_clearing', amountMinor: 40 },
      ]),
    ).toThrow(LedgerError);

    const n = ctx.db
      .prepare(`SELECT COUNT(*) AS n FROM ledger_entries WHERE payout_id = @id`)
      .get({ id: payout.id }) as { n: number };
    expect(n.n).toBe(0);
  });

  it('H12: post refuses a fractional amount', async () => {
    ctx = await createTestContext();
    const payout = await createLivePayout(ctx);
    expect(() =>
      postJournal(ctx!.db, ctx!.clock, ctx!.app.log, payout.id, 'frac', [
        { currency: 'USD', from: 'sender_bank', to: 'usd_clearing', amountMinor: 1.25 as number },
      ]),
    ).toThrow(/positive integer/);
    const n = ctx.db
      .prepare(`SELECT COUNT(*) AS n FROM ledger_entries WHERE payout_id = @id`)
      .get({ id: payout.id }) as { n: number };
    expect(n.n).toBe(0);
  });

  it('T6: there is no balance column', () => {
    const schema = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../src/db/schema.sql'),
      'utf8',
    );
    expect(schema.toLowerCase()).not.toMatch(/\bbalance\b/);
  });

  it('a delivered payout leaves recipient_bank MXN equal to receive', async () => {
    ctx = await createTestContext();
    const payout = await createLivePayout(ctx);
    const amounts = {
      id: payout.id as string,
      send_minor: payout.sendMinor as number,
      fee_minor: payout.feeMinor as number,
      convert_minor: payout.convertMinor as number,
      receive_minor: payout.receiveMinor as number,
    };
    onCollectSucceeded(ctx.db, ctx.clock, ctx.app.log, amounts);
    onTransferFinal(ctx.db, ctx.clock, ctx.app.log, amounts);
    onDepositSucceeded(ctx.db, ctx.clock, ctx.app.log, amounts);
    assertBalanced(ctx.db, payout.id);
    expect(accountBalance(ctx.db, payout.id, 'recipient_bank', 'MXN')).toBe(amounts.receive_minor);
  });

  it('a refunded payout leaves sender_bank USD at zero and nothing in any DUSD or MXN account', async () => {
    ctx = await createTestContext();
    const payout = await createLivePayout(ctx);
    const amounts = {
      id: payout.id as string,
      send_minor: payout.sendMinor as number,
      fee_minor: payout.feeMinor as number,
      convert_minor: payout.convertMinor as number,
      receive_minor: payout.receiveMinor as number,
    };
    onCollectSucceeded(ctx.db, ctx.clock, ctx.app.log, amounts);
    onTransferFinal(ctx.db, ctx.clock, ctx.app.log, amounts);
    onRefundSucceeded(ctx.db, ctx.clock, ctx.app.log, amounts);
    assertBalanced(ctx.db, payout.id);
    expect(accountBalance(ctx.db, payout.id, 'sender_bank', 'USD')).toBe(0);
    const leftover = ctx.db
      .prepare(
        `SELECT account, currency, SUM(amount_minor) AS total FROM ledger_entries
         WHERE payout_id = @id AND currency IN ('DUSD', 'MXN')
         GROUP BY account, currency
         HAVING SUM(amount_minor) != 0`,
      )
      .all({ id: payout.id });
    expect(leftover).toEqual([]);
  });
});
