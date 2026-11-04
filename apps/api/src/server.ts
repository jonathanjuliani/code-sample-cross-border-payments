import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { seedIfEmpty } from '../seed/seed.ts';
import { buildApp } from './app.ts';
import { createSystemClock } from './clock.ts';
import { loadConfig } from './config.ts';
import { openDb } from './db/open.ts';
import { startWorker } from './outbox/worker.ts';
import { createInstantProvider } from './providers/types.ts';
import { expireDue } from './quotes/expire.ts';

const config = loadConfig();
if (config.DB_PATH !== ':memory:') {
  mkdirSync(dirname(config.DB_PATH), { recursive: true });
}

const db = openDb(config.DB_PATH);
const clock = createSystemClock();
seedIfEmpty(db, clock);

const app = await buildApp({
  db,
  clock,
  config,
});

const expireTimer = setInterval(() => {
  try {
    expireDue(db, clock, app.log);
  } catch (err) {
    app.log.error({ err }, 'expireDue failed');
  }
}, 5_000);
expireTimer.unref?.();

// Phase 3: instant providers stand in until the Phase 4 simulator.
// They accept submits; status events arrive via /webhooks in real runs / tests.
const instant = createInstantProvider();
const worker = startWorker({
  db,
  clock,
  log: app.log,
  config,
  providers: {
    collect: instant,
    transfer: instant,
    deposit: instant,
    refund: instant,
  },
  intervalMs: config.WORKER_INTERVAL_MS,
});

app.addHook('onClose', async () => {
  worker.stop();
  clearInterval(expireTimer);
});

await app.listen({ port: config.PORT, host: '0.0.0.0' });
