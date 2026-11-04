import { expect, test } from '@playwright/test';
import { resetSim, setFlags } from './helpers.ts';

test.beforeEach(async ({ request }) => {
  await resetSim(request);
  await setFlags(request, { speed: 10 });
});

test('N1: timeline updates over SSE with polling GETs blocked', async ({ page }) => {
  let blockPollGets = false;
  await page.route('**/api/payouts/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/stream')) {
      await route.continue();
      return;
    }
    if (
      blockPollGets &&
      route.request().method() === 'GET' &&
      /\/payouts\/PO-[^/?]+$/.test(new URL(url).pathname)
    ) {
      await route.abort();
      return;
    }
    await route.continue();
  });

  await page.goto('/new');
  await page.getByRole('radio', { name: /Fabric supplier/i }).check();
  await page.getByLabel(/Amount in MXN/i).fill('42800.00');
  await page.getByRole('button', { name: 'See rate and fees' }).click();
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page).toHaveURL(/\/payouts\/PO-/);
  await expect(page.getByTestId('live-transport')).toHaveText('sse', { timeout: 10_000 });
  blockPollGets = true;
  await expect(page.getByText('Delivered').first()).toBeVisible({ timeout: 60_000 });
});

test('N1: falls back to polling when the stream closes', async ({ page }) => {
  await page.route('**/api/payouts/*/stream**', async (route) => {
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'simulated_outage', message: 'stream down' }),
    });
  });

  await page.goto('/new');
  await page.getByRole('radio', { name: /Fabric supplier/i }).check();
  await page.getByLabel(/Amount in MXN/i).fill('42800.00');
  await page.getByRole('button', { name: 'See rate and fees' }).click();
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page).toHaveURL(/\/payouts\/PO-/);
  await expect(page.getByTestId('live-transport')).toHaveText('poll', { timeout: 15_000 });
  await expect(page.getByText('Delivered').first()).toBeVisible({ timeout: 60_000 });
});
