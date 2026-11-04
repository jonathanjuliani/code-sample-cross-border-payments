import type { FastifyBaseLogger } from 'fastify';
import type { Clock } from '../clock.ts';
import type { Db } from '../db/open.ts';
import { recordEvent } from '../ops/events.ts';

export function expireDue(db: Db, clock: Clock, log: FastifyBaseLogger): number {
  const now = clock.now().toISOString();
  const due = db
    .prepare(
      `SELECT id FROM quotes
       WHERE status = 'active' AND expires_at <= @now`,
    )
    .all({ now }) as Array<{ id: string }>;

  if (due.length === 0) {
    return 0;
  }

  const update = db.prepare(
    `UPDATE quotes SET status = 'expired' WHERE id = @id AND status = 'active'`,
  );

  for (const row of due) {
    update.run({ id: row.id });
    recordEvent(db, log, {
      kind: 'state',
      level: 'info',
      at: now,
      message: `quote ${row.id} expired`,
      data: { quoteId: row.id },
    });
  }

  return due.length;
}
