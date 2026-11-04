import type { PayoutStatus } from '@payout/shared';
import type { Clock } from '../clock.ts';
import type { AppConfig } from '../config.ts';
import type { Db } from '../db/open.ts';

const FINAL_LEG = new Set(['waiting', 'succeeded', 'failed', 'final']);

export function buildOpsSummary(
  db: Db,
  clock: Clock,
  config: AppConfig,
  workerLastTickAt: Date | null,
): {
  payoutsByStatus: Record<PayoutStatus, number>;
  idempotentReplays: number;
  conflicts409: number;
  expired410: number;
  webhooksIgnoredDuplicate: number;
  webhooksIgnoredStale: number;
  refusedTransitions: number;
  outboxPending: number;
  outboxOldestAgeMs: number | null;
  workerLastTickAt: string | null;
  stuck: Array<{ payoutId: string; leg: string; status: string; ageMs: number }>;
} {
  const statusRows = db
    .prepare(`SELECT status, COUNT(*) AS n FROM payouts GROUP BY status`)
    .all() as Array<{ status: PayoutStatus; n: number }>;

  const payoutsByStatus = {
    created: 0,
    collecting: 0,
    transferring: 0,
    paying_out: 0,
    delivered: 0,
    failed: 0,
    refunding: 0,
    refunded: 0,
  } as Record<PayoutStatus, number>;
  for (const row of statusRows) {
    payoutsByStatus[row.status] = row.n;
  }

  const countMessage = (like: string): number => {
    const row = db
      .prepare(`SELECT COUNT(*) AS n FROM ops_events WHERE message LIKE @like`)
      .get({ like }) as { n: number };
    return row.n;
  };

  const now = clock.now().getTime();
  const pending = db
    .prepare(
      `SELECT id, created_at FROM outbox WHERE sent_at IS NULL ORDER BY created_at ASC, id ASC`,
    )
    .all() as Array<{ id: number; created_at: string }>;

  const oldest = pending[0];
  const outboxOldestAgeMs = oldest ? Math.max(0, now - Date.parse(oldest.created_at)) : null;

  const legs = db
    .prepare(
      `SELECT payout_id, leg, status, updated_at FROM payout_legs
       WHERE status NOT IN ('waiting', 'succeeded', 'failed', 'final')`,
    )
    .all() as Array<{ payout_id: string; leg: string; status: string; updated_at: string }>;

  const stuck = legs
    .map((leg) => {
      const ageMs = Math.max(0, now - Date.parse(leg.updated_at));
      const isChecking = leg.status === 'checking';
      const isOld = !FINAL_LEG.has(leg.status) && ageMs >= config.STUCK_AFTER_MS;
      if (!isChecking && !isOld) return null;
      return {
        payoutId: leg.payout_id,
        leg: leg.leg,
        status: leg.status,
        ageMs,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  return {
    payoutsByStatus,
    idempotentReplays: countMessage('idempotent replay%'),
    conflicts409: countMessage('%idempotency_conflict%') + countMessage('idempotency conflict%'),
    expired410: countMessage('quote_expired%') + countMessage('%quote expired%'),
    webhooksIgnoredDuplicate: countMessage('ignored duplicate%'),
    webhooksIgnoredStale: countMessage('ignored stale%'),
    refusedTransitions: countMessage('refused transition%'),
    outboxPending: pending.length,
    outboxOldestAgeMs,
    workerLastTickAt: workerLastTickAt ? workerLastTickAt.toISOString() : null,
    stuck,
  };
}
