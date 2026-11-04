import styles from './Spinner.module.css';
export function Spinner({ label = 'Loading' }: { label?: string }) {
  return <span className={styles.root} role="status" aria-label={label} />;
}
