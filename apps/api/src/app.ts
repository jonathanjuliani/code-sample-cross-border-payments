import Fastify, { type FastifyRequest } from 'fastify';
import type { Clock } from './clock.ts';
import type { AppConfig } from './config.ts';
import type { Db } from './db/open.ts';
import { registerLedgerRoutes } from './ledger/routes.ts';
import { registerReconciliationRoute } from './ops/reconciliation.ts';
import { registerOpsRoutes } from './ops/routes.ts';
import type { ProviderSpy } from './payouts/create.ts';
import { type LookupFetch, registerPayoutRoutes } from './payouts/routes.ts';
import { getFlags } from './providers/sim/flags.ts';
import type { SimRecords } from './providers/sim/records.ts';
import { registerQuoteRoutes } from './quotes/routes.ts';
import { registerRecipientRoutes } from './recipients/routes.ts';
import { registerWebhookRoutes } from './webhooks/routes.ts';

export type BuildAppOptions = {
  db: Db;
  clock: Clock;
  config: AppConfig;
  getWorkerLastTickAt?: () => Date | null;
  getSimRecords?: () => SimRecords;
  onCrashAfterCommit?: () => void;
  /** Test-only hooks for Phase 2 atomicity / provider spy proofs. */
  testHooks?: {
    providerSpy?: ProviderSpy;
    abortAfterQuoteConsumed?: () => void;
  };
  /** Test-only: recorded JSON-RPC for N5 so CI never hits the network. */
  lookupFetch?: LookupFetch;
};

export async function buildApp({
  db,
  clock,
  config,
  getWorkerLastTickAt,
  getSimRecords,
  onCrashAfterCommit,
  testHooks,
  lookupFetch,
}: BuildAppOptions) {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      redact: ['*.bankAccountToken', 'req.headers["idempotency-key"]'],
    },
  });

  // Keep the exact JSON bytes for webhook HMAC (`timestamp.body`).
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, done) => {
    const raw = typeof body === 'string' ? body : String(body);
    (request as FastifyRequest & { rawBody?: string }).rawBody = raw;
    try {
      done(null, JSON.parse(raw) as unknown);
    } catch (err) {
      done(err as Error, undefined);
    }
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

  app.addHook('onRequest', async (request, reply) => {
    if (!getFlags()['client.readsFail']) return;
    const path = request.url.split('?')[0] ?? request.url;
    if (request.method === 'GET' && (path === '/payouts' || path.startsWith('/payouts/'))) {
      return reply.code(503).send({
        error: 'simulated_outage',
        message: 'Simulated read outage',
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
    ...(onCrashAfterCommit ? { onCrashAfterCommit } : {}),
    ...(testHooks?.providerSpy ? { providerSpy: testHooks.providerSpy } : {}),
    ...(testHooks?.abortAfterQuoteConsumed
      ? { abortAfterQuoteConsumed: testHooks.abortAfterQuoteConsumed }
      : {}),
    ...(lookupFetch ? { lookupFetch } : {}),
  });
  registerLedgerRoutes(app, db);
  registerWebhookRoutes(app, { db, clock, config });

  if (config.OPS_ENABLED) {
    registerOpsRoutes(app, {
      db,
      clock,
      config,
      getWorkerLastTickAt: getWorkerLastTickAt ?? (() => null),
    });
    registerReconciliationRoute(app, {
      db,
      getRecords:
        getSimRecords ??
        (() => ({
          collect: new Map(),
          chain: new Map(),
          offramp: new Map(),
          refund: new Map(),
        })),
    });
  }

  return app;
}
