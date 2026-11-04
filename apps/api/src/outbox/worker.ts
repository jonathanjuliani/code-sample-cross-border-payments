import type { FastifyBaseLogger } from 'fastify';
import type { Clock } from '../clock.ts';
import type { AppConfig } from '../config.ts';
import type { Db } from '../db/open.ts';
import { recordEvent } from '../ops/events.ts';
import { transition } from '../payouts/machine.ts';
import { markLegStarted } from '../providers/sim/timing.ts';
import { type Provider, type ProviderMap, ProviderTimeout } from '../providers/types.ts';
import { applyProviderEvent } from '../webhooks/apply.ts';
import { insertOutbox, type OutboxKind } from './write.ts';

type OutboxRow = {
  id: number;
  payout_id: string;
  kind: OutboxKind;
  payload: string;
  created_at: string;
  due_at: string | null;
  attempts: number;
};

export type Worker = {
  stop: () => void;
  tickOnce: () => Promise<void>;
  lastTickAt: () => Date | null;
};

function providerForKind(providers: ProviderMap, kind: OutboxKind): Provider | null {
  switch (kind) {
    case 'collect.request':
      return providers.collect;
    case 'transfer.request':
      return providers.transfer;
    case 'deposit.request':
      return providers.deposit;
    case 'refund.request':
      return providers.refund;
    case 'status.query':
      return null;
  }
}

function legFromKind(kind: OutboxKind): 'collect' | 'transfer' | 'deposit' | 'refund' {
  if (kind.startsWith('collect')) return 'collect';
  if (kind.startsWith('transfer')) return 'transfer';
  if (kind.startsWith('deposit')) return 'deposit';
  return 'refund';
}

function parsePayload(raw: string): {
  payoutId: string;
  leg: string;
  providerRef: string;
  amountMinor?: number;
  checkingSince?: string;
  backoffIndex?: number;
} {
  return JSON.parse(raw) as {
    payoutId: string;
    leg: string;
    providerRef: string;
    amountMinor?: number;
    checkingSince?: string;
    backoffIndex?: number;
  };
}

export function startWorker(opts: {
  db: Db;
  clock: Clock;
  log: FastifyBaseLogger;
  config: AppConfig;
  providers: ProviderMap;
  intervalMs?: number;
}): Worker {
  const { db, clock, log, config, providers } = opts;
  let lastTickAt: Date | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;
  let stopped = false;

  async function handleRequest(row: OutboxRow): Promise<void> {
    const payload = parsePayload(row.payload);
    const provider = providerForKind(providers, row.kind);
    if (!provider) return;

    const leg = legFromKind(row.kind);
    const at = clock.now().toISOString();

    try {
      const result = await provider.submit(payload.providerRef, payload);

      if ('declined' in result) {
        db.transaction(() => {
          markSent(db, row.id, at);
          db.prepare(
            `UPDATE payout_legs
             SET status = 'failed', attempt = attempt + 1, updated_at = @at
             WHERE payout_id = @payout_id AND leg = @leg`,
          ).run({ payout_id: row.payout_id, leg, at });

          if (leg === 'collect') {
            const status = db
              .prepare(`SELECT status FROM payouts WHERE id = @id`)
              .get({ id: row.payout_id }) as { status: string };
            if (status.status === 'created') {
              transition(db, clock, log, row.payout_id, 'collecting', 'collect.request sent');
            }
            transition(db, clock, log, row.payout_id, 'failed', 'collect declined');
            db.prepare(`UPDATE payouts SET failure_reason = 'collect_declined' WHERE id = @id`).run(
              { id: row.payout_id },
            );
          }

          recordEvent(db, log, {
            kind: 'worker',
            level: 'warn',
            at,
            payoutId: row.payout_id,
            message: `${row.kind} declined`,
            data: { reason: result.declined, providerRef: payload.providerRef },
          });
        })();
        return;
      }

      db.transaction(() => {
        markSent(db, row.id, at);
        db.prepare(
          `UPDATE payout_legs
           SET status = 'submitted', attempt = attempt + 1, updated_at = @at
           WHERE payout_id = @payout_id AND leg = @leg`,
        ).run({ payout_id: row.payout_id, leg, at });
        markLegStarted(row.payout_id, leg, clock.now().getTime());

        if (leg === 'collect') {
          const status = db
            .prepare(`SELECT status FROM payouts WHERE id = @id`)
            .get({ id: row.payout_id }) as { status: string };
          if (status.status === 'created') {
            transition(db, clock, log, row.payout_id, 'collecting', 'collect.request sent');
          }
        }

        recordEvent(db, log, {
          kind: 'worker',
          level: 'info',
          at,
          payoutId: row.payout_id,
          message: `${row.kind} accepted`,
          data: { providerRef: payload.providerRef },
        });
      })();
    } catch (err) {
      if (!(err instanceof ProviderTimeout)) {
        throw err;
      }

      const backoff = config.STATUS_BACKOFF_MS[0] ?? 1000;
      const dueAt = new Date(clock.now().getTime() + backoff).toISOString();

      db.transaction(() => {
        markSent(db, row.id, at);
        db.prepare(
          `UPDATE payout_legs
           SET status = 'checking', attempt = attempt + 1, updated_at = @at
           WHERE payout_id = @payout_id AND leg = @leg`,
        ).run({ payout_id: row.payout_id, leg, at });
        markLegStarted(row.payout_id, leg, clock.now().getTime());

        if (leg === 'collect') {
          const status = db
            .prepare(`SELECT status FROM payouts WHERE id = @id`)
            .get({ id: row.payout_id }) as { status: string };
          if (status.status === 'created') {
            transition(db, clock, log, row.payout_id, 'collecting', 'collect.request sent');
          }
        }

        insertOutbox(db, {
          payoutId: row.payout_id,
          kind: 'status.query',
          createdAt: at,
          dueAt,
          payload: {
            payoutId: row.payout_id,
            leg,
            providerRef: payload.providerRef,
            checkingSince: at,
            backoffIndex: 0,
            requestKind: row.kind,
          },
        });

        recordEvent(db, log, {
          kind: 'worker',
          level: 'warn',
          at,
          payoutId: row.payout_id,
          message: `${row.kind} timed out; checking`,
          data: { providerRef: payload.providerRef },
        });
      })();
    }
  }

  async function handleStatusQuery(row: OutboxRow): Promise<void> {
    const payload = parsePayload(row.payload) as {
      payoutId: string;
      leg: 'collect' | 'transfer' | 'deposit' | 'refund';
      providerRef: string;
      checkingSince: string;
      backoffIndex: number;
      requestKind: OutboxKind;
    };
    const provider = providerForKind(providers, payload.requestKind);
    if (!provider) return;

    const at = clock.now().toISOString();
    const checkingSinceMs = Date.parse(payload.checkingSince);
    const elapsed = clock.now().getTime() - checkingSinceMs;

    if (elapsed >= config.CHECKING_GIVE_UP_MS) {
      db.transaction(() => {
        markSent(db, row.id, at);
        recordEvent(db, log, {
          kind: 'worker',
          level: 'warn',
          at,
          payoutId: row.payout_id,
          message: 'gave up status queries; leg stays checking',
          data: { providerRef: payload.providerRef, elapsedMs: elapsed },
        });
      })();
      return;
    }

    const status = await provider.getStatus(payload.providerRef);

    if (status === 'not_found') {
      if (elapsed >= config.PROVIDER_WINDOW_MS) {
        db.transaction(() => {
          markSent(db, row.id, at);
          insertOutbox(db, {
            payoutId: row.payout_id,
            kind: payload.requestKind,
            createdAt: at,
            payload: {
              payoutId: row.payout_id,
              leg: payload.leg,
              providerRef: payload.providerRef,
            },
          });
          recordEvent(db, log, {
            kind: 'worker',
            level: 'info',
            at,
            payoutId: row.payout_id,
            message: 'status not_found after window; resending same provider_ref',
            data: { providerRef: payload.providerRef },
          });
        })();
        return;
      }

      const nextIndex = Math.min(
        (payload.backoffIndex ?? 0) + 1,
        config.STATUS_BACKOFF_MS.length - 1,
      );
      const delay = config.STATUS_BACKOFF_MS[nextIndex] ?? 8000;
      const dueAt = new Date(clock.now().getTime() + delay).toISOString();

      db.transaction(() => {
        markSent(db, row.id, at);
        insertOutbox(db, {
          payoutId: row.payout_id,
          kind: 'status.query',
          createdAt: at,
          dueAt,
          payload: {
            ...payload,
            backoffIndex: nextIndex,
          },
        });
        recordEvent(db, log, {
          kind: 'worker',
          level: 'info',
          at,
          payoutId: row.payout_id,
          message: 'status not_found; scheduling next query',
          data: { providerRef: payload.providerRef, dueAt },
        });
      })();
      return;
    }

    db.transaction(() => {
      markSent(db, row.id, at);
      applyProviderEvent(db, clock, log, {
        eventId: `evt_status_${row.id}_${status.seq}`,
        providerRef: payload.providerRef,
        leg: payload.leg,
        status: status.status as
          | 'processing'
          | 'succeeded'
          | 'declined'
          | 'submitted'
          | 'confirming'
          | 'dropped'
          | 'final'
          | 'rejected',
        seq: status.seq,
        detail: status.detail,
      });
      recordEvent(db, log, {
        kind: 'worker',
        level: 'info',
        at,
        payoutId: row.payout_id,
        message: 'status query applied',
        data: { providerRef: payload.providerRef, status: status.status, seq: status.seq },
      });
    })();
  }

  async function tickOnce(): Promise<void> {
    lastTickAt = clock.now();
    const now = lastTickAt.toISOString();

    const rows = db
      .prepare(
        `SELECT id, payout_id, kind, payload, created_at, due_at, attempts
         FROM outbox
         WHERE sent_at IS NULL
           AND (due_at IS NULL OR due_at <= @now)
         ORDER BY id ASC`,
      )
      .all({ now }) as OutboxRow[];

    for (const row of rows) {
      if (stopped) break;
      if (row.kind === 'status.query') {
        await handleStatusQuery(row);
      } else {
        await handleRequest(row);
      }
    }
  }

  if (opts.intervalMs !== undefined && opts.intervalMs > 0) {
    timer = setInterval(() => {
      void tickOnce().catch((err) => {
        log.error({ err }, 'worker tick failed');
      });
    }, opts.intervalMs);
    timer.unref?.();
  }

  return {
    stop() {
      stopped = true;
      if (timer) clearInterval(timer);
    },
    tickOnce,
    lastTickAt: () => lastTickAt,
  };
}

function markSent(db: Db, id: number, at: string): void {
  db.prepare(`UPDATE outbox SET sent_at = @at, attempts = attempts + 1 WHERE id = @id`).run({
    id,
    at,
  });
}
