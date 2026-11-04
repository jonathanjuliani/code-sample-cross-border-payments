import type { Tone } from '../state/tone.ts';
import styles from './Timeline.module.css';

export type TimelineStep = {
  tone: Tone;
  index: string;
  word: string;
  at?: string;
  title: string;
  detail: string;
  dashed?: boolean;
};

export function Timeline({ steps }: { steps: TimelineStep[] }) {
  return (
    <ol className={styles.root}>
      {steps.map((step) => (
        <li
          key={step.index + step.title}
          className={`${styles.step} ${styles[step.tone]} ${step.dashed ? styles.dashed : ''}`}
        >
          <span className={styles.ring} aria-hidden />
          <div className={styles.meta} data-testid="timeline-meta">
            {step.index} · {step.word}
            {step.at ? ` · ${step.at}` : ''}
          </div>
          <div className={styles.title}>{step.title}</div>
          <div className={styles.detail}>{step.detail}</div>
        </li>
      ))}
    </ol>
  );
}
