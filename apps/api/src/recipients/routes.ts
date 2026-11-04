import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/open.ts';

type RecipientRow = {
  id: string;
  label: string;
  city: string;
  country: string;
  currency: string;
  bank_account_masked: string;
};

export function registerRecipientRoutes(app: FastifyInstance, db: Db): void {
  app.get('/recipients', async () => {
    const rows = db
      .prepare(
        `SELECT id, label, city, country, currency, bank_account_masked
         FROM recipients
         ORDER BY id`,
      )
      .all() as RecipientRow[];

    return rows.map((row) => ({
      id: row.id,
      label: row.label,
      city: row.city,
      country: row.country,
      currency: row.currency as 'MXN',
      bankAccountMasked: row.bank_account_masked,
    }));
  });
}
