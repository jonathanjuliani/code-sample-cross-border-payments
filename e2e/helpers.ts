import { type APIRequestContext, expect } from '@playwright/test';

const ACCOUNT = { 'x-account-id': 'acct_demo' };

export async function resetSim(request: APIRequestContext) {
  const res = await request.post('/api/ops/simulation/reset', { headers: ACCOUNT });
  expect(res.ok()).toBeTruthy();
}

export async function setFlags(
  request: APIRequestContext,
  flags: Record<string, boolean | number>,
) {
  const res = await request.put('/api/ops/simulation', {
    headers: { ...ACCOUNT, 'content-type': 'application/json' },
    data: flags,
  });
  expect(res.ok()).toBeTruthy();
}

export async function payoutCount(request: APIRequestContext): Promise<number> {
  const res = await request.get('/api/payouts', { headers: ACCOUNT });
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as unknown[];
  return body.length;
}
