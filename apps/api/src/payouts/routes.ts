import type { FastifyInstance } from 'fastify';
import type { Clock } from '../clock.ts';
import type { AppConfig } from '../config.ts';
import type { Db } from '../db/open.ts';
import { openSse } from '../http/sse.ts';
import { getFlags } from '../providers/sim/flags.ts';
import { isLegSlow } from '../providers/sim/timing.ts';
import { createPayout, type ProviderSpy } from './create.ts';
import {
  type LegRow,
  type PayoutRow,
  serializeLeg,
  serializePayout,
  serializePayoutListItem,
} from './serialize.ts';

const STREAM_TICK_MS = 250;

export type PayoutRouteDeps = {
  db: Db;
  clock: Clock;
  config: AppConfig;
  providerSpy?: ProviderSpy;
  abortAfterQuoteConsumed?: () => void;
  onCrashAfterCommit?: () => void;
};

function loadLegs(db: Db, payoutId: string): LegRow[] {
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

function serializeWithSlow(clock: Clock, payout: PayoutRow, legs: LegRow[]) {
  const speed = getFlags().speed;
  const nowMs = clock.now().getTime();
  return {
    ...serializePayout(payout, legs),
    legs: legs.map((leg) =>
      serializeLeg(
        leg,
        isLegSlow({
          payoutId: payout.id,
          leg: leg.leg,
          status: leg.status,
          nowMs,
          speed,
        }),
      ),
    ),
  };
}

export function registerPayoutRoutes(app: FastifyInstance, deps: PayoutRouteDeps): void {
  const { db, clock, config, providerSpy, abortAfterQuoteConsumed, onCrashAfterCommit } = deps;

  app.post('/payouts', async (request, reply) => {
    const keyHeader = request.headers['idempotency-key'];
    const idempotencyKey = Array.isArray(keyHeader) ? keyHeader[0] : keyHeader;

    const result = createPayout({
      db,
      clock,
      config,
      log: request.log,
      idempotencyKey,
      body: request.body,
      ...(providerSpy ? { providerSpy } : {}),
      ...(abortAfterQuoteConsumed ? { abortAfterQuoteConsumed } : {}),
    });

    if (result.status === 201) {
      onCrashAfterCommit?.();
    }

    return reply.code(result.status).send(result.body);
  });

  app.get<{ Querystring: { idempotencyKey?: string } }>('/payouts', async (request, reply) => {
    const { idempotencyKey } = request.query;

    if (idempotencyKey) {
      const keyRow = db
        .prepare(`SELECT payout_id FROM idempotency_keys WHERE key = @key`)
        .get({ key: idempotencyKey }) as { payout_id: string | null } | undefined;

      if (!keyRow?.payout_id) {
        return reply.code(404).send({ error: 'not_found', message: 'No payout for that key' });
      }

      const payout = db.prepare(`SELECT * FROM payouts WHERE id = @id`).get({
        id: keyRow.payout_id,
      }) as PayoutRow | undefined;
      if (!payout) {
        return reply.code(404).send({ error: 'not_found', message: 'Payout not found' });
      }
      return serializeWithSlow(clock, payout, loadLegs(db, payout.id));
    }

    const rows = db
      .prepare(`SELECT * FROM payouts ORDER BY created_at DESC, id DESC`)
      .all() as PayoutRow[];

    return rows.map((row) => serializePayoutListItem(row, loadLegs(db, row.id)));
  });

  app.get<{ Params: { id: string } }>('/payouts/:id/stream', async (request, reply) => {
    const payout = db.prepare(`SELECT * FROM payouts WHERE id = @id`).get({
      id: request.params.id,
    }) as PayoutRow | undefined;
    if (!payout) {
      return reply.code(404).send({ error: 'not_found', message: 'Payout not found' });
    }

    const once = request.headers['x-sse-once'] === '1';
    const sse = openSse(request, reply);
    let last = '';
    let timer: ReturnType<typeof setInterval> | undefined;
    const tick = () => {
      if (getFlags()['client.readsFail']) {
        if (timer) clearInterval(timer);
        sse.write('error', { error: 'simulated_outage' });
        sse.close();
        return;
      }
      const row = db.prepare(`SELECT * FROM payouts WHERE id = @id`).get({
        id: request.params.id,
      }) as PayoutRow | undefined;
      if (!row) {
        if (timer) clearInterval(timer);
        sse.write('error', { error: 'not_found' });
        sse.close();
        return;
      }
      const body = serializeWithSlow(clock, row, loadLegs(db, row.id));
      const encoded = JSON.stringify(body);
      if (encoded !== last) {
        last = encoded;
        sse.write('payout', body);
      }
      if (
        once ||
        row.status === 'delivered' ||
        row.status === 'failed' ||
        row.status === 'refunded'
      ) {
        if (timer) clearInterval(timer);
        sse.close();
      }
    };
    timer = setInterval(tick, STREAM_TICK_MS);
    request.raw.on('close', () => {
      if (timer) clearInterval(timer);
    });
    tick();
  });

  app.get<{ Params: { id: string } }>('/payouts/:id', async (request, reply) => {
    const payout = db.prepare(`SELECT * FROM payouts WHERE id = @id`).get({
      id: request.params.id,
    }) as PayoutRow | undefined;
    if (!payout) {
      return reply.code(404).send({ error: 'not_found', message: 'Payout not found' });
    }
    return serializeWithSlow(clock, payout, loadLegs(db, payout.id));
  });
}
