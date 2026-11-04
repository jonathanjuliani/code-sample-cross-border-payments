import {
  CreateQuoteRequestSchema,
  inLimits,
  priceFromReceive,
  priceFromSend,
  SEND_MAX_MINOR,
  SEND_MIN_MINOR,
} from '@payout/shared';
import type { FastifyInstance } from 'fastify';
import type { Clock } from '../clock.ts';
import type { AppConfig } from '../config.ts';
import type { Db } from '../db/open.ts';
import { recordEvent } from '../ops/events.ts';
import { quoteId } from '../util/ids.ts';
import { currentRateE4 } from './rate.ts';

export function registerQuoteRoutes(
  app: FastifyInstance,
  deps: { db: Db; clock: Clock; config: AppConfig },
): void {
  const { db, clock, config } = deps;

  app.post('/quotes', async (request, reply) => {
    const parsed = CreateQuoteRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'validation_failed',
        message: 'Invalid quote request',
        issues: parsed.error.issues,
      });
    }

    const body = parsed.data;
    const recipient = db
      .prepare(`SELECT id FROM recipients WHERE id = @id`)
      .get({ id: body.recipientId }) as { id: string } | undefined;
    if (!recipient) {
      return reply.code(404).send({
        error: 'not_found',
        message: 'Recipient not found',
      });
    }

    const rateE4 = currentRateE4(config.SIM_RATE_JITTER_E4);
    const priced =
      body.mode === 'send'
        ? priceFromSend(body.amountMinor, rateE4)
        : priceFromReceive(body.amountMinor, rateE4);

    if (!inLimits(priced.sendMinor)) {
      return reply.code(422).send({
        error: 'amount_out_of_range',
        message: 'Send amount is outside the allowed limits',
        minMinor: SEND_MIN_MINOR,
        maxMinor: SEND_MAX_MINOR,
      });
    }

    const now = clock.now();
    const createdAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + config.QUOTE_TTL_MS).toISOString();
    const id = quoteId();

    const insert = db.transaction(() => {
      db.prepare(
        `INSERT INTO quotes (
           id, recipient_id, mode, rate_e4, send_minor, fee_minor, convert_minor, receive_minor,
           created_at, expires_at, status, payout_id
         ) VALUES (
           @id, @recipient_id, @mode, @rate_e4, @send_minor, @fee_minor, @convert_minor, @receive_minor,
           @created_at, @expires_at, 'active', NULL
         )`,
      ).run({
        id,
        recipient_id: body.recipientId,
        mode: body.mode,
        rate_e4: priced.rateE4,
        send_minor: priced.sendMinor,
        fee_minor: priced.feeMinor,
        convert_minor: priced.convertMinor,
        receive_minor: priced.receiveMinor,
        created_at: createdAt,
        expires_at: expiresAt,
      });

      recordEvent(db, request.log, {
        kind: 'api',
        level: 'info',
        at: createdAt,
        message: `quote ${id} created`,
        data: { quoteId: id, recipientId: body.recipientId, mode: body.mode },
      });
    });

    insert();

    return reply.code(201).send({
      id,
      recipientId: body.recipientId,
      mode: body.mode,
      rateE4: priced.rateE4,
      sendMinor: priced.sendMinor,
      feeMinor: priced.feeMinor,
      convertMinor: priced.convertMinor,
      receiveMinor: priced.receiveMinor,
      createdAt,
      expiresAt,
      status: 'active' as const,
      serverNow: createdAt,
    });
  });
}
