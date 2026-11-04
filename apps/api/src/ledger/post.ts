import type { FastifyBaseLogger } from 'fastify';
import type { Clock } from '../clock.ts';
import type { Db } from '../db/open.ts';
import { recordEvent } from '../ops/events.ts';
import { randomBase32 } from '../util/ids.ts';
import { ACCOUNTS_BY_CURRENCY, type LedgerCurrency } from './accounts.ts';

export type JournalLeg = {
  currency: LedgerCurrency;
  from: string;
  to: string;
  amountMinor: number;
};

export type SignedRow = {
  currency: LedgerCurrency;
  account: string;
  amountMinor: number;
};

export class LedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerError';
  }
}

function journalId(): string {
  return `j_${randomBase32(12)}`;
}

function entryId(): string {
  return `le_${randomBase32(12)}`;
}

/** Write signed rows after validating per-currency zero-sum and accounts. */
export function postSignedJournal(
  db: Db,
  clock: Clock,
  log: FastifyBaseLogger,
  payoutId: string,
  memo: string,
  rows: SignedRow[],
): string {
  if (rows.length === 0) {
    throw new LedgerError('journal has no entries');
  }

  const sums = new Map<LedgerCurrency, number>();
  for (const row of rows) {
    if (!Number.isInteger(row.amountMinor) || row.amountMinor === 0) {
      throw new LedgerError(`amount must be a non-zero integer, got ${row.amountMinor}`);
    }
    const allowed = ACCOUNTS_BY_CURRENCY[row.currency];
    if (!allowed.has(row.account)) {
      throw new LedgerError(`account ${row.account} is not valid for ${row.currency}`);
    }
    sums.set(row.currency, (sums.get(row.currency) ?? 0) + row.amountMinor);
  }

  for (const [currency, sum] of sums) {
    if (sum !== 0) {
      throw new LedgerError(`journal for ${currency} does not sum to zero (${sum})`);
    }
  }

  const jid = journalId();
  const at = clock.now().toISOString();
  const insert = db.prepare(
    `INSERT INTO ledger_entries
       (id, payout_id, journal_id, account, currency, amount_minor, memo, created_at)
     VALUES
       (@id, @payout_id, @journal_id, @account, @currency, @amount_minor, @memo, @created_at)`,
  );

  for (const row of rows) {
    insert.run({
      id: entryId(),
      payout_id: payoutId,
      journal_id: jid,
      account: row.account,
      currency: row.currency,
      amount_minor: row.amountMinor,
      memo,
      created_at: at,
    });
  }

  recordEvent(db, log, {
    kind: 'ledger',
    level: 'info',
    at,
    payoutId,
    message: memo,
    data: { journalId: jid, entryCount: rows.length },
  });

  return jid;
}

/**
 * Post a balanced journal: each leg becomes two signed rows under one journal_id.
 * Throws before writing if validation fails.
 */
export function postJournal(
  db: Db,
  clock: Clock,
  log: FastifyBaseLogger,
  payoutId: string,
  memo: string,
  entries: JournalLeg[],
): string {
  if (entries.length === 0) {
    throw new LedgerError('journal has no entries');
  }

  const rows: SignedRow[] = [];
  for (const entry of entries) {
    if (!Number.isInteger(entry.amountMinor) || entry.amountMinor <= 0) {
      throw new LedgerError(`amount must be a positive integer, got ${entry.amountMinor}`);
    }
    rows.push({
      currency: entry.currency,
      account: entry.from,
      amountMinor: -entry.amountMinor,
    });
    rows.push({
      currency: entry.currency,
      account: entry.to,
      amountMinor: entry.amountMinor,
    });
  }

  return postSignedJournal(db, clock, log, payoutId, memo, rows);
}
