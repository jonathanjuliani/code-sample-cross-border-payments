import { expect, test } from '@playwright/test';
import { resetSim, setFlags } from './helpers.ts';

const ACCOUNT = { 'x-account-id': 'acct_demo' };

test.beforeEach(async ({ request }) => {
  await resetSim(request);
  await setFlags(request, { speed: 10, 'transfer.timeout': true });
});

test('N3: Re-run status query queues one status.query', async ({ page, request }) => {
  await page.goto('/new');
  await page.getByRole('radio', { name: /Fabric supplier/i }).check();
  await page.getByLabel(/Amount in MXN/i).fill('42800.00');
  await page.getByRole('button', { name: 'See rate and fees' }).click();
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page).toHaveURL(/\/payouts\/(PO-\w+)/);
  const payoutId = page.url().match(/\/payouts\/(PO-\w+)/)?.[1];
  expect(payoutId).toBeTruthy();

  await expect
    .poll(
      async () => {
        const res = await request.get(`/api/ops/payouts/${payoutId}`, { headers: ACCOUNT });
        if (!res.ok()) return '';
        const body = (await res.json()) as {
          legs: Array<{ leg: string; status: string }>;
        };
        const transfer = body.legs.find((l) => l.leg === 'transfer');
        return transfer?.status ?? '';
      },
      { timeout: 60_000 },
    )
    .toBe('checking');

  const beforeRes = await request.get(`/api/ops/payouts/${payoutId}`, { headers: ACCOUNT });
  const before = (await beforeRes.json()) as {
    outbox: Array<{ kind: string }>;
  };
  const beforeCount = before.outbox.filter((r) => r.kind === 'status.query').length;

  await page.goto('/ops');
  await page.getByLabel('Inspector payout id').fill(payoutId as string);
  await page.getByRole('button', { name: 'Load' }).click();
  await page.getByTestId('rerun-transfer').click();
  await expect(page.getByTestId('inspector-action')).toContainText(/Queued status\.query/i);

  await expect
    .poll(async () => {
      const res = await request.get(`/api/ops/payouts/${payoutId}`, { headers: ACCOUNT });
      const body = (await res.json()) as { outbox: Array<{ kind: string }> };
      return body.outbox.filter((r) => r.kind === 'status.query').length;
    })
    .toBe(beforeCount + 1);
});
