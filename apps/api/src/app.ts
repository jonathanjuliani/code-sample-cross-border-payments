import Fastify from 'fastify';
import type { Clock } from './clock.ts';
import type { AppConfig } from './config.ts';
import type { Db } from './db/open.ts';
import { registerLedgerRoutes } from './ledger/routes.ts';
import type { ProviderSpy } from './payouts/create.ts';
import { registerPayoutRoutes } from './payouts/routes.ts';
import { registerQuoteRoutes } from './quotes/routes.ts';
import { registerRecipientRoutes } from './recipients/routes.ts';
import { registerWebhookRoutes } from './webhooks/routes.ts';

export type BuildAppOptions = {
  db: Db;
  clock: Clock;
  config: AppConfig;
  /** Test-only hooks for Phase 2 atomicity / provider spy proofs. */
  testHooks?: {
    providerSpy?: ProviderSpy;
    abortAfterQuoteConsumed?: () => void;
  };
};

export async function buildApp({ db, clock, config, testHooks }: BuildAppOptions) {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      redact: ['*.bankAccountToken', 'req.headers["idempotency-key"]'],
    },
  });

  app.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?')[0] ?? request.url;
    if (path === '/health' || path.startsWith('/webhooks/') || path.startsWith('/ops/')) {
      return;
    }

    const accountId = request.headers['x-account-id'];
    if (accountId !== config.ACCOUNT_ID) {
      return reply.code(401).send({
        error: 'unknown_account',
        message: 'Unknown or missing X-Account-Id',
      });
    }
  });

  app.get('/health', async () => ({
    ok: true as const,
    version: config.APP_VERSION,
  }));

  registerRecipientRoutes(app, db);
  registerQuoteRoutes(app, { db, clock, config });
  registerPayoutRoutes(app, {
    db,
    clock,
    config,
    ...(testHooks?.providerSpy ? { providerSpy: testHooks.providerSpy } : {}),
    ...(testHooks?.abortAfterQuoteConsumed
      ? { abortAfterQuoteConsumed: testHooks.abortAfterQuoteConsumed }
      : {}),
  });
  registerLedgerRoutes(app, db);
  registerWebhookRoutes(app, { db, clock });

  return app;
}
