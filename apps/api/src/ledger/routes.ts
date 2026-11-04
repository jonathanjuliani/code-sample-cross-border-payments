import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/open.ts';
import { journalSums } from './balances.ts';

export function registerLedgerRoutes(app: FastifyInstance, db: Db): void {
  app.get<{ Params: { id: string } }>('/payouts/:id/ledger', async (request, reply) => {
    const payout = db
      .prepare(`SELECT id FROM payouts WHERE id = @id`)
      .get({ id: request.params.id }) as { id: string } | undefined;
    if (!payout) {
      return reply.code(404).send({ error: 'not_found', message: 'Payout not found' });
    }

    const rows = db
      .prepare(
        `SELECT id, payout_id, journal_id, account, currency, amount_minor, memo, created_at
         FROM ledger_entries
         WHERE payout_id = @id
         ORDER BY created_at ASC, id ASC`,
      )
      .all({ id: payout.id }) as Array<{
      id: string;
      payout_id: string;
      journal_id: string;
      account: string;
      currency: string;
      amount_minor: number;
      memo: string;
      created_at: string;
    }>;

    return {
      entries: rows.map((row) => ({
        id: row.id,
        payoutId: row.payout_id,
        journalId: row.journal_id,
        account: row.account,
        currency: row.currency,
        amountMinor: row.amount_minor,
        memo: row.memo,
        createdAt: row.created_at,
      })),
      sums: journalSums(db, payout.id),
    };
  });
}
