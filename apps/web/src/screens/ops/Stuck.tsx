import type { OpsSummary } from '@payout/shared';
import { Card } from '../../ui/Card.tsx';
import { SectionHead } from '../../ui/SectionHead.tsx';
import styles from './ops.module.css';

type Props = {
  stuck: OpsSummary['stuck'];
  onSelect: (payoutId: string) => void;
};

export function OpsStuck({ stuck, onSelect }: Props) {
  return (
    <Card>
      <SectionHead>Stuck</SectionHead>
      {stuck.length ? (
        <ul>
          {stuck.map((s) => (
            <li key={`${s.payoutId}-${s.leg}`} className="mono meta">
              <button type="button" className={styles.linkish} onClick={() => onSelect(s.payoutId)}>
                {s.payoutId}
              </button>{' '}
              · {s.leg} · {s.status} · {Math.round(s.ageMs / 1000)}s
              {s.flagged ? (
                <span className={styles.badge} data-testid="flagged-badge">
                  Flagged
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">None</p>
      )}
    </Card>
  );
}
