import type { ReactNode } from 'react';
import styles from './PageHead.module.css';

export function PageHead({
  eyebrow,
  title,
  lede,
  action,
}: {
  eyebrow?: string;
  title: string;
  lede?: string;
  action?: ReactNode;
}) {
  return (
    <header className={styles.root}>
      <div className={styles.row}>
        <div>
          {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
          <h1 className={styles.title}>{title}</h1>
          {lede ? <p className="lede">{lede}</p> : null}
        </div>
        {action}
      </div>
    </header>
  );
}
