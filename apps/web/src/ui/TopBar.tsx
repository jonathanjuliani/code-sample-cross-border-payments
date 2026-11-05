import type { Route } from '../state/route.ts';
import { navigate } from '../state/route.ts';
import { ThemeSwitch } from './ThemeSwitch.tsx';
import styles from './TopBar.module.css';

export function TopBar({ current }: { current: Route }) {
  const showOps = import.meta.env.DEV;
  const tab = (name: Route['name'], path: string, label: string) => (
    <button
      type="button"
      className={`${styles.tab} ${current.name === name || (name === 'list' && current.name === 'payout') ? styles.active : ''}`}
      aria-current={current.name === name ? 'page' : undefined}
      onClick={() => navigate(path)}
    >
      {label}
    </button>
  );
  return (
    <header className={styles.root}>
      <div className={styles.inner}>
        <div className={styles.brand}>
          <span className={styles.mark} aria-hidden />
          Payouts
        </div>
        <nav aria-label="Main" className={styles.tabs}>
          {tab('list', '/', 'Payouts')}
          {tab('new', '/new', 'New payout')}
          {showOps ? tab('ops', '/ops', 'Ops') : null}
        </nav>
        <div className={styles.end}>
          <span className={styles.account}>
            Funding account <span className="mono">••••2290</span>
          </span>
          <ThemeSwitch />
        </div>
      </div>
    </header>
  );
}
