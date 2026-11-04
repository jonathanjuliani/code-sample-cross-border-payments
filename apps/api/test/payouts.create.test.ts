import { afterEach, describe, expect, it } from 'vitest';
import type { ProviderSpy } from '../src/payouts/create.ts';
import { createQuote, createTestContext, newIdempotencyKey, type TestContext } from './helpers.ts';

async function quoteAndKey(ctx: TestContext, amountMinor = 4_280_000) {
  const quoteRes = await createQuote(ctx, { mode: 'receive', amountMinor });
  expect(quoteRes.statusCode).toBe(201);
  return { quote: quoteRes.json(), key: newIdempotencyKey() };
}

describe('POST /payouts', () => {
  let ctx: TestContext | undefined;

  afterEach(async () => {
    if (ctx) {
      await ctx.close();
      ctx = undefined;
    }
  });

  it('H1: confirming twice with the same key creates one payout', async () => {
    ctx = await createTestContext();
    const { quote, key } = await quoteAndKey(ctx);

    const first = await ctx.app.inject({
      method: 'POST',
      url: '/payouts',
      headers: { ...ctx.accountHeaders, 'idempotency-key': key },
      payload: { quoteId: quote.id },
    });
    expect(first.statusCode).toBe(201);

    const second = await ctx.app.inject({
      method: 'POST',
      url: '/payouts',
      headers: { ...ctx.accountHeaders, 'idempotency-key': key },
      payload: { quoteId: quote.id },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual(first.json());

    const count = ctx.db.prepare(`SELECT COUNT(*) AS n FROM payouts`).get() as { n: number };
    expect(count.n).toBe(1);
  });

  it('H1: two confirms with the same key sent at once create one payout', async () => {
    ctx = await createTestContext();
    const { quote, key } = await quoteAndKey(ctx);

    const [a, b] = await Promise.all([
      ctx.app.inject({
        method: 'POST',
        url: '/payouts',
        headers: { ...ctx.accountHeaders, 'idempotency-key': key },
        payload: { quoteId: quote.id },
      }),
      ctx.app.inject({
        method: 'POST',
        url: '/payouts',
        headers: { ...ctx.accountHeaders, 'idempotency-key': key },
        payload: { quoteId: quote.id },
      }),
    ]);

    const statuses = [a.statusCode, b.statusCode].sort();
    expect(statuses).toEqual([200, 201]);
    expect(a.json().id).toBe(b.json().id);

    const count = ctx.db.prepare(`SELECT COUNT(*) AS n FROM payouts`).get() as { n: number };
    expect(count.n).toBe(1);
  });

  it('H1: the same key with a different body is 409 idempotency_conflict', async () => {
    ctx = await createTestContext();
    const { quote, key } = await quoteAndKey(ctx);
    const other = await createQuote(ctx, { mode: 'receive', amountMinor: 5_000_000 });

    const first = await ctx.app.inject({
      method: 'POST',
      url: '/payouts',
      headers: { ...ctx.accountHeaders, 'idempotency-key': key },
      payload: { quoteId: quote.id },
    });
    expect(first.statusCode).toBe(201);

    const conflict = await ctx.app.inject({
      method: 'POST',
      url: '/payouts',
      headers: { ...ctx.accountHeaders, 'idempotency-key': key },
      payload: { quoteId: other.json().id },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error).toBe('idempotency_conflict');
  });

  it('H2: a confirm 1ms before expiry is accepted at the quoted rate', async () => {
    ctx = await createTestContext();
    const { quote, key } = await quoteAndKey(ctx);
    ctx.clock.advance(59_999);

    const res = await ctx.app.inject({
      method: 'POST',
      url: '/payouts',
      headers: { ...ctx.accountHeaders, 'idempotency-key': key },
      payload: { quoteId: quote.id },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      sendMinor: quote.sendMinor,
      feeMinor: quote.feeMinor,
      convertMinor: quote.convertMinor,
      receiveMinor: quote.receiveMinor,
    });
  });

  it('H2: a confirm at expiry is 410 and nothing is written', async () => {
    ctx = await createTestContext();
    const { quote, key } = await quoteAndKey(ctx);
    ctx.clock.advance(60_000);

    const res = await ctx.app.inject({
      method: 'POST',
      url: '/payouts',
      headers: { ...ctx.accountHeaders, 'idempotency-key': key },
      payload: { quoteId: quote.id },
    });
    expect(res.statusCode).toBe(410);
    expect(res.json().error).toBe('quote_expired');

    const payouts = ctx.db.prepare(`SELECT COUNT(*) AS n FROM payouts`).get() as { n: number };
    const outbox = ctx.db.prepare(`SELECT COUNT(*) AS n FROM outbox`).get() as { n: number };
    const keysForQuote = ctx.db
      .prepare(
        `SELECT COUNT(*) AS n FROM idempotency_keys k
         JOIN payouts p ON p.id = k.payout_id
         WHERE p.quote_id = @qid`,
      )
      .get({ qid: quote.id }) as { n: number };
    expect(payouts.n).toBe(0);
    expect(outbox.n).toBe(0);
    expect(keysForQuote.n).toBe(0);

    const quoteRow = ctx.db
      .prepare(`SELECT status FROM quotes WHERE id = @id`)
      .get({ id: quote.id }) as { status: string };
    expect(quoteRow.status).toBe('expired');
  });

  it("H3: a used quote can't make a second payout, even with a new key", async () => {
    ctx = await createTestContext();
    const { quote, key } = await quoteAndKey(ctx);

    const first = await ctx.app.inject({
      method: 'POST',
      url: '/payouts',
      headers: { ...ctx.accountHeaders, 'idempotency-key': key },
      payload: { quoteId: quote.id },
    });
    expect(first.statusCode).toBe(201);

    const second = await ctx.app.inject({
      method: 'POST',
      url: '/payouts',
      headers: { ...ctx.accountHeaders, 'idempotency-key': newIdempotencyKey() },
      payload: { quoteId: quote.id },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({
      error: 'quote_used',
      payoutId: first.json().id,
    });
  });

  it('S4: a retry after a lost response finds the payout by key', async () => {
    ctx = await createTestContext();
    const { quote, key } = await quoteAndKey(ctx);

    const created = await ctx.app.inject({
      method: 'POST',
      url: '/payouts',
      headers: { ...ctx.accountHeaders, 'idempotency-key': key },
      payload: { quoteId: quote.id },
    });
    expect(created.statusCode).toBe(201);

    const found = await ctx.app.inject({
      method: 'GET',
      url: `/payouts?idempotencyKey=${key}`,
      headers: ctx.accountHeaders,
    });
    expect(found.statusCode).toBe(200);
    expect(found.json().id).toBe(created.json().id);
  });

  it("T2: the client's countdown is ignored", async () => {
    ctx = await createTestContext();
    const { quote, key } = await quoteAndKey(ctx);
    ctx.clock.advance(60_000);

    const res = await ctx.app.inject({
      method: 'POST',
      url: '/payouts',
      headers: { ...ctx.accountHeaders, 'idempotency-key': key },
      payload: { quoteId: quote.id, clientNow: '2026-11-03T14:59:59.000Z' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('validation_failed');

    const key2 = newIdempotencyKey();
    const expired = await ctx.app.inject({
      method: 'POST',
      url: '/payouts',
      headers: { ...ctx.accountHeaders, 'idempotency-key': key2 },
      payload: { quoteId: quote.id },
    });
    expect(expired.statusCode).toBe(410);
  });

  it('T3: creating a payout calls no provider', async () => {
    const spy: ProviderSpy = { submitCalls: 0 };
    ctx = await createTestContext({ providerSpy: spy });
    const { quote, key } = await quoteAndKey(ctx);

    const res = await ctx.app.inject({
      method: 'POST',
      url: '/payouts',
      headers: { ...ctx.accountHeaders, 'idempotency-key': key },
      payload: { quoteId: quote.id },
    });
    expect(res.statusCode).toBe(201);
    expect(spy.submitCalls).toBe(0);
  });

  it("T8: the payout keeps the quote's four amounts", async () => {
    ctx = await createTestContext();
    const { quote, key } = await quoteAndKey(ctx);

    const res = await ctx.app.inject({
      method: 'POST',
      url: '/payouts',
      headers: { ...ctx.accountHeaders, 'idempotency-key': key },
      payload: { quoteId: quote.id },
    });
    expect(res.json()).toMatchObject({
      sendMinor: quote.sendMinor,
      feeMinor: quote.feeMinor,
      convertMinor: quote.convertMinor,
      receiveMinor: quote.receiveMinor,
    });
  });

  it('writes the collect request to the outbox in the same transaction', async () => {
    ctx = await createTestContext({
      abortAfterQuoteConsumed: () => {
        throw new Error('forced abort');
      },
    });
    const { quote, key } = await quoteAndKey(ctx);

    const res = await ctx.app.inject({
      method: 'POST',
      url: '/payouts',
      headers: { ...ctx.accountHeaders, 'idempotency-key': key },
      payload: { quoteId: quote.id },
    });
    expect(res.statusCode).toBe(500);

    // The throw aborted the SQLite transaction; nothing from create may remain.
    const payouts = ctx.db.prepare(`SELECT COUNT(*) AS n FROM payouts`).get() as { n: number };
    const outbox = ctx.db.prepare(`SELECT COUNT(*) AS n FROM outbox`).get() as { n: number };
    const keys = ctx.db.prepare(`SELECT COUNT(*) AS n FROM idempotency_keys`).get() as {
      n: number;
    };
    const quoteRow = ctx.db
      .prepare(`SELECT status, payout_id FROM quotes WHERE id = @id`)
      .get({ id: quote.id }) as { status: string; payout_id: string | null };

    expect(payouts.n).toBe(0);
    expect(outbox.n).toBe(0);
    expect(keys.n).toBe(0);
    expect(quoteRow.status).toBe('active');
    expect(quoteRow.payout_id).toBeNull();
  });
});
