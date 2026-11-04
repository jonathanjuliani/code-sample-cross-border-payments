import { Card } from '../../ui/Card.tsx';
import { SectionHead } from '../../ui/SectionHead.tsx';
import styles from './ops.module.css';

type Props = {
  recon: string;
};

export function OpsRecon({ recon }: Props) {
  return (
    <Card>
      <SectionHead>Reconciliation</SectionHead>
      <pre className={styles.log}>{recon || '—'}</pre>
    </Card>
  );
}
