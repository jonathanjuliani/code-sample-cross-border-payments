import { afterEach, describe, expect, it } from 'vitest';
import { createTestContext, newIdempotencyKey } from './helpers.ts';

describe('N1: SSE streams', () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>> | undefined;

  afterEach(async () => {
    await ctx?.close();
    ctx = undefined;
  });

  it('N1: GET /payouts/:id/stream sends a payout event', async () => {
    ctx = await createTestContext(undefined, { OPS_ENABLED: 'true' });
    const quote = await ctx.app.inject({
      method: 'POST',
      url: '/quotes',
      headers: ctx.accountHeaders,
      payload: { recipientId: 'r1', mode: 'receive', amountMinor: 4280000 },
    });
    const quoteId = (quote.json() as { id: string }).id;
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/payouts',
      headers: { ...ctx.accountHeaders, 'idempotency-key': newIdempotencyKey() },
      payload: { quoteId },
    });
    const payoutId = (created.json() as { id: string }).id;

    const res = await ctx.app.inject({
      method: 'GET',
      url: `/payouts/${payoutId}/stream`,
      headers: { ...ctx.accountHeaders, 'x-sse-once': '1' },
    });
    expect(res.statusCode).toBe(200);
    expect(String(res.headers['content-type'])).toMatch(/text\/event-stream/);
    expect(res.body).toContain('event: payout');
    expect(res.body).toContain(`"id":"${payoutId}"`);
  });

  it('N1: GET /ops/stream emits an ops tick', async () => {
    ctx = await createTestContext(undefined, { OPS_ENABLED: 'true' });
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/ops/stream',
      headers: { 'x-sse-once': '1' },
    });
    expect(res.statusCode).toBe(200);
    expect(String(res.headers['content-type'])).toMatch(/text\/event-stream/);
    expect(res.body).toContain('event: ops');
    expect(res.body).toContain('payoutsByStatus');
  });
});
