import type { ReactNode } from 'react';
import styles from './KeyValue.module.css';

export function KeyValue({
  items,
}: {
  items: Array<{ key: string; value: ReactNode; big?: boolean }>;
}) {
  return (
    <dl className={styles.root}>
      {items.map((item) => (
        <div
          key={item.key}
          className={item.big ? styles.big : undefined}
          style={{ display: 'contents' }}
        >
          <dt>{item.key}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
