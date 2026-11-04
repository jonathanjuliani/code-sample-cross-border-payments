import type { Db } from '../db/open.ts';

export type OutboxKind =
  | 'collect.request'
  | 'transfer.request'
  | 'deposit.request'
  | 'refund.request'
  | 'status.query';

export function insertOutbox(
  db: Db,
  input: {
    payoutId: string;
    kind: OutboxKind;
    payload: Record<string, unknown>;
    createdAt: string;
    dueAt?: string | null;
  },
): void {
  db.prepare(
    `INSERT INTO outbox (payout_id, kind, payload, created_at, due_at, sent_at, attempts)
     VALUES (@payout_id, @kind, @payload, @created_at, @due_at, NULL, 0)`,
  ).run({
    payout_id: input.payoutId,
    kind: input.kind,
    payload: JSON.stringify(input.payload),
    created_at: input.createdAt,
    due_at: input.dueAt ?? null,
  });
}
