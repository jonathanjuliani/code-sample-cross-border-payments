import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { lookupTransferByHash, networkRefFromRpcResult } from '../src/network/lookup.ts';
import { createQuote, createTestContext, newIdempotencyKey, type TestContext } from './helpers.ts';

const FIXTURE_HASH = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const fixture = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures/sepolia-tx.json'), 'utf8'),
) as { result: Record<string, unknown> };

describe('network lookup (N5)', () => {
  let ctx: TestContext | undefined;

  afterEach(async () => {
    if (ctx) {
      await ctx.close();
      ctx = undefined;
    }
  });

  it('parses a recorded eth_getTransactionByHash response without calling the network', async () => {
    let calls = 0;
    const ref = await lookupTransferByHash(FIXTURE_HASH, {
      rpcUrl: 'https://rpc.example.test',
      fetchFn: async () => {
        calls += 1;
        return { ok: true, json: async () => fixture };
      },
    });
    expect(calls).toBe(1);
    expect(ref).toEqual(networkRefFromRpcResult(FIXTURE_HASH, fixture.result as never));
    expect(ref?.from).toBe('0x1111111111111111111111111111111111111111');
    expect(ref?.blockNumber).toBe('0x5bad55');
  });

  it('GET /payouts/:id/network-ref is 404 when lookup is off', async () => {
    ctx = await createTestContext(undefined, { TESTNET_LOOKUP_ENABLED: 'false' });
    const quote = await createQuote(ctx, { mode: 'receive', amountMinor: 4_280_000 });
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/payouts',
      headers: { ...ctx.accountHeaders, 'idempotency-key': newIdempotencyKey() },
      payload: { quoteId: quote.json().id },
    });
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/payouts/${created.json().id}/network-ref`,
      headers: ctx.accountHeaders,
    });
    expect(res.statusCode).toBe(404);
  });

  it('GET /payouts/:id/network-ref returns the recorded transfer when enabled', async () => {
    let networkHits = 0;
    ctx = await createTestContext(
      undefined,
      { TESTNET_LOOKUP_ENABLED: 'true' },
      {
        lookupFetch: async () => {
          networkHits += 1;
          return { ok: true, json: async () => fixture };
        },
      },
    );
    const quote = await createQuote(ctx, { mode: 'receive', amountMinor: 4_280_000 });
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/payouts',
      headers: { ...ctx.accountHeaders, 'idempotency-key': newIdempotencyKey() },
      payload: { quoteId: quote.json().id },
    });
    const payoutId = created.json().id as string;
    ctx.db
      .prepare(`UPDATE payout_legs SET tx_hash = @hash WHERE payout_id = @id AND leg = 'transfer'`)
      .run({ id: payoutId, hash: FIXTURE_HASH });

    const res = await ctx.app.inject({
      method: 'GET',
      url: `/payouts/${payoutId}/network-ref`,
      headers: ctx.accountHeaders,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      hash: FIXTURE_HASH,
      from: '0x1111111111111111111111111111111111111111',
      source: 'testnet-rpc',
    });
    expect(networkHits).toBe(1);
  });
});
