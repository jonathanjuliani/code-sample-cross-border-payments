import { WebhookEventSchema, type WebhookProvider } from '@payout/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Clock } from '../clock.ts';
import type { AppConfig } from '../config.ts';
import type { Db } from '../db/open.ts';
import { recordEvent } from '../ops/events.ts';
import { IllegalTransition } from '../payouts/machine.ts';
import { applyProviderEvent } from './apply.ts';
import { verifyWebhookSignature } from './sign.ts';

type RequestWithRawBody = FastifyRequest & { rawBody?: string };

export function registerWebhookRoutes(
  app: FastifyInstance,
  deps: { db: Db; clock: Clock; config: AppConfig },
): void {
  const { db, clock, config } = deps;

  app.post<{ Params: { provider: string } }>('/webhooks/:provider', async (request, reply) => {
    const provider = request.params.provider as WebhookProvider;
    if (provider !== 'collect' && provider !== 'chain' && provider !== 'offramp') {
      return reply.code(400).send({
        error: 'validation_failed',
        message: 'Unknown webhook provider',
      });
    }

    const rawBody = (request as RequestWithRawBody).rawBody ?? '';
    const verified = verifyWebhookSignature({
      secret: config.WEBHOOK_SECRET,
      timestampHeader: request.headers.timestamp,
      signatureHeader: request.headers.signature,
      rawBody,
      nowMs: clock.now().getTime(),
    });
    if (!verified.ok) {
      return reply.code(401).send({
        error: 'invalid_signature',
        message:
          verified.reason === 'stale_timestamp'
            ? 'Webhook timestamp outside tolerance window'
            : 'Missing or invalid webhook signature',
      });
    }

    const parsed = WebhookEventSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'validation_failed',
        message: 'Invalid webhook event',
        issues: parsed.error.issues,
      });
    }

    const event = parsed.data;
    const at = clock.now().toISOString();

    try {
      const result = db.transaction(() => {
        const leg = db
          .prepare(`SELECT payout_id, last_seq FROM payout_legs WHERE provider_ref = @ref`)
          .get({ ref: event.providerRef }) as { payout_id: string; last_seq: number } | undefined;

        if (!leg) {
          throw new Error(`unknown provider_ref ${event.providerRef}`);
        }

        const inserted = db
          .prepare(
            `INSERT OR IGNORE INTO inbox_events
               (event_id, payout_id, leg, seq, status, received_at, applied)
             VALUES (@event_id, @payout_id, @leg, @seq, @status, @received_at, 0)`,
          )
          .run({
            event_id: event.eventId,
            payout_id: leg.payout_id,
            leg: event.leg,
            seq: event.seq,
            status: event.status,
            received_at: at,
          });

        if (inserted.changes === 0) {
          recordEvent(db, request.log, {
            kind: 'webhook',
            level: 'info',
            at,
            payoutId: leg.payout_id,
            message: `ignored duplicate ${event.eventId}`,
            data: { eventId: event.eventId, ignored: 'duplicate' },
          });
          return { ignored: 'duplicate' as const };
        }

        if (event.seq <= leg.last_seq) {
          recordEvent(db, request.log, {
            kind: 'webhook',
            level: 'info',
            at,
            payoutId: leg.payout_id,
            message: `ignored stale ${event.eventId}`,
            data: { eventId: event.eventId, seq: event.seq, ignored: 'stale' },
          });
          return { ignored: 'stale' as const };
        }

        applyProviderEvent(db, clock, request.log, event);

        db.prepare(`UPDATE inbox_events SET applied = 1 WHERE event_id = @event_id`).run({
          event_id: event.eventId,
        });

        recordEvent(db, request.log, {
          kind: 'webhook',
          level: 'info',
          at,
          payoutId: leg.payout_id,
          message: `applied ${event.eventId}`,
          data: {
            eventId: event.eventId,
            leg: event.leg,
            status: event.status,
            seq: event.seq,
          },
        });

        return { applied: true as const };
      })();

      if ('ignored' in result) {
        return reply.code(200).send({ ok: true, ignored: result.ignored });
      }
      return reply.code(200).send({ ok: true });
    } catch (err) {
      if (err instanceof IllegalTransition) {
        return reply.code(400).send({
          error: 'validation_failed',
          message: err.message,
        });
      }
      throw err;
    }
  });
}
