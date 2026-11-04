import type { Recipient } from '@payout/shared';
import { useState } from 'react';
import { useLivePayout } from '../state/livePayout.ts';
import { navigate } from '../state/route.ts';
import { payoutPillLabel, payoutTone } from '../state/tone.ts';
import { Button } from '../ui/Button.tsx';
import { Callout } from '../ui/Callout.tsx';
import { Card } from '../ui/Card.tsx';
import { KeyValue } from '../ui/KeyValue.tsx';
import { Money } from '../ui/Money.tsx';
import { PageHead } from '../ui/PageHead.tsx';
import { Pill } from '../ui/Pill.tsx';
import { SectionHead } from '../ui/SectionHead.tsx';
import { Timeline } from '../ui/Timeline.tsx';
import { buildTimeline, payoutBanner } from './timelineCopy.ts';

export function PayoutDetail({ id, recipients }: { id: string; recipients: Recipient[] }) {
  const [supportOpen, setSupportOpen] = useState(false);
  const { payout, offline, lastConfirmedAt, transport } = useLivePayout(id, { while: true });
  const recipient = recipients.find((r) => r.id === payout?.recipientId);

  if (!payout) {
    return <p className="muted">Loading…</p>;
  }

  const checking = payout.legs.some((l) => l.status === 'checking');
  const banner = payoutBanner(payout);
  const receiveLabel =
    payout.status === 'refunded'
      ? 'Not delivered. Quoted amount'
      : payout.status === 'failed'
        ? 'Not sent. Quoted amount'
        : 'They receive';

  const steps = buildTimeline(payout, '••••2290', recipient?.bankAccountMasked ?? '••••');

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
      <Button variant="link" onClick={() => navigate('/')}>
        ← All payouts
      </Button>
      <PageHead
        eyebrow={payout.id}
        title={recipient?.label ?? 'Payout'}
        action={
          <Pill tone={payoutTone(payout.status, checking)}>
            {payoutPillLabel(payout.status, checking)}
          </Pill>
        }
      />
      <span data-testid="live-transport" hidden>
        {transport}
      </span>

      <div className="stack">
        <Card>
          <p className="label">{receiveLabel}</p>
          <Money minor={payout.receiveMinor} currency="MXN" size="hero" />
        </Card>

        <Callout tone={banner.tone} label={banner.label} title={banner.title} live>
          {banner.body}
        </Callout>

        <Card>
          <SectionHead>Status</SectionHead>
          <Timeline steps={steps} />
        </Card>

        <Card>
          <SectionHead>Amounts</SectionHead>
          <KeyValue
            items={[
              { key: 'You send', value: <Money minor={payout.sendMinor} currency="USD" /> },
              { key: 'Fee', value: <Money minor={payout.feeMinor} currency="USD" /> },
              {
                key: receiveLabel,
                value: <Money minor={payout.receiveMinor} currency="MXN" />,
                big: true,
              },
            ]}
          />
        </Card>

        <Card>
          <Button variant="link" onClick={() => setSupportOpen((v) => !v)}>
            {supportOpen ? '▼' : '▶'} Details for support
          </Button>
          {supportOpen ? (
            <div className="stack" style={{ marginTop: 'var(--s3)' }}>
              {payout.legs.map((leg) => (
                <p key={leg.leg} className="meta mono">
                  {leg.leg}: {leg.providerRef ?? '—'}
                  {leg.txHash ? ` · ${leg.txHash}` : ''}
                </p>
              ))}
            </div>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
