import type { SimulationFlags } from '@payout/shared';
import { Button } from '../../ui/Button.tsx';
import { Card } from '../../ui/Card.tsx';
import { SectionHead } from '../../ui/SectionHead.tsx';
import styles from './ops.module.css';
import { SWITCHES } from './switches.ts';

type Props = {
  flags: SimulationFlags | null;
  onToggle: (key: keyof SimulationFlags, value: boolean | number) => void;
  onReset: () => void;
};

export function OpsSimulation({ flags, onToggle, onReset }: Props) {
  return (
    <Card>
      <SectionHead>Simulation</SectionHead>
      <div className={styles.switches}>
        {SWITCHES.map((key) => (
          <label key={key} className={styles.switch}>
            <input
              type="checkbox"
              name={key}
              aria-label={key}
              checked={Boolean(flags?.[key])}
              disabled={!flags}
              onChange={(e) => onToggle(key, e.target.checked)}
            />
            {key}
          </label>
        ))}
      </div>
      <div className="row" style={{ marginTop: 'var(--s3)' }}>
        <fieldset className={styles.speed}>
          <legend className="meta">Speed</legend>
          {([1, 3, 10] as const).map((s) => (
            <button
              key={s}
              type="button"
              className={styles.speedBtn}
              aria-pressed={flags?.speed === s}
              onClick={() => onToggle('speed', s)}
            >
              {s}×
            </button>
          ))}
        </fieldset>
        <Button onClick={onReset}>Reset</Button>
      </div>
    </Card>
  );
}
