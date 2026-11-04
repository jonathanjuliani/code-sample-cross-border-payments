import type { ReactNode } from 'react';
import styles from './SectionHead.module.css';

export function SectionHead({ children }: { children: ReactNode }) {
  return (
    <div className={styles.root}>
      <h2>{children}</h2>
    </div>
  );
}
