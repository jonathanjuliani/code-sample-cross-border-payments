import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { migrate } from '../src/db/migrate.ts';

describe('db migrate', () => {
  it('adds recipients.city on a pre-D16 database', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE recipients (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        country TEXT NOT NULL,
        currency TEXT NOT NULL,
        bank_account_masked TEXT NOT NULL,
        bank_account_token TEXT NOT NULL
      );
      INSERT INTO recipients (id, label, country, currency, bank_account_masked, bank_account_token)
      VALUES ('r1', 'Fabric supplier', 'MX', 'MXN', '****', 'tok');
    `);
    migrate(db);
    const cols = db.prepare(`PRAGMA table_info(recipients)`).all() as Array<{ name: string }>;
    expect(cols.some((c) => c.name === 'city')).toBe(true);
    const row = db.prepare(`SELECT city FROM recipients WHERE id = 'r1'`).get() as { city: string };
    expect(row.city).toBe('Monterrey');
  });

  it('adds outbox.due_at on a pre-D18 database', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE payouts (id TEXT PRIMARY KEY);
      CREATE TABLE outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        payout_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        sent_at TEXT,
        attempts INTEGER NOT NULL DEFAULT 0
      );
    `);
    migrate(db);
    const cols = db.prepare(`PRAGMA table_info(outbox)`).all() as Array<{ name: string }>;
    expect(cols.some((c) => c.name === 'due_at')).toBe(true);
  });

  it('adds payouts.flagged_at on a pre-N3 database', () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE payouts (id TEXT PRIMARY KEY)`);
    migrate(db);
    const cols = db.prepare(`PRAGMA table_info(payouts)`).all() as Array<{ name: string }>;
    expect(cols.some((c) => c.name === 'flagged_at')).toBe(true);
  });
});
