import type { OpsConfig } from '@payout/shared';
import { Card } from '../../ui/Card.tsx';
import { SectionHead } from '../../ui/SectionHead.tsx';
import styles from './ops.module.css';

type Props = {
  config: OpsConfig | null;
};

export function OpsConfigPanel({ config }: Props) {
  return (
    <Card>
      <SectionHead>Config</SectionHead>
      <pre className={styles.log}>{config ? JSON.stringify(config, null, 2) : '—'}</pre>
    </Card>
  );
}
