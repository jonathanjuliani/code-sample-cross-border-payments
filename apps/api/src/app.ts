import Fastify from 'fastify';
import type { Clock } from './clock.ts';
import type { AppConfig } from './config.ts';
import type { Db } from './db/open.ts';

export type BuildAppOptions = {
  db: Db;
  clock: Clock;
  config: AppConfig;
};

export async function buildApp({ db: _db, clock: _clock, config }: BuildAppOptions) {
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

  return app;
}
