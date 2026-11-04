import { type PayoutListItem, PayoutListItemSchema, type Recipient } from '@payout/shared';
import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { request } from '../state/api.ts';
import { usePoll } from '../state/poll.ts';
import { navigate } from '../state/route.ts';
import { payoutPillLabel, payoutTone } from '../state/tone.ts';
import { Money } from '../ui/Money.tsx';
import { PageHead } from '../ui/PageHead.tsx';
import { Pill } from '../ui/Pill.tsx';
import { Table, tableStyles } from '../ui/Table.tsx';

const ListSchema = z.array(PayoutListItemSchema);

export function PayoutList({ recipients }: { recipients: Recipient[] }) {
  const [items, setItems] = useState<PayoutListItem[]>([]);
  const label = (id: string) => recipients.find((r) => r.id === id)?.label ?? id;

  const load = useCallback(async () => {
    const res = await request('/payouts', { method: 'GET', schema: ListSchema });
    if (!res.ok) return false;
    setItems(res.data);
    return true;
  }, []);

  const unfinished = items.some(
    (p) => p.status !== 'delivered' && p.status !== 'failed' && p.status !== 'refunded',
  );
  const { offline, lastConfirmedAt } = usePoll(load, 2000, { while: true });

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      {offline ? (
        <div className="strip" role="status">
          Can't reach the server right now.
          {lastConfirmedAt
            ? ` This is the last status we confirmed, at ${lastConfirmedAt.toLocaleTimeString()}.`
            : ''}
        </div>
      ) : null}
      <PageHead
        eyebrow="Cross-border"
        title="Payouts"
        lede="Newest first. Open a row to follow the status."
      />
      {items.length === 0 ? (
        <p className="muted">No payouts yet.</p>
      ) : (
        <Table
          headers={[
            { label: 'Payout' },
            { label: 'Recipient' },
            { label: 'They receive', right: true },
            { label: 'You send', right: true },
            { label: 'Status' },
          ]}
          rows={items.map((p) => {
            const checking = p.legs.some((l) => l.status === 'checking');
            return {
              key: p.id,
              onClick: () => navigate(`/payouts/${p.id}`),
              cells: [
                <span key="id" className={tableStyles.id}>
                  {p.id}
                </span>,
                label(p.recipientId),
                <Money key="r" minor={p.receiveMinor} currency="MXN" />,
                <Money key="s" minor={p.sendMinor} currency="USD" />,
                <Pill key="p" tone={payoutTone(p.status, checking)}>
                  {payoutPillLabel(p.status, checking)}
                </Pill>,
              ],
            };
          })}
        />
      )}
      {unfinished ? null : null}
    </div>
  );
}
