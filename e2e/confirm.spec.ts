import { expect, test } from '@playwright/test';
import { payoutCount, resetSim, setFlags } from './helpers.ts';

test.beforeEach(async ({ request }) => {
  await resetSim(request);
  await setFlags(request, { speed: 10 });
});

async function quoteForConfirm(page: import('@playwright/test').Page) {
  await page.goto('/new');
  await page.getByRole('radio', { name: /Fabric supplier/i }).check();
  await page.getByLabel(/Amount in MXN/i).fill('42800.00');
  const quoteRes = page.waitForResponse(
    (r) => r.url().includes('/api/quotes') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'See rate and fees' }).click();
  const qr = await quoteRes;
  expect(qr.ok()).toBeTruthy();
  return (await qr.json()) as { id: string };
}

test('H1: double-clicking Confirm creates one payout', async ({ page, request }) => {
  const before = await payoutCount(request);
  await quoteForConfirm(page);
  await expect(page.getByRole('button', { name: 'Confirm' })).toBeVisible();
  await page.getByRole('button', { name: 'Confirm' }).dblclick();
  await expect(page).toHaveURL(/\/payouts\/PO-/);
  expect((await payoutCount(request)) - before).toBe(1);
});

test('H2: confirming with 1s left is accepted', async ({ page, request }) => {
  const quote = await quoteForConfirm(page);
  await request.post(`/api/ops/quotes/${quote.id}/expire-in`, {
    headers: { 'x-account-id': 'acct_demo', 'content-type': 'application/json' },
    data: { ms: 1500 },
  });
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page).toHaveURL(/\/payouts\/PO-/);
});

test('H2: confirming after expiry shows "Nothing was sent" and offers a new rate', async ({
  page,
  request,
}) => {
  const quote = await quoteForConfirm(page);
  await request.post(`/api/ops/quotes/${quote.id}/expire-in`, {
    headers: { 'x-account-id': 'acct_demo', 'content-type': 'application/json' },
    data: { ms: 0 },
  });
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByText(/Nothing was sent/i)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Get a new rate' })).toBeVisible();
});

test('S4: a dropped confirm response still lands on the one payout', async ({ page, request }) => {
  const before = await payoutCount(request);
  await quoteForConfirm(page);
  let dropped = false;
  await page.route('**/api/payouts', async (route) => {
    if (route.request().method() === 'POST' && !dropped) {
      dropped = true;
      await route.fetch();
      await route.abort('failed');
      return;
    }
    await route.continue();
  });
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page).toHaveURL(/\/payouts\/PO-/, { timeout: 30_000 });
  expect((await payoutCount(request)) - before).toBe(1);
});
