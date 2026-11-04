import type { Db } from '../db/open.ts';

export function balances(db: Db, payoutId: string): Record<string, number> {
  const rows = db
    .prepare(
      `SELECT account || ':' || currency AS key, SUM(amount_minor) AS total
       FROM ledger_entries
       WHERE payout_id = @payout_id
       GROUP BY account, currency`,
    )
    .all({ payout_id: payoutId }) as Array<{ key: string; total: number }>;

  const out: Record<string, number> = {};
  for (const row of rows) {
    out[row.key] = row.total;
  }
  return out;
}

export function journalSums(db: Db, payoutId: string): Record<string, number> {
  const rows = db
    .prepare(
      `SELECT currency, SUM(amount_minor) AS total
       FROM ledger_entries
       WHERE payout_id = @payout_id
       GROUP BY currency`,
    )
    .all({ payout_id: payoutId }) as Array<{ currency: string; total: number }>;

  const out: Record<string, number> = {};
  for (const row of rows) {
    out[row.currency] = row.total;
  }
  return out;
}

export function accountBalance(
  db: Db,
  payoutId: string,
  account: string,
  currency: string,
): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(amount_minor), 0) AS total
       FROM ledger_entries
       WHERE payout_id = @payout_id AND account = @account AND currency = @currency`,
    )
    .get({ payout_id: payoutId, account, currency }) as { total: number };
  return row.total;
}

export function assertBalanced(db: Db, payoutId: string): void {
  const sums = journalSums(db, payoutId);
  for (const [currency, total] of Object.entries(sums)) {
    if (total !== 0) {
      throw new Error(`ledger for ${payoutId} ${currency} sums to ${total}, not zero`);
    }
  }
}
