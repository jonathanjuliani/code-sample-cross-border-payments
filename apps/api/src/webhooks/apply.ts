import type { LegName, LegStatus, WebhookEvent } from '@payout/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { Clock } from '../clock.ts';
import type { Db } from '../db/open.ts';
import {
  onCollectSucceeded,
  onDepositRejected,
  onDepositSucceeded,
  onRefundSucceeded,
  onTransferFinal,
  type PayoutAmounts,
} from '../ledger/postings.ts';
import { insertOutbox } from '../outbox/write.ts';
import { IllegalTransition, transition } from '../payouts/machine.ts';
import { providerRef } from '../util/ids.ts';

type LegRow = {
  payout_id: string;
  leg: LegName;
  status: string;
  attempt: number;
  provider_ref: string | null;
  last_seq: number;
};

function loadPayout(db: Db, payoutId: string): PayoutAmounts {
  return db
    .prepare(
      `SELECT id, send_minor, fee_minor, convert_minor, receive_minor FROM payouts WHERE id = @id`,
    )
    .get({ id: payoutId }) as PayoutAmounts;
}

function updateLeg(
  db: Db,
  payoutId: string,
  leg: LegName,
  patch: {
    status: string;
    lastSeq: number;
    confirmations?: number | null;
    txHash?: string | null;
    updatedAt: string;
  },
): void {
  db.prepare(
    `UPDATE payout_legs
     SET status = @status,
         last_seq = @last_seq,
         confirmations = COALESCE(@confirmations, confirmations),
         tx_hash = COALESCE(@tx_hash, tx_hash),
         updated_at = @updated_at
     WHERE payout_id = @payout_id AND leg = @leg`,
  ).run({
    payout_id: payoutId,
    leg,
    status: patch.status,
    last_seq: patch.lastSeq,
    confirmations: patch.confirmations ?? null,
    tx_hash: patch.txHash ?? null,
    updated_at: patch.updatedAt,
  });
}

function nextRequest(
  db: Db,
  payout: PayoutAmounts,
  kind: 'transfer.request' | 'deposit.request' | 'refund.request',
  leg: LegName,
  at: string,
): void {
  insertOutbox(db, {
    payoutId: payout.id,
    kind,
    createdAt: at,
    payload: {
      payoutId: payout.id,
      leg,
      providerRef: providerRef(payout.id, leg),
      amountMinor:
        leg === 'collect'
          ? payout.send_minor
          : leg === 'refund'
            ? payout.send_minor
            : payout.convert_minor,
    },
  });
}

/** Apply a provider status event to a leg / payout / ledger. Caller owns the transaction. */
export function applyProviderEvent(
  db: Db,
  clock: Clock,
  log: FastifyBaseLogger,
  event: WebhookEvent,
): { applied: true } | { ignored: 'stale' } {
  const legRow = db
    .prepare(`SELECT * FROM payout_legs WHERE provider_ref = @ref`)
    .get({ ref: event.providerRef }) as LegRow | undefined;

  if (!legRow) {
    throw new Error(`unknown provider_ref ${event.providerRef}`);
  }
  if (legRow.leg !== event.leg) {
    throw new Error(`leg mismatch for ${event.providerRef}`);
  }

  if (event.seq <= legRow.last_seq) {
    return { ignored: 'stale' };
  }

  const at = clock.now().toISOString();
  const payout = loadPayout(db, legRow.payout_id);
  const detail = event.detail ?? {};
  const confirmations = typeof detail.confirmations === 'number' ? detail.confirmations : null;
  const txHash = typeof detail.txHash === 'string' ? detail.txHash : null;
  const rateMoved = detail.rateMoved === true;
  const networkFee = typeof detail.networkFeeMinor === 'number' ? detail.networkFeeMinor : 0;

  let legStatus: LegStatus | WebhookEvent['status'] = event.status;
  if (event.leg === 'collect' && event.status === 'declined') {
    legStatus = 'failed';
  }
  if (event.leg === 'deposit' && event.status === 'rejected') {
    legStatus = 'failed';
  }
  if (event.leg === 'collect' && event.status === 'succeeded') {
    legStatus = 'succeeded';
  }
  if (event.leg === 'deposit' && event.status === 'succeeded') {
    legStatus = 'succeeded';
  }
  if (event.leg === 'refund' && event.status === 'succeeded') {
    legStatus = 'succeeded';
  }

  updateLeg(db, legRow.payout_id, event.leg, {
    status: legStatus,
    lastSeq: event.seq,
    confirmations,
    txHash,
    updatedAt: at,
  });

  try {
    if (event.leg === 'collect' && event.status === 'succeeded') {
      transition(db, clock, log, payout.id, 'transferring', 'collect succeeded');
      onCollectSucceeded(db, clock, log, payout);
      nextRequest(db, payout, 'transfer.request', 'transfer', at);
    } else if (event.leg === 'collect' && event.status === 'declined') {
      transition(db, clock, log, payout.id, 'failed', 'collect declined');
      db.prepare(`UPDATE payouts SET failure_reason = 'collect_declined' WHERE id = @id`).run({
        id: payout.id,
      });
    } else if (event.leg === 'transfer' && event.status === 'final') {
      transition(db, clock, log, payout.id, 'paying_out', 'transfer final');
      onTransferFinal(db, clock, log, payout, networkFee);
      nextRequest(db, payout, 'deposit.request', 'deposit', at);
    } else if (event.leg === 'transfer' && event.status === 'dropped') {
      updateLeg(db, legRow.payout_id, 'transfer', {
        status: 'dropped',
        lastSeq: event.seq,
        updatedAt: at,
      });
      insertOutbox(db, {
        payoutId: payout.id,
        kind: 'transfer.request',
        createdAt: at,
        payload: {
          payoutId: payout.id,
          leg: 'transfer',
          providerRef: providerRef(payout.id, 'transfer'),
          amountMinor: payout.convert_minor,
          resubmit: true,
        },
      });
    } else if (event.leg === 'deposit' && event.status === 'succeeded') {
      transition(db, clock, log, payout.id, 'delivered', 'deposit succeeded');
      onDepositSucceeded(db, clock, log, payout, rateMoved);
    } else if (event.leg === 'deposit' && event.status === 'rejected') {
      transition(db, clock, log, payout.id, 'refunding', 'deposit rejected');
      db.prepare(`UPDATE payouts SET failure_reason = 'bank_details_rejected' WHERE id = @id`).run({
        id: payout.id,
      });
      onDepositRejected(db, clock, log, payout);
      nextRequest(db, payout, 'refund.request', 'refund', at);
    } else if (event.leg === 'refund' && event.status === 'succeeded') {
      transition(db, clock, log, payout.id, 'refunded', 'refund succeeded');
      onRefundSucceeded(db, clock, log, payout);
    }
  } catch (err) {
    if (err instanceof IllegalTransition) {
      throw err;
    }
    throw err;
  }

  return { applied: true };
}
