import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { seedIfEmpty } from '../seed/seed.ts';
import { buildApp } from './app.ts';
import { createSystemClock } from './clock.ts';
import { loadConfig } from './config.ts';
import { openDb } from './db/open.ts';

const config = loadConfig();
if (config.DB_PATH !== ':memory:') {
  mkdirSync(dirname(config.DB_PATH), { recursive: true });
}

const db = openDb(config.DB_PATH);
seedIfEmpty(db);

const app = await buildApp({
  db,
  clock: createSystemClock(),
  config,
});

await app.listen({ port: config.PORT, host: '0.0.0.0' });
