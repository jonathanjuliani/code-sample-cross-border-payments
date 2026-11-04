import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

const dbPath = join(mkdtempSync(join(tmpdir(), 'payout-e2e-')), 'payouts.db');
const apiPort = 3100;
const webPort = 5173;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 120_000,
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
    },
  },
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${webPort}`,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { channel: 'chromium' } }],
  webServer: [
    {
      command: `pnpm --filter @payout/api start`,
      url: `http://127.0.0.1:${apiPort}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        ...process.env,
        OPS_ENABLED: 'true',
        SIM_RATE_JITTER_E4: '0',
        SIM_FLAGS: JSON.stringify({ speed: 10 }),
        DB_PATH: dbPath,
        PORT: String(apiPort),
        ACCOUNT_ID: 'acct_demo',
        LOG_LEVEL: 'error',
      },
    },
    {
      command: `pnpm --filter @payout/web exec vite --host 127.0.0.1 --port ${webPort}`,
      url: `http://127.0.0.1:${webPort}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        ...process.env,
        API_PROXY_TARGET: `http://127.0.0.1:${apiPort}`,
      },
    },
  ],
});
