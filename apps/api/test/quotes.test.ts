import { afterEach, describe, expect, it } from 'vitest';
import { createQuote, createTestContext, type TestContext } from './helpers.ts';

describe('POST /quotes', () => {
  let ctx: TestContext | undefined;

  afterEach(async () => {
    if (ctx) {
      await ctx.close();
      ctx = undefined;
    }
  });

  it('S3: rejects a float amount with 400 and the issue path', async () => {
    ctx = await createTestContext();
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/quotes',
      headers: ctx.accountHeaders,
      payload: { recipientId: 'r1', mode: 'send', amountMinor: 10.5 },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe('validation_failed');
    expect(JSON.stringify(body.issues)).toContain('amountMinor');
  });

  it('rejects an amount below $10 with 422 and the limits (send mode)', async () => {
    ctx = await createTestContext();
    const res = await createQuote(ctx, { mode: 'send', amountMinor: 999 });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({
      error: 'amount_out_of_range',
      minMinor: 1000,
      maxMinor: 5_000_000,
    });
  });

  it('rejects an amount below $10 with 422 and the limits (receive mode)', async () => {
    ctx = await createTestContext();
    // Tiny pesos → send below $10 after fee rounding.
    const res = await createQuote(ctx, { mode: 'receive', amountMinor: 100 });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({
      error: 'amount_out_of_range',
      minMinor: 1000,
      maxMinor: 5_000_000,
    });
  });

  it('receive mode quotes the exact pesos asked', async () => {
    ctx = await createTestContext();
    const res = await createQuote(ctx, { mode: 'receive', amountMinor: 4_280_000 });
    expect(res.statusCode).toBe(201);
    const quote = res.json();
    expect(quote.receiveMinor).toBe(4_280_000);
    expect(quote.mode).toBe('receive');
    expect(quote.serverNow).toBe(quote.createdAt);
  });

  it('the quote expires 60 seconds after it was made, by the server clock', async () => {
    ctx = await createTestContext();
    const res = await createQuote(ctx, { mode: 'receive', amountMinor: 4_280_000 });
    const quote = res.json();
    expect(Date.parse(quote.expiresAt) - Date.parse(quote.createdAt)).toBe(60_000);

    ctx.clock.advance(60_000);
    const confirm = await ctx.app.inject({
      method: 'POST',
      url: '/payouts',
      headers: {
        ...ctx.accountHeaders,
        'idempotency-key': '11111111-1111-4111-8111-111111111111',
      },
      payload: { quoteId: quote.id },
    });
    expect(confirm.statusCode).toBe(410);
    expect(confirm.json().error).toBe('quote_expired');
  });
});
