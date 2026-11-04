import type { OpsEvent } from '@payout/shared';
import { Card } from '../../ui/Card.tsx';
import { SectionHead } from '../../ui/SectionHead.tsx';
import styles from './ops.module.css';

type Props = {
  events: OpsEvent[];
  kindFilter: string;
  payoutFilter: string;
  onKindFilterChange: (value: string) => void;
  onPayoutFilterChange: (value: string) => void;
};

export function OpsEvents({
  events,
  kindFilter,
  payoutFilter,
  onKindFilterChange,
  onPayoutFilterChange,
}: Props) {
  return (
    <Card>
      <SectionHead>Server log</SectionHead>
      <div className="row">
        <input
          className={styles.input}
          placeholder="kind"
          value={kindFilter}
          onChange={(e) => onKindFilterChange(e.target.value)}
        />
        <input
          className={styles.input}
          placeholder="payout id"
          value={payoutFilter}
          onChange={(e) => onPayoutFilterChange(e.target.value)}
        />
      </div>
      <pre className={styles.log}>
        {events.map((e) => `${e.at} [${e.kind}] ${e.payoutId ?? '-'} ${e.message}`).join('\n') ||
          'No events'}
      </pre>
    </Card>
  );
}
