import { expect, test } from '@playwright/test';
import { resetSim, setFlags } from './helpers.ts';

test.beforeEach(async ({ request }) => {
  await resetSim(request);
  await setFlags(request, { speed: 10 });
});

async function startPayout(page: import('@playwright/test').Page) {
  await page.goto('/new');
  await page.getByRole('radio', { name: /Fabric supplier/i }).check();
  await page.getByLabel(/Amount in MXN/i).fill('42800.00');
  await page.getByRole('button', { name: 'See rate and fees' }).click();
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page).toHaveURL(/\/payouts\/PO-/);
}

test('happy path reaches Delivered and shows the quoted pesos', async ({ page }) => {
  await startPayout(page);
  await expect(page.getByText('Delivered').first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/42,800\.00 MXN/).first()).toBeVisible();
});

test('H4: a declined hop 1 shows failed and "Not sent"', async ({ page, request }) => {
  await setFlags(request, { 'collect.decline': true, speed: 10 });
  await startPayout(page);
  await expect(page.getByText('Not sent').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/No money left your account/i)).toBeVisible();
});

test('H6: a rejected deposit shows refunded with the fee included', async ({ page, request }) => {
  await setFlags(request, { 'deposit.rejectBank': true, speed: 10 });
  await startPayout(page);
  await expect(page.getByText(/Refunded/i).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/fee included/i).first()).toBeVisible();
});

test("H9: reloading mid-payout shows the server's status", async ({ page, request }) => {
  await setFlags(request, { slow: true, speed: 1 });
  await startPayout(page);
  const url = page.url();
  await page.reload();
  await expect(page).toHaveURL(url);
  await expect(
    page.getByText(/In progress|Checking|Delivered|Not sent|Refund/i).first(),
  ).toBeVisible();
});

test('S2: when reads fail the strip shows the last confirmed time, and recovers', async ({
  page,
  request,
}) => {
  await startPayout(page);
  await expect(page.getByText(/In progress|Delivered/i).first()).toBeVisible({ timeout: 30_000 });
  await setFlags(request, { 'client.readsFail': true });
  await expect(page.getByText(/Can't reach the server/i)).toBeVisible({ timeout: 15_000 });
  await setFlags(request, { 'client.readsFail': false });
  await expect(page.getByText(/Can't reach the server/i)).toBeHidden({ timeout: 15_000 });
});

test("T7: the page doesn't say Delivered before the API does", async ({ page, request }) => {
  await setFlags(request, { slow: true, speed: 1 });
  await startPayout(page);
  const id = page.url().split('/').pop()!;

  for (let i = 0; i < 40; i++) {
    const res = await request.get(`/api/payouts/${id}`, {
      headers: { 'x-account-id': 'acct_demo' },
    });
    const body = (await res.json()) as {
      status: string;
      legs: Array<{ leg: string; status: string }>;
    };
    const deposit = body.legs.find((l) => l.leg === 'deposit');
    if (deposit && deposit.status !== 'succeeded' && body.status !== 'delivered') {
      await expect(page.getByText('Delivered')).toHaveCount(0);
    }
    if (body.status === 'delivered') break;
    await page.waitForTimeout(500);
  }
});
