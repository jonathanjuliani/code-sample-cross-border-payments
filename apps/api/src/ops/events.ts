import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../db/open.ts';

export type OpsEventKind =
  | 'api'
  | 'db'
  | 'state'
  | 'webhook'
  | 'worker'
  | 'provider'
  | 'ledger'
  | 'sim';

export type OpsEventLevel = 'info' | 'warn' | 'error';

export type RecordEventInput = {
  kind: OpsEventKind;
  level: OpsEventLevel;
  at: string;
  payoutId?: string | null;
  message: string;
  data?: Record<string, unknown> | null;
};

const TRIM_EVERY = 500;
const KEEP = 5_000;

let insertsSinceTrim = 0;

/** Insert an ops_events row inside the caller's transaction and mirror it to pino. */
export function recordEvent(db: Db, log: FastifyBaseLogger, input: RecordEventInput): void {
  db.prepare(
    `INSERT INTO ops_events (at, kind, level, payout_id, message, data)
     VALUES (@at, @kind, @level, @payout_id, @message, @data)`,
  ).run({
    at: input.at,
    kind: input.kind,
    level: input.level,
    payout_id: input.payoutId ?? null,
    message: input.message,
    data: input.data == null ? null : JSON.stringify(input.data),
  });

  const fields = {
    kind: input.kind,
    payoutId: input.payoutId ?? undefined,
    ...(input.data ?? {}),
  };
  if (input.level === 'error') {
    log.error(fields, input.message);
  } else if (input.level === 'warn') {
    log.warn(fields, input.message);
  } else {
    log.info(fields, input.message);
  }

  insertsSinceTrim += 1;
  if (insertsSinceTrim >= TRIM_EVERY) {
    insertsSinceTrim = 0;
    db.prepare(
      `DELETE FROM ops_events
       WHERE id NOT IN (
         SELECT id FROM ops_events ORDER BY id DESC LIMIT ?
       )`,
    ).run(KEEP);
  }
}

/** Test helper: reset the trim counter between suites. */
export function resetOpsEventTrimCounter(): void {
  insertsSinceTrim = 0;
}
