import { randomBytes } from 'node:crypto';
import type { Db } from '../src/db/open.ts';

function opaqueToken(): string {
  return randomBytes(16).toString('hex');
}

export function seedIfEmpty(db: Db): void {
  const row = db.prepare('SELECT COUNT(*) AS n FROM recipients').get() as { n: number };
  if (row.n > 0) {
    return;
  }

  const insertRecipient = db.prepare(`
    INSERT INTO recipients (id, label, city, country, currency, bank_account_masked, bank_account_token)
    VALUES (@id, @label, @city, @country, @currency, @bank_account_masked, @bank_account_token)
  `);

  const insertMeta = db.prepare(`
    INSERT INTO meta (key, value) VALUES (@key, @value)
  `);

  const tx = db.transaction(() => {
    insertMeta.run({ key: 'funding_account_masked', value: '••••2290' });
    insertMeta.run({ key: 'next_payout_number', value: '1041' });

    insertRecipient.run({
      id: 'r1',
      label: 'Fabric supplier',
      city: 'Monterrey',
      country: 'MX',
      currency: 'MXN',
      bank_account_masked: '••••4821',
      bank_account_token: opaqueToken(),
    });
    insertRecipient.run({
      id: 'r2',
      label: 'Packaging supplier',
      city: 'Guadalajara',
      country: 'MX',
      currency: 'MXN',
      bank_account_masked: '••••0937',
      bank_account_token: opaqueToken(),
    });
    insertRecipient.run({
      id: 'r3',
      label: 'Freight agent',
      city: 'Veracruz',
      country: 'MX',
      currency: 'MXN',
      bank_account_masked: '••••5510',
      bank_account_token: opaqueToken(),
    });

    // TODO(phase-3): seed PO-1039 and PO-1040 with legs and ledger entries
    // through the same posting code as live payouts, once the ledger exists.
  });

  tx();
}
