import type { OpsSummary } from '@payout/shared';
import { Card } from '../../ui/Card.tsx';
import { SectionHead } from '../../ui/SectionHead.tsx';
import styles from './ops.module.css';

type Props = {
  summary: OpsSummary | null;
};

export function OpsSummaryPanel({ summary }: Props) {
  return (
    <Card>
      <SectionHead>Summary</SectionHead>
      {summary ? (
        <pre className={styles.log}>
          {JSON.stringify(summary.payoutsByStatus, null, 2)}
          replays {summary.idempotentReplays} · 409 {summary.conflicts409} · 410{' '}
          {summary.expired410}
          dupes {summary.webhooksIgnoredDuplicate} · stale {summary.webhooksIgnoredStale}
          outbox {summary.outboxPending} · worker {summary.workerLastTickAt ?? '—'}
        </pre>
      ) : (
        <p className="muted">Loading…</p>
      )}
    </Card>
  );
}
