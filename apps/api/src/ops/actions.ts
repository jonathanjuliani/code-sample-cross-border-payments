import type { FastifyBaseLogger } from 'fastify';
import type { Clock } from '../clock.ts';
import type { Db } from '../db/open.ts';
import { insertOutbox, type OutboxKind } from '../outbox/write.ts';
import { recordEvent } from './events.ts';

const LEGS = new Set(['collect', 'transfer', 'deposit', 'refund']);

function requestKindForLeg(leg: string): OutboxKind {
  switch (leg) {
    case 'collect':
      return 'collect.request';
    case 'transfer':
      return 'transfer.request';
    case 'deposit':
      return 'deposit.request';
    case 'refund':
      return 'refund.request';
    default:
      throw new Error(`unknown leg ${leg}`);
  }
}

/** Queue a due-now status.query for a checking leg. Does not change payout or leg state. */
export function queueStatusQuery(
  db: Db,
  clock: Clock,
  log: FastifyBaseLogger,
  payoutId: string,
  leg: string,
):
  | { ok: true; outboxId: number }
  | { ok: false; error: 'not_found' | 'not_checking' | 'no_provider_ref' | 'bad_leg' } {
  if (!LEGS.has(leg)) {
    return { ok: false, error: 'bad_leg' };
  }

  const payout = db.prepare(`SELECT id FROM payouts WHERE id = @id`).get({ id: payoutId }) as
    | { id: string }
    | undefined;
  if (!payout) {
    return { ok: false, error: 'not_found' };
  }

  const row = db
    .prepare(
      `SELECT status, provider_ref, updated_at FROM payout_legs
       WHERE payout_id = @id AND leg = @leg`,
    )
    .get({ id: payoutId, leg }) as
    | { status: string; provider_ref: string | null; updated_at: string }
    | undefined;

  if (!row) {
    return { ok: false, error: 'not_found' };
  }
  if (row.status !== 'checking') {
    return { ok: false, error: 'not_checking' };
  }
  if (!row.provider_ref) {
    return { ok: false, error: 'no_provider_ref' };
  }

  const at = clock.now().toISOString();
  let outboxId = 0;
  db.transaction(() => {
    insertOutbox(db, {
      payoutId,
      kind: 'status.query',
      createdAt: at,
      dueAt: null,
      payload: {
        payoutId,
        leg,
        providerRef: row.provider_ref,
        checkingSince: row.updated_at,
        backoffIndex: 0,
        requestKind: requestKindForLeg(leg),
        source: 'ops',
      },
    });
    const last = db.prepare(`SELECT last_insert_rowid() AS id`).get() as { id: number };
    outboxId = last.id;
    recordEvent(db, log, {
      kind: 'api',
      level: 'info',
      at,
      payoutId,
      message: `re-run status query for ${leg}`,
      data: { leg, providerRef: row.provider_ref, outboxId },
    });
  })();

  return { ok: true, outboxId };
}

/** Set flagged_at once. Does not change payout status or ledger. */
export function flagPayoutForReview(
  db: Db,
  clock: Clock,
  log: FastifyBaseLogger,
  payoutId: string,
): { ok: true; flaggedAt: string } | { ok: false; error: 'not_found' } {
  const row = db.prepare(`SELECT flagged_at FROM payouts WHERE id = @id`).get({ id: payoutId }) as
    | { flagged_at: string | null }
    | undefined;
  if (!row) {
    return { ok: false, error: 'not_found' };
  }

  if (row.flagged_at) {
    return { ok: true, flaggedAt: row.flagged_at };
  }

  const at = clock.now().toISOString();
  db.transaction(() => {
    db.prepare(`UPDATE payouts SET flagged_at = @at WHERE id = @id`).run({
      id: payoutId,
      at,
    });
    recordEvent(db, log, {
      kind: 'api',
      level: 'info',
      at,
      payoutId,
      message: 'flagged for review',
      data: { flaggedAt: at },
    });
  })();

  return { ok: true, flaggedAt: at };
}
