import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { seedIfEmpty } from '../seed/seed.ts';
import { buildApp } from './app.ts';
import { createSystemClock } from './clock.ts';
import { loadConfig } from './config.ts';
import { openDb } from './db/open.ts';
import { startWorker, type Worker } from './outbox/worker.ts';
import { createSimClientHints } from './providers/client-hints.ts';
import {
  bindFlagRecorder,
  consumeCrashAfterCommit,
  createRealSimScheduler,
  createSimBundle,
  loadFlagsFromEnv,
  setSimScheduler,
} from './providers/sim/index.ts';
import type { SimRecords } from './providers/sim/records.ts';
import { expireDue } from './quotes/expire.ts';

const config = loadConfig();
if (config.DB_PATH !== ':memory:') {
  mkdirSync(dirname(config.DB_PATH), { recursive: true });
}

const db = openDb(config.DB_PATH);
const clock = createSystemClock();
seedIfEmpty(db, clock);

loadFlagsFromEnv(config.SIM_FLAGS);
setSimScheduler(createRealSimScheduler());

let worker: Worker | null = null;
let simRecords: SimRecords = {
  collect: new Map(),
  chain: new Map(),
  offramp: new Map(),
  refund: new Map(),
};

const app = await buildApp({
  db,
  clock,
  config,
  clientHints: createSimClientHints(),
  getWorkerLastTickAt: () => worker?.lastTickAt() ?? null,
  getSimRecords: () => simRecords,
  onCrashAfterCommit: () => {
    if (!consumeCrashAfterCommit()) return;
    worker?.stop();
    // Compose restarts the process via restart: unless-stopped.
    process.exitCode = 1;
    void app.close().finally(() => {
      process.exit(1);
    });
  },
});

bindFlagRecorder(db, clock, app.log);

const sim = createSimBundle(app, {
  secret: config.WEBHOOK_SECRET,
  clock,
  chainProvider: config.CHAIN_PROVIDER,
});
simRecords = sim.records;

worker = startWorker({
  db,
  clock,
  log: app.log,
  config,
  providers: sim.providers,
  intervalMs: config.WORKER_INTERVAL_MS,
});

const expireTimer = setInterval(() => {
  try {
    expireDue(db, clock, app.log);
  } catch (err) {
    app.log.error({ err }, 'expireDue failed');
  }
}, 5_000);
expireTimer.unref?.();

app.addHook('onClose', async () => {
  worker?.stop();
  clearInterval(expireTimer);
});

await app.listen({ port: config.PORT, host: '0.0.0.0' });
