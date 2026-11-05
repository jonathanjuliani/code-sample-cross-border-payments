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
          <span className={styles.badge} aria-hidden>
            {step.index}
          </span>
          <div className={styles.body}>
            <div className={styles.title}>{step.title}</div>
            <div className={styles.detail}>{step.detail}</div>
          </div>
          <div className={styles.meta} data-testid="timeline-meta">
            <span>{step.word}</span>
            {step.at ? <span>{step.at}</span> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
