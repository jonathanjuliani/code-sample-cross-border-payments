import type { LegName, LegStatus, PayoutStatus } from '@payout/shared';

export type PayoutRow = {
  id: string;
  quote_id: string;
  recipient_id: string;
  send_minor: number;
  fee_minor: number;
  convert_minor: number;
  receive_minor: number;
  status: PayoutStatus;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
};

export type LegRow = {
  payout_id: string;
  leg: LegName;
  status: LegStatus;
  attempt: number;
  provider_ref: string | null;
  tx_hash: string | null;
  confirmations: number | null;
  last_seq: number;
  updated_at: string;
};

export function serializeLeg(row: LegRow, slow = false) {
  return {
    leg: row.leg,
    status: row.status,
    attempt: row.attempt,
    providerRef: row.provider_ref,
    txHash: row.tx_hash,
    confirmations: row.confirmations,
    lastSeq: row.last_seq,
    updatedAt: row.updated_at,
    slow,
  };
}

export function serializePayout(row: PayoutRow, legs: LegRow[]) {
  return {
    id: row.id,
    quoteId: row.quote_id,
    recipientId: row.recipient_id,
    sendMinor: row.send_minor,
    feeMinor: row.fee_minor,
    convertMinor: row.convert_minor,
    receiveMinor: row.receive_minor,
    status: row.status,
    failureReason: row.failure_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at,
    legs: legs.map((leg) => serializeLeg(leg)),
  };
}

export function serializePayoutListItem(row: PayoutRow, legs: LegRow[]) {
  return {
    id: row.id,
    recipientId: row.recipient_id,
    sendMinor: row.send_minor,
    receiveMinor: row.receive_minor,
    status: row.status,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
    legs: legs.map((leg) => ({ leg: leg.leg, status: leg.status })),
  };
}
