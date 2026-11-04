import type { Db } from './open.ts';

const SEED_CITIES: Record<string, string> = {
  r1: 'Monterrey',
  r2: 'Guadalajara',
  r3: 'Veracruz',
};

function columnNames(db: Db, table: string): Set<string> {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return new Set(cols.map((c) => c.name));
}

/** Idempotent upgrades for DBs created before a column existed (compose volumes). */
export function migrate(db: Db): void {
  const recipients = columnNames(db, 'recipients');
  if (recipients.size > 0 && !recipients.has('city')) {
    db.exec(`ALTER TABLE recipients ADD COLUMN city TEXT NOT NULL DEFAULT ''`);
  }
  if (columnNames(db, 'recipients').has('city')) {
    const update = db.prepare(`UPDATE recipients SET city = @city WHERE id = @id AND city = ''`);
    for (const [id, city] of Object.entries(SEED_CITIES)) {
      update.run({ id, city });
    }
  }

  const outbox = columnNames(db, 'outbox');
  if (outbox.size > 0 && !outbox.has('due_at')) {
    db.exec(`ALTER TABLE outbox ADD COLUMN due_at TEXT`);
  }

  const payouts = columnNames(db, 'payouts');
  if (payouts.size > 0 && !payouts.has('flagged_at')) {
    db.exec(`ALTER TABLE payouts ADD COLUMN flagged_at TEXT`);
  }
}
