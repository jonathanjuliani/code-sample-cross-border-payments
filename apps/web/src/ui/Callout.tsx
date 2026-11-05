import type { ReactNode } from 'react';
import type { Tone } from '../state/tone.ts';
import styles from './Callout.module.css';

const GLYPH: Record<Tone, string> = { info: 'i', success: '✓', caution: '!', danger: '×' };

export function Callout({
  tone,
  label,
  title,
  children,
  live,
}: {
  tone: Tone;
  label: string;
  title?: string;
  children?: ReactNode;
  live?: boolean;
}) {
  const role = tone === 'danger' || tone === 'caution' ? 'alert' : 'status';
  return (
    <div
      className={`${styles.root} ${styles[tone]}`}
      role={role}
      {...(live ? { 'aria-live': 'polite' as const } : {})}
    >
      <span className={styles.glyph} aria-hidden>
        {GLYPH[tone]}
      </span>
      <div>
        <div className={styles.label}>{label}</div>
        {title ? <strong className={styles.title}>{title}</strong> : null}
        {children ? <div className={styles.body}>{children}</div> : null}
      </div>
    </div>
  );
}
