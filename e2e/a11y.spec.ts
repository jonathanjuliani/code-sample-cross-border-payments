import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { resetSim, setFlags } from './helpers.ts';

test.beforeEach(async ({ request }) => {
  await resetSim(request);
  await setFlags(request, { speed: 10 });
});

async function axeOk(page: import('@playwright/test').Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
}

for (const theme of ['light', 'dark'] as const) {
  test(`S6: list, new payout, payout and /ops have no axe violations in ${theme}`, async ({
    page,
  }) => {
    await page.addInitScript((t) => {
      localStorage.setItem('theme', t);
      document.documentElement.setAttribute('data-theme', t);
    }, theme);

    await page.goto('/');
    await axeOk(page);
    await page.goto('/new');
    await axeOk(page);
    await page.goto('/ops');
    await axeOk(page);

    await page.goto('/new');
    await page.getByRole('radio', { name: /Fabric supplier/i }).check();
    await page.getByLabel(/Amount in MXN/i).fill('42800.00');
    await page.getByRole('button', { name: 'See rate and fees' }).click();
    await page.getByRole('button', { name: 'Confirm' }).click();
    await expect(page).toHaveURL(/\/payouts\/PO-/);
    await axeOk(page);
  });
}

test('tabular figures: "0000" and "1111" render at equal width', async ({ page }) => {
  await page.goto('/');
  const widths = await page.evaluate(() => {
    const measure = (text: string) => {
      const el = document.createElement('span');
      el.className = 'money';
      el.style.fontFamily = getComputedStyle(document.body).fontFamily;
      el.style.fontVariantNumeric = 'tabular-nums';
      el.textContent = text;
      document.body.appendChild(el);
      const w = el.getBoundingClientRect().width;
      el.remove();
      return w;
    };
    return { a: measure('0000'), b: measure('1111') };
  });
  expect(Math.abs(widths.a - widths.b)).toBeLessThan(0.5);
});

test('no request leaves localhost', async ({ page }) => {
  const hosts = new Set<string>();
  page.on('request', (req) => {
    try {
      hosts.add(new URL(req.url()).hostname);
    } catch {
      /* ignore */
    }
  });
  await page.goto('/');
  await page.goto('/new');
  await page.goto('/ops');
  for (const h of hosts) {
    expect(['localhost', '127.0.0.1'].includes(h)).toBeTruthy();
  }
});

test('375 px wide: no horizontal scroll on any screen', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  for (const path of ['/', '/new', '/ops']) {
    await page.goto(path);
    const scroll = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(scroll).toBeLessThanOrEqual(1);
  }
});
