import { expect, test } from '@playwright/test';
import { payoutCount, resetSim, setFlags } from './helpers.ts';

test.beforeEach(async ({ request }) => {
  await resetSim(request);
  await setFlags(request, { speed: 10 });
});

test('S5: a switch set on /ops changes the next payout', async ({ page, request }) => {
  await page.goto('/ops');
  const decline = page.getByRole('checkbox', { name: 'collect.decline' });
  await expect(decline).toBeEnabled();
  await decline.check();
  await expect(decline).toBeChecked();
  const before = await payoutCount(request);
  await page.goto('/new');
  await page.getByRole('radio', { name: /Fabric supplier/i }).check();
  await page.getByLabel(/Amount in MXN/i).fill('42800.00');
  await page.getByRole('button', { name: 'See rate and fees' }).click();
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page).toHaveURL(/\/payouts\/PO-/);
  await expect(page.getByText('Not sent').first()).toBeVisible({ timeout: 30_000 });
  expect((await payoutCount(request)) - before).toBe(1);
});

test('S8: the server log shows the replay when Confirm is sent twice with the same key', async ({
  page,
  request,
}) => {
  await page.goto('/new');
  await page.getByRole('radio', { name: /Fabric supplier/i }).check();
  await page.getByLabel(/Amount in MXN/i).fill('42800.00');
  await page.getByRole('button', { name: 'See rate and fees' }).click();
  const confirmReq = page.waitForRequest(
    (r) => r.url().includes('/api/payouts') && r.method() === 'POST',
  );
  await page.getByRole('button', { name: 'Confirm' }).click();
  const first = await confirmReq;
  await expect(page).toHaveURL(/\/payouts\/PO-/);

  const key = first.headers()['idempotency-key'];
  const body = first.postData() ?? '';
  expect(key).toBeTruthy();
  const replay = await request.post('/api/payouts', {
    headers: {
      'x-account-id': 'acct_demo',
      'content-type': 'application/json',
      'idempotency-key': key as string,
    },
    data: JSON.parse(body) as object,
  });
  expect(replay.status()).toBe(200);

  await page.goto('/ops');
  await expect(page.locator('pre').filter({ hasText: /idempotent replay/i })).toBeVisible({
    timeout: 15_000,
  });
});
