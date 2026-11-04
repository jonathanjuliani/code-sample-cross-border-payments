import { afterEach, describe, expect, it } from 'vitest';
import { seedIfEmpty } from '../seed/seed.ts';
import { buildApp } from '../src/app.ts';
import { createFakeClock } from '../src/clock.ts';
import { loadConfig } from '../src/config.ts';
import { openDb } from '../src/db/open.ts';

describe('GET /health', () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (close) {
      await close();
      close = undefined;
    }
  });

  it('returns ok and the app version without an account header', async () => {
    const db = openDb(':memory:');
    seedIfEmpty(db);
    const config = loadConfig({
      ACCOUNT_ID: 'acct_demo',
      APP_VERSION: '0.1.0-test',
      LOG_LEVEL: 'silent',
    });
    const app = await buildApp({
      db,
      clock: createFakeClock(Date.parse('2026-11-03T15:00:00.000Z')),
      config,
    });
    close = () => app.close();

    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, version: '0.1.0-test' });
  });

  it('rejects unknown X-Account-Id on protected routes', async () => {
    const db = openDb(':memory:');
    const config = loadConfig({ ACCOUNT_ID: 'acct_demo', LOG_LEVEL: 'silent' });
    const app = await buildApp({
      db,
      clock: createFakeClock(),
      config,
    });
    close = () => app.close();

    // No protected routes yet beyond the hook; exercise via a stub path.
    app.get('/recipients', async () => []);
    const res = await app.inject({ method: 'GET', url: '/recipients' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'unknown_account' });
  });
});
