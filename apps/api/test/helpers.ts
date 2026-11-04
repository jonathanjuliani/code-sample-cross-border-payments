import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { seedIfEmpty } from '../seed/seed.ts';
import { type BuildAppOptions, buildApp } from '../src/app.ts';
import { type Clock, createFakeClock } from '../src/clock.ts';
import { type AppConfig, loadConfig } from '../src/config.ts';
import { type Db, openDb } from '../src/db/open.ts';

export type TestContext = {
  app: FastifyInstance;
  db: Db;
  clock: Clock & { advance(ms: number): void };
  config: AppConfig;
  accountHeaders: Record<string, string>;
  close: () => Promise<void>;
};

export async function createTestContext(
  hooks?: BuildAppOptions['testHooks'],
  env: Record<string, string> = {},
): Promise<TestContext> {
  const db = openDb(':memory:');
  const clock = createFakeClock(Date.parse('2026-11-03T15:00:00.000Z'));
  seedIfEmpty(db, clock);
  const config = loadConfig({
    ACCOUNT_ID: 'acct_demo',
    APP_VERSION: '0.1.0-test',
    LOG_LEVEL: 'silent',
    SIM_RATE_JITTER_E4: '0',
    QUOTE_TTL_MS: '60000',
    ...env,
  });
  const app = await buildApp({
    db,
    clock,
    config,
    ...(hooks ? { testHooks: hooks } : {}),
  });
  return {
    app,
    db,
    clock,
    config,
    accountHeaders: { 'x-account-id': 'acct_demo' },
    close: () => app.close(),
  };
}

export function newIdempotencyKey(): string {
  return randomUUID();
}

export async function createQuote(
  ctx: TestContext,
  body: { recipientId?: string; mode?: 'send' | 'receive'; amountMinor: number },
) {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/quotes',
    headers: ctx.accountHeaders,
    payload: {
      recipientId: body.recipientId ?? 'r1',
      mode: body.mode ?? 'receive',
      amountMinor: body.amountMinor,
    },
  });
  return res;
}
