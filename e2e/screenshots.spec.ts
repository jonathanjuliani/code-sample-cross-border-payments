import { expect, type Page, test } from '@playwright/test';
import { resetSim, setFlags } from './helpers.ts';

/**
 * N7: visual baselines per screen in both themes.
 * Times and payout ids are masked — the e2e API uses a real clock.
 */
test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ request }) => {
  await resetSim(request);
  await setFlags(request, { speed: 10 });
});

async function applyTheme(page: Page, theme: 'light' | 'dark') {
  await page.addInitScript((t) => {
    localStorage.setItem('theme', t);
    document.documentElement.setAttribute('data-theme', t);
  }, theme);
}

function dynamicMasks(page: Page) {
  return [
    page.locator('.eyebrow'),
    page.getByTestId('timeline-meta'),
    page.getByTestId('hold-bar'),
    page.locator('pre'),
    page.locator('.mono'),
  ];
}

async function shot(page: Page, name: string) {
  await expect(page).toHaveScreenshot(`${name}.png`, {
    animations: 'disabled',
    caret: 'hide',
    mask: dynamicMasks(page),
    fullPage: false,
  });
}

async function createDeliveredPayout(page: Page): Promise<string> {
  await page.goto('/new');
  await page.getByRole('radio', { name: /Fabric supplier/i }).check();
  await page.getByLabel(/Amount in MXN/i).fill('42800.00');
  await page.getByRole('button', { name: 'See rate and fees' }).click();
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page).toHaveURL(/\/payouts\/(PO-\w+)/);
  const id = page.url().match(/\/payouts\/(PO-\w+)/)?.[1] as string;
  await expect(page.getByText('Delivered').first()).toBeVisible({ timeout: 60_000 });
  return id;
}

for (const theme of ['light', 'dark'] as const) {
  test(`N7: screenshots (${theme})`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await applyTheme(page, theme);

    await page.goto('/new');
    await page.getByRole('radio', { name: /Fabric supplier/i }).check();
    await page.getByLabel(/Amount in MXN/i).fill('42800.00');
    await page.getByRole('button', { name: 'See rate and fees' }).click();
    await expect(page.getByRole('button', { name: 'Confirm' })).toBeVisible();
    await shot(page, `new-quote-${theme}`);

    const payoutId = await createDeliveredPayout(page);
    await shot(page, `payout-delivered-${theme}`);

    await page.goto('/');
    await expect(page.getByText(payoutId).first()).toBeVisible();
    await shot(page, `list-${theme}`);

    await page.goto('/ops');
    await expect(page.getByRole('heading', { name: 'Ops' })).toBeVisible();
    await shot(page, `ops-${theme}`);
  });
}
