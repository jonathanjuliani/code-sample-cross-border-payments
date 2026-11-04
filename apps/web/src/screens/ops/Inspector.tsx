import { Button } from '../../ui/Button.tsx';
import { Card } from '../../ui/Card.tsx';
import { SectionHead } from '../../ui/SectionHead.tsx';
import styles from './ops.module.css';

export type InspectorState = {
  payoutId: string;
  flaggedAt: string | null;
  legs: Array<{ leg: string; status: string; provider_ref: string | null }>;
  actionMsg: string;
};

type Props = {
  inspectId: string;
  onInspectIdChange: (id: string) => void;
  onLoad: () => void;
  inspector: InspectorState | null;
  onRerunStatusQuery: (leg: string) => void;
  onFlagForReview: () => void;
};

export function OpsInspector({
  inspectId,
  onInspectIdChange,
  onLoad,
  inspector,
  onRerunStatusQuery,
  onFlagForReview,
}: Props) {
  return (
    <Card>
      <SectionHead>Payout inspector</SectionHead>
      <div className="row">
        <input
          className={styles.input}
          placeholder="payout id"
          aria-label="Inspector payout id"
          value={inspectId}
          onChange={(e) => onInspectIdChange(e.target.value)}
        />
        <Button onClick={onLoad}>Load</Button>
      </div>
      {inspector ? (
        <div className="stack" style={{ marginTop: 'var(--s3)' }}>
          <p className="meta mono">
            {inspector.payoutId}
            {inspector.flaggedAt ? (
              <span className={styles.badge} data-testid="flagged-badge">
                Flagged {inspector.flaggedAt}
              </span>
            ) : null}
          </p>
          <ul>
            {inspector.legs.map((leg) => (
              <li key={leg.leg} className="mono meta row" style={{ gap: 'var(--s2)' }}>
                <span>
                  {leg.leg} · {leg.status}
                </span>
                {leg.status === 'checking' ? (
                  <Button
                    onClick={() => onRerunStatusQuery(leg.leg)}
                    data-testid={`rerun-${leg.leg}`}
                  >
                    Re-run status query
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
          <Button onClick={onFlagForReview} data-testid="flag-for-review">
            Flag for review
          </Button>
          {inspector.actionMsg ? (
            <p className="meta" data-testid="inspector-action">
              {inspector.actionMsg}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="muted">Enter a payout id to inspect.</p>
      )}
    </Card>
  );
}
