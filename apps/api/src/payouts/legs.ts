import type { Db } from '../db/open.ts';
import type { LegRow } from './serialize.ts';

/** Load payout legs in collect → transfer → deposit → refund order. */
export function loadLegs(db: Db, payoutId: string): LegRow[] {
  return db
    .prepare(
      `SELECT payout_id, leg, status, attempt, provider_ref, tx_hash, confirmations, last_seq, updated_at
       FROM payout_legs WHERE payout_id = @id
       ORDER BY CASE leg
         WHEN 'collect' THEN 1
         WHEN 'transfer' THEN 2
         WHEN 'deposit' THEN 3
         WHEN 'refund' THEN 4
       END`,
    )
    .all({ id: payoutId }) as LegRow[];
}
