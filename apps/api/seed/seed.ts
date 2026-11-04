import { randomBytes } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import type { Clock } from '../src/clock.ts';
import type { Db } from '../src/db/open.ts';
import { onCollectSucceeded, onDepositSucceeded, onTransferFinal } from '../src/ledger/postings.ts';
import { providerRef } from '../src/util/ids.ts';

function opaqueToken(): string {
  return randomBytes(16).toString('hex');
}

const silentLog = {
  info() {},
  warn() {},
  error() {},
  debug() {},
  fatal() {},
  trace() {},
  child() {
    return silentLog;
  },
} as unknown as FastifyBaseLogger;

function seedDeliveredPayout(
  db: Db,
  _clock: Clock,
  input: {
    id: string;
    quoteId: string;
    recipientId: string;
    sendMinor: number;
    feeMinor: number;
    convertMinor: number;
    receiveMinor: number;
    createdAt: string;
    finishedAt: string;
  },
): void {
  db.prepare(
    `INSERT INTO quotes (
       id, recipient_id, mode, rate_e4, send_minor, fee_minor, convert_minor, receive_minor,
       created_at, expires_at, status, payout_id
     ) VALUES (
       @id, @recipient_id, 'receive', 172500, @send_minor, @fee_minor, @convert_minor, @receive_minor,
       @created_at, @expires_at, 'consumed', @payout_id
     )`,
  ).run({
    id: input.quoteId,
    recipient_id: input.recipientId,
    send_minor: input.sendMinor,
    fee_minor: input.feeMinor,
    convert_minor: input.convertMinor,
    receive_minor: input.receiveMinor,
    created_at: input.createdAt,
    expires_at: input.createdAt,
    payout_id: input.id,
  });

  db.prepare(
    `INSERT INTO payouts (
       id, quote_id, recipient_id, send_minor, fee_minor, convert_minor, receive_minor,
       status, failure_reason, created_at, updated_at, finished_at
     ) VALUES (
       @id, @quote_id, @recipient_id, @send_minor, @fee_minor, @convert_minor, @receive_minor,
       'delivered', NULL, @created_at, @finished_at, @finished_at
     )`,
  ).run({
    id: input.id,
    quote_id: input.quoteId,
    recipient_id: input.recipientId,
    send_minor: input.sendMinor,
    fee_minor: input.feeMinor,
    convert_minor: input.convertMinor,
    receive_minor: input.receiveMinor,
    created_at: input.createdAt,
    finished_at: input.finishedAt,
  });

  const insertLeg = db.prepare(
    `INSERT INTO payout_legs (
       payout_id, leg, status, attempt, provider_ref, tx_hash, confirmations, last_seq, updated_at
     ) VALUES (
       @payout_id, @leg, @status, 1, @provider_ref, @tx_hash, @confirmations, @last_seq, @updated_at
     )`,
  );

  insertLeg.run({
    payout_id: input.id,
    leg: 'collect',
    status: 'succeeded',
    provider_ref: providerRef(input.id, 'collect'),
    tx_hash: null,
    confirmations: null,
    last_seq: 2,
    updated_at: input.finishedAt,
  });
  insertLeg.run({
    payout_id: input.id,
    leg: 'transfer',
    status: 'final',
    provider_ref: providerRef(input.id, 'transfer'),
    tx_hash: `0xseed${input.id}`,
    confirmations: 3,
    last_seq: 4,
    updated_at: input.finishedAt,
  });
  insertLeg.run({
    payout_id: input.id,
    leg: 'deposit',
    status: 'succeeded',
    provider_ref: providerRef(input.id, 'deposit'),
    tx_hash: null,
    confirmations: null,
    last_seq: 2,
    updated_at: input.finishedAt,
  });
  insertLeg.run({
    payout_id: input.id,
    leg: 'refund',
    status: 'waiting',
    provider_ref: providerRef(input.id, 'refund'),
    tx_hash: null,
    confirmations: null,
    last_seq: 0,
    updated_at: input.createdAt,
  });

  const amounts = {
    id: input.id,
    send_minor: input.sendMinor,
    fee_minor: input.feeMinor,
    convert_minor: input.convertMinor,
    receive_minor: input.receiveMinor,
  };

  const fixedClock: Clock = { now: () => new Date(input.finishedAt) };
  onCollectSucceeded(db, fixedClock, silentLog, amounts);
  onTransferFinal(db, fixedClock, silentLog, amounts);
  onDepositSucceeded(db, fixedClock, silentLog, amounts);
}

export function seedIfEmpty(db: Db, clock: Clock = { now: () => new Date() }): void {
  const row = db.prepare('SELECT COUNT(*) AS n FROM recipients').get() as { n: number };
  if (row.n > 0) {
    return;
  }

  const insertRecipient = db.prepare(`
    INSERT INTO recipients (id, label, city, country, currency, bank_account_masked, bank_account_token)
    VALUES (@id, @label, @city, @country, @currency, @bank_account_masked, @bank_account_token)
  `);

  const insertMeta = db.prepare(`
    INSERT INTO meta (key, value) VALUES (@key, @value)
  `);

  const now = clock.now().getTime();
  const ago26h = new Date(now - 26 * 60 * 60 * 1000).toISOString();
  const ago3h = new Date(now - 3 * 60 * 60 * 1000).toISOString();

  const tx = db.transaction(() => {
    insertMeta.run({ key: 'funding_account_masked', value: '••••2290' });
    insertMeta.run({ key: 'next_payout_number', value: '1041' });

    insertRecipient.run({
      id: 'r1',
      label: 'Fabric supplier',
      city: 'Monterrey',
      country: 'MX',
      currency: 'MXN',
      bank_account_masked: '••••4821',
      bank_account_token: opaqueToken(),
    });
    insertRecipient.run({
      id: 'r2',
      label: 'Packaging supplier',
      city: 'Guadalajara',
      country: 'MX',
      currency: 'MXN',
      bank_account_masked: '••••0937',
      bank_account_token: opaqueToken(),
    });
    insertRecipient.run({
      id: 'r3',
      label: 'Freight agent',
      city: 'Veracruz',
      country: 'MX',
      currency: 'MXN',
      bank_account_masked: '••••5510',
      bank_account_token: opaqueToken(),
    });

    // PO-1039: r2, 48,200.00 MXN, 26 hours ago
    seedDeliveredPayout(db, clock, {
      id: 'PO-1039',
      quoteId: 'q_seed1039xxxx',
      recipientId: 'r2',
      sendMinor: 280_826,
      feeMinor: 1_405,
      convertMinor: 279_421,
      receiveMinor: 4_820_000,
      createdAt: ago26h,
      finishedAt: ago26h,
    });

    // PO-1040: r1, 310,000.00 MXN, 3 hours ago
    seedDeliveredPayout(db, clock, {
      id: 'PO-1040',
      quoteId: 'q_seed1040xxxx',
      recipientId: 'r1',
      sendMinor: 1_806_133,
      feeMinor: 9_031,
      convertMinor: 1_797_102,
      receiveMinor: 31_000_000,
      createdAt: ago3h,
      finishedAt: ago3h,
    });
  });

  tx();
}
