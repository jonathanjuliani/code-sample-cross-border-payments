import type { ReactNode } from 'react';
import type { Tone } from '../state/tone.ts';
import styles from './Pill.module.css';

export function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`${styles.root} ${styles[tone]}`}>{children}</span>;
}
