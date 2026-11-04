import type { PayoutStatus } from '@payout/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { Clock } from '../clock.ts';
import type { Db } from '../db/open.ts';
import { recordEvent } from '../ops/events.ts';

export type TransitionTrigger =
  | 'collect.request sent'
  | 'collect succeeded'
  | 'collect declined'
  | 'transfer final'
  | 'transfer cannot complete'
  | 'deposit succeeded'
  | 'deposit rejected'
  | 'refund succeeded';

export type TransitionRule = {
  from: PayoutStatus;
  to: PayoutStatus;
  trigger: TransitionTrigger;
};

export const TRANSITIONS: readonly TransitionRule[] = [
  { from: 'created', to: 'collecting', trigger: 'collect.request sent' },
  { from: 'collecting', to: 'transferring', trigger: 'collect succeeded' },
  { from: 'collecting', to: 'failed', trigger: 'collect declined' },
  { from: 'transferring', to: 'paying_out', trigger: 'transfer final' },
  { from: 'transferring', to: 'refunding', trigger: 'transfer cannot complete' },
  { from: 'paying_out', to: 'delivered', trigger: 'deposit succeeded' },
  { from: 'paying_out', to: 'refunding', trigger: 'deposit rejected' },
  { from: 'refunding', to: 'refunded', trigger: 'refund succeeded' },
] as const;

export const FINAL_STATUSES: ReadonlySet<PayoutStatus> = new Set([
  'delivered',
  'failed',
  'refunded',
]);

export class IllegalTransition extends Error {
  readonly from: PayoutStatus;
  readonly to: PayoutStatus;
  readonly trigger: string;

  constructor(from: PayoutStatus, to: PayoutStatus, trigger: string) {
    super(`Illegal transition ${from} → ${to} (${trigger})`);
    this.name = 'IllegalTransition';
    this.from = from;
    this.to = to;
    this.trigger = trigger;
  }
}

type PayoutRow = {
  id: string;
  status: PayoutStatus;
  updated_at: string;
  finished_at: string | null;
};

export function transition(
  db: Db,
  clock: Clock,
  log: FastifyBaseLogger,
  payoutId: string,
  to: PayoutStatus,
  trigger: TransitionTrigger,
): PayoutRow {
  const row = db
    .prepare(`SELECT id, status, updated_at, finished_at FROM payouts WHERE id = @id`)
    .get({
      id: payoutId,
    }) as PayoutRow | undefined;

  if (!row) {
    throw new Error(`Payout not found: ${payoutId}`);
  }

  const from = row.status;
  const allowed = TRANSITIONS.some(
    (rule) => rule.from === from && rule.to === to && rule.trigger === trigger,
  );
  const at = clock.now().toISOString();

  if (!allowed) {
    recordEvent(db, log, {
      kind: 'state',
      level: 'warn',
      at,
      payoutId,
      message: `refused transition ${from} → ${to}`,
      data: { from, to, trigger, refused: true },
    });
    throw new IllegalTransition(from, to, trigger);
  }

  const finishedAt = FINAL_STATUSES.has(to) ? at : null;
  db.prepare(
    `UPDATE payouts
     SET status = @status, updated_at = @updated_at, finished_at = @finished_at
     WHERE id = @id`,
  ).run({
    id: payoutId,
    status: to,
    updated_at: at,
    finished_at: finishedAt,
  });

  recordEvent(db, log, {
    kind: 'state',
    level: 'info',
    at,
    payoutId,
    message: `${from} → ${to}`,
    data: { from, to, trigger },
  });

  return {
    id: payoutId,
    status: to,
    updated_at: at,
    finished_at: finishedAt,
  };
}
