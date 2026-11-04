import { SimulationFlagsSchema } from '@payout/shared';
import type { FastifyInstance } from 'fastify';
import type { Clock } from '../clock.ts';
import type { AppConfig } from '../config.ts';
import type { Db } from '../db/open.ts';
import { openSse } from '../http/sse.ts';
import { balances, journalSums } from '../ledger/balances.ts';
import { getFlags, resetFlags, setFlags } from '../providers/sim/flags.ts';
import { maskSecret } from '../webhooks/sign.ts';
import { flagPayoutForReview, queueStatusQuery } from './actions.ts';
import { buildOpsSummary } from './summary.ts';

const OPS_STREAM_TICK_MS = 2000;

export type OpsRouteDeps = {
  db: Db;
  clock: Clock;
  config: AppConfig;
  getWorkerLastTickAt: () => Date | null;
};

export function registerOpsRoutes(app: FastifyInstance, deps: OpsRouteDeps): void {
  const { db, clock, config, getWorkerLastTickAt } = deps;

  app.get('/ops/summary', async () => {
    return buildOpsSummary(db, clock, config, getWorkerLastTickAt());
  });

  app.get('/ops/stream', async (request, reply) => {
    const once = request.headers['x-sse-once'] === '1';
    const sse = openSse(request, reply);
    let timer: ReturnType<typeof setInterval> | undefined;
    const tick = () => {
      sse.write('ops', {
        summary: buildOpsSummary(db, clock, config, getWorkerLastTickAt()),
        simulation: getFlags(),
        at: clock.now().toISOString(),
      });
      if (once) {
        if (timer) clearInterval(timer);
        sse.close();
      }
    };
    timer = setInterval(tick, OPS_STREAM_TICK_MS);
    request.raw.on('close', () => {
      if (timer) clearInterval(timer);
    });
    tick();
  });

  app.get<{
    Querystring: { after?: string; payoutId?: string; kind?: string };
  }>('/ops/events', async (request) => {
    const after = request.query.after ? Number(request.query.after) : 0;
    const payoutId = request.query.payoutId;
    const kind = request.query.kind;

    let sql = `SELECT id, at, kind, level, payout_id, message, data
               FROM ops_events WHERE id > @after`;
    const params: Record<string, string | number> = { after: Number.isFinite(after) ? after : 0 };
    if (payoutId) {
      sql += ` AND payout_id = @payout_id`;
      params.payout_id = payoutId;
    }
    if (kind) {
      sql += ` AND kind = @kind`;
      params.kind = kind;
    }
    sql += ` ORDER BY id ASC LIMIT 200`;

    const rows = db.prepare(sql).all(params) as Array<{
      id: number;
      at: string;
      kind: string;
      level: string;
      payout_id: string | null;
      message: string;
      data: string | null;
    }>;

    return rows.map((row) => ({
      id: row.id,
      at: row.at,
      kind: row.kind,
      level: row.level,
      payoutId: row.payout_id,
      message: row.message,
      data: row.data ? (JSON.parse(row.data) as Record<string, unknown>) : null,
    }));
  });

  app.get<{ Params: { id: string } }>('/ops/payouts/:id', async (request, reply) => {
    const payout = db.prepare(`SELECT * FROM payouts WHERE id = @id`).get({
      id: request.params.id,
    }) as Record<string, unknown> | undefined;
    if (!payout) {
      return reply.code(404).send({ error: 'not_found', message: 'Payout not found' });
    }

    const legs = db
      .prepare(`SELECT * FROM payout_legs WHERE payout_id = @id ORDER BY leg`)
      .all({ id: request.params.id });
    const inbox = db
      .prepare(`SELECT * FROM inbox_events WHERE payout_id = @id ORDER BY received_at, event_id`)
      .all({ id: request.params.id });
    const outbox = db
      .prepare(`SELECT * FROM outbox WHERE payout_id = @id ORDER BY id`)
      .all({ id: request.params.id });
    const idem = db
      .prepare(
        `SELECT body_hash, response_status, created_at, payout_id
         FROM idempotency_keys WHERE payout_id = @id`,
      )
      .get({ id: request.params.id }) as
      | {
          body_hash: string;
          response_status: number;
          created_at: string;
          payout_id: string;
        }
      | undefined;
    const ledger = db
      .prepare(`SELECT * FROM ledger_entries WHERE payout_id = @id ORDER BY created_at, id`)
      .all({ id: request.params.id });
    const events = db
      .prepare(
        `SELECT id, at, kind, level, payout_id, message, data FROM ops_events
         WHERE payout_id = @id ORDER BY id ASC`,
      )
      .all({ id: request.params.id });

    const receiveMinor = payout.receive_minor as number;
    const recipientBank = balances(db, request.params.id)['recipient_bank:MXN'] ?? 0;
    const deliveredEqualsQuoted =
      payout.status === 'delivered' ? recipientBank === receiveMinor : null;

    return {
      payout,
      flaggedAt: (payout.flagged_at as string | null) ?? null,
      legs,
      inboxEvents: inbox,
      outbox,
      idempotency: idem
        ? {
            bodyHash: idem.body_hash,
            responseStatus: idem.response_status,
            createdAt: idem.created_at,
            payoutId: idem.payout_id,
          }
        : null,
      ledger,
      sums: journalSums(db, request.params.id),
      balances: balances(db, request.params.id),
      deliveredEqualsQuoted,
      events: events.map((row) => {
        const r = row as {
          id: number;
          at: string;
          kind: string;
          level: string;
          payout_id: string | null;
          message: string;
          data: string | null;
        };
        return {
          id: r.id,
          at: r.at,
          kind: r.kind,
          level: r.level,
          payoutId: r.payout_id,
          message: r.message,
          data: r.data ? (JSON.parse(r.data) as Record<string, unknown>) : null,
        };
      }),
    };
  });

  app.get('/ops/config', async () => {
    return {
      quoteTtlMs: config.QUOTE_TTL_MS,
      feeBps: 50,
      feeMinMinor: 200,
      sendMinMinor: 1000,
      sendMaxMinor: 5_000_000,
      confirmations: 3,
      workerIntervalMs: config.WORKER_INTERVAL_MS,
      stuckAfterMs: config.STUCK_AFTER_MS,
      dbPath: config.DB_PATH,
      appVersion: config.APP_VERSION,
      opsEnabled: config.OPS_ENABLED,
      webhookSecretMasked: maskSecret(config.WEBHOOK_SECRET),
    };
  });

  app.get('/ops/simulation', async () => getFlags());

  app.put('/ops/simulation', async (request, reply) => {
    const parsed = SimulationFlagsSchema.partial().safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'validation_failed',
        message: 'Unknown or invalid simulation switch',
        issues: parsed.error.issues,
      });
    }
    const patch = Object.fromEntries(
      Object.entries(parsed.data).filter(([, v]) => v !== undefined),
    ) as Partial<ReturnType<typeof getFlags>>;
    return setFlags(patch);
  });

  app.post('/ops/simulation/reset', async () => resetFlags());

  app.post<{ Params: { id: string }; Body: { leg?: string } }>(
    '/ops/payouts/:id/status-query',
    async (request, reply) => {
      const leg = request.body?.leg;
      if (typeof leg !== 'string' || !leg) {
        return reply.code(400).send({
          error: 'validation_failed',
          message: 'body.leg is required',
        });
      }
      const result = queueStatusQuery(db, clock, request.log, request.params.id, leg);
      if (!result.ok) {
        if (result.error === 'not_found') {
          return reply.code(404).send({ error: 'not_found', message: 'Payout or leg not found' });
        }
        if (result.error === 'bad_leg') {
          return reply.code(400).send({ error: 'validation_failed', message: 'Unknown leg' });
        }
        if (result.error === 'not_checking') {
          return reply.code(409).send({
            error: 'not_checking',
            message: 'Leg is not in checking',
          });
        }
        return reply.code(409).send({
          error: 'no_provider_ref',
          message: 'Leg has no provider_ref',
        });
      }
      return { ok: true, outboxId: result.outboxId };
    },
  );

  app.post<{ Params: { id: string } }>('/ops/payouts/:id/flag', async (request, reply) => {
    const result = flagPayoutForReview(db, clock, request.log, request.params.id);
    if (!result.ok) {
      return reply.code(404).send({ error: 'not_found', message: 'Payout not found' });
    }
    return { ok: true, flaggedAt: result.flaggedAt };
  });

  app.post<{ Params: { id: string }; Body: { ms?: number } }>(
    '/ops/quotes/:id/expire-in',
    async (request, reply) => {
      const ms = request.body?.ms;
      if (!Number.isInteger(ms) || (ms as number) < 0) {
        return reply.code(400).send({
          error: 'validation_failed',
          message: 'body.ms must be a non-negative integer',
        });
      }

      const quote = db
        .prepare(`SELECT id, status FROM quotes WHERE id = @id`)
        .get({ id: request.params.id }) as { id: string; status: string } | undefined;
      if (!quote) {
        return reply.code(404).send({ error: 'not_found', message: 'Quote not found' });
      }
      if (quote.status !== 'active') {
        return reply.code(409).send({
          error: 'quote_not_active',
          message: 'Quote is not active',
        });
      }

      const expiresAt = new Date(clock.now().getTime() + (ms as number)).toISOString();
      db.prepare(`UPDATE quotes SET expires_at = @expires_at WHERE id = @id`).run({
        id: quote.id,
        expires_at: expiresAt,
      });
      return { ok: true, expiresAt };
    },
  );
}
