import { randomBytes } from 'node:crypto';
import type { Db } from '../db/open.ts';

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

export function randomBase32(length: number): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += BASE32[(bytes[i] ?? 0) % 32];
  }
  return out;
}

export function quoteId(): string {
  return `q_${randomBase32(12)}`;
}

export function nextPayoutId(db: Db): string {
  const row = db.prepare(`SELECT value FROM meta WHERE key = 'next_payout_number'`).get() as
    | { value: string }
    | undefined;
  const n = row ? Number(row.value) : 1041;
  const id = `PO-${n}`;
  db.prepare(
    `INSERT INTO meta (key, value) VALUES ('next_payout_number', @value)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run({ value: String(n + 1) });
  return id;
}

export function providerRef(
  payoutId: string,
  leg: 'collect' | 'transfer' | 'deposit' | 'refund',
): string {
  const letter = { collect: 'C', transfer: 'T', deposit: 'D', refund: 'R' }[leg];
  return `${payoutId}-${letter}1`;
}
