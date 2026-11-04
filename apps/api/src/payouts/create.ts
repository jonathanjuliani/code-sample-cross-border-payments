import { CreatePayoutRequestSchema } from '@payout/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { Clock } from '../clock.ts';
import type { AppConfig } from '../config.ts';
import type { Db } from '../db/open.ts';
import { recordEvent } from '../ops/events.ts';
import { insertOutbox } from '../outbox/write.ts';
import { expireDue } from '../quotes/expire.ts';
import { bodyHash } from '../util/canonical-json.ts';
import { nextPayoutId, providerRef } from '../util/ids.ts';
import { type LegRow, type PayoutRow, serializePayout } from './serialize.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ProviderSpy = {
  submitCalls: number;
};

export type CreatePayoutOptions = {
  db: Db;
  clock: Clock;
  config: AppConfig;
  log: FastifyBaseLogger;
  idempotencyKey: string | undefined;
  body: unknown;
  /** Test hook: throw inside the transaction to prove atomicity. */
  abortAfterQuoteConsumed?: () => void;
  /** Phase 2 seam: providers are never called on create. */
  providerSpy?: ProviderSpy;
};

export type CreatePayoutResult = {
  status: number;
  body: unknown;
};

type QuoteRow = {
  id: string;
  recipient_id: string;
  send_minor: number;
  fee_minor: number;
  convert_minor: number;
  receive_minor: number;
  expires_at: string;
  status: string;
  payout_id: string | null;
};

function storeIdempotency(
  db: Db,
  key: string,
  hash: string,
  payoutId: string | null,
  status: number,
  body: unknown,
  createdAt: string,
): void {
  db.prepare(
    `INSERT INTO idempotency_keys (key, body_hash, payout_id, response_status, response_body, created_at)
     VALUES (@key, @body_hash, @payout_id, @response_status, @response_body, @created_at)`,
  ).run({
    key,
    body_hash: hash,
    payout_id: payoutId,
    response_status: status,
    response_body: JSON.stringify(body),
    created_at: createdAt,
  });
}

function loadLegs(db: Db, payoutId: string): LegRow[] {
  return db
    .prepare(
      `SELECT payout_id, leg, status, attempt, provider_ref, tx_hash, confirmations, last_seq, updated_at
       FROM payout_legs WHERE payout_id = @id ORDER BY leg`,
    )
    .all({ id: payoutId }) as LegRow[];
}

export function createPayout(opts: CreatePayoutOptions): CreatePayoutResult {
  const { db, clock, log, idempotencyKey, body, abortAfterQuoteConsumed, providerSpy } = opts;

  if (!idempotencyKey || !UUID_RE.test(idempotencyKey)) {
    return {
      status: 400,
      body: {
        error: 'missing_idempotency_key',
        message: 'Idempotency-Key header must be a UUID',
      },
    };
  }

  const parsed = CreatePayoutRequestSchema.safeParse(body);
  if (!parsed.success) {
    return {
      status: 400,
      body: {
        error: 'validation_failed',
        message: 'Invalid payout request',
        issues: parsed.error.issues,
      },
    };
  }

  // Providers are never called inside create (T3).
  if (providerSpy) {
    // Intentionally unused: create must not call submit.
  }

  const hash = bodyHash(parsed.data);

  return db.transaction((): CreatePayoutResult => {
    const nowIso = clock.now().toISOString();

    const existing = db
      .prepare(
        `SELECT body_hash, payout_id, response_status, response_body
         FROM idempotency_keys WHERE key = @key`,
      )
      .get({ key: idempotencyKey }) as
      | {
          body_hash: string;
          payout_id: string | null;
          response_status: number;
          response_body: string;
        }
      | undefined;

    if (existing) {
      if (existing.body_hash !== hash) {
        return {
          status: 409,
          body: {
            error: 'idempotency_conflict',
            message: 'Idempotency-Key was reused with a different body',
          },
        };
      }
      recordEvent(db, log, {
        kind: 'api',
        level: 'info',
        at: nowIso,
        payoutId: existing.payout_id,
        message: 'idempotent replay',
        data: { key: idempotencyKey },
      });
      // First success is stored as 201; replays answer 200 with the same body (PLAN §7).
      const status = existing.response_status === 201 ? 200 : existing.response_status;
      return {
        status,
        body: JSON.parse(existing.response_body) as unknown,
      };
    }

    expireDue(db, clock, log);

    const quote = db
      .prepare(
        `SELECT id, recipient_id, send_minor, fee_minor, convert_minor, receive_minor,
                expires_at, status, payout_id
         FROM quotes WHERE id = @id`,
      )
      .get({ id: parsed.data.quoteId }) as QuoteRow | undefined;

    if (!quote) {
      const result = {
        status: 404,
        body: { error: 'not_found', message: 'Quote not found' },
      };
      storeIdempotency(db, idempotencyKey, hash, null, result.status, result.body, nowIso);
      return result;
    }

    if (quote.status === 'consumed' || quote.payout_id) {
      const result = {
        status: 409,
        body: {
          error: 'quote_used',
          message: 'Quote was already used by another payout',
          payoutId: quote.payout_id,
        },
      };
      storeIdempotency(
        db,
        idempotencyKey,
        hash,
        quote.payout_id,
        result.status,
        result.body,
        nowIso,
      );
      return result;
    }

    if (quote.status === 'expired' || clock.now().getTime() >= Date.parse(quote.expires_at)) {
      if (quote.status === 'active') {
        db.prepare(`UPDATE quotes SET status = 'expired' WHERE id = @id`).run({ id: quote.id });
      }
      const result = {
        status: 410,
        body: {
          error: 'quote_expired',
          message: 'Quote expired before confirmation',
        },
      };
      storeIdempotency(db, idempotencyKey, hash, null, result.status, result.body, nowIso);
      return result;
    }

    const payoutId = nextPayoutId(db);
    const createdAt = clock.now().toISOString();

    db.prepare(`UPDATE quotes SET status = 'consumed', payout_id = @payout_id WHERE id = @id`).run({
      id: quote.id,
      payout_id: payoutId,
    });

    abortAfterQuoteConsumed?.();

    db.prepare(
      `INSERT INTO payouts (
         id, quote_id, recipient_id, send_minor, fee_minor, convert_minor, receive_minor,
         status, failure_reason, created_at, updated_at, finished_at
       ) VALUES (
         @id, @quote_id, @recipient_id, @send_minor, @fee_minor, @convert_minor, @receive_minor,
         'created', NULL, @created_at, @updated_at, NULL
       )`,
    ).run({
      id: payoutId,
      quote_id: quote.id,
      recipient_id: quote.recipient_id,
      send_minor: quote.send_minor,
      fee_minor: quote.fee_minor,
      convert_minor: quote.convert_minor,
      receive_minor: quote.receive_minor,
      created_at: createdAt,
      updated_at: createdAt,
    });

    const insertLeg = db.prepare(
      `INSERT INTO payout_legs (
         payout_id, leg, status, attempt, provider_ref, tx_hash, confirmations, last_seq, updated_at
       ) VALUES (
         @payout_id, @leg, 'waiting', 0, @provider_ref, NULL, NULL, 0, @updated_at
       )`,
    );

    for (const leg of ['collect', 'transfer', 'deposit', 'refund'] as const) {
      insertLeg.run({
        payout_id: payoutId,
        leg,
        provider_ref: providerRef(payoutId, leg),
        updated_at: createdAt,
      });
    }

    insertOutbox(db, {
      payoutId,
      kind: 'collect.request',
      createdAt,
      payload: {
        payoutId,
        leg: 'collect',
        providerRef: providerRef(payoutId, 'collect'),
        amountMinor: quote.send_minor,
      },
    });

    const payout = db
      .prepare(`SELECT * FROM payouts WHERE id = @id`)
      .get({ id: payoutId }) as PayoutRow;
    const legs = loadLegs(db, payoutId);
    const responseBody = serializePayout(payout, legs);

    storeIdempotency(db, idempotencyKey, hash, payoutId, 201, responseBody, createdAt);

    recordEvent(db, log, {
      kind: 'api',
      level: 'info',
      at: createdAt,
      payoutId,
      message: `payout ${payoutId} created`,
      data: { quoteId: quote.id },
    });

    return { status: 201, body: responseBody };
  })();
}
