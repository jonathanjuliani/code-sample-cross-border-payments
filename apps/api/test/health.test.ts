import { afterEach, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from './helpers.ts';

describe('GET /health', () => {
  let ctx: TestContext | undefined;

  afterEach(async () => {
    if (ctx) {
      await ctx.close();
      ctx = undefined;
    }
  });

  it('returns ok and the app version without an account header', async () => {
    ctx = await createTestContext();
    const res = await ctx.app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, version: '0.1.0-test' });
  });

  it('rejects unknown X-Account-Id on protected routes', async () => {
    ctx = await createTestContext();
    const res = await ctx.app.inject({ method: 'GET', url: '/recipients' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'unknown_account' });
  });
});
