import type { Route } from '../state/route.ts';
import { navigate } from '../state/route.ts';
import styles from './SideNav.module.css';
import { ThemeSwitch } from './ThemeSwitch.tsx';

export function SideNav({ current }: { current: Route }) {
  const showOps = import.meta.env.DEV;
  return (
    <aside className={styles.root}>
      <div className={styles.brand}>
        <span className={styles.mark}>P</span>
        Payouts
      </div>
      <nav aria-label="Main">
        <button
          type="button"
          className={`${styles.link} ${current.name === 'list' ? styles.active : ''}`}
          onClick={() => navigate('/')}
        >
          <span className={styles.num}>01</span>Payouts
        </button>
        <button
          type="button"
          className={`${styles.link} ${current.name === 'new' ? styles.active : ''}`}
          onClick={() => navigate('/new')}
        >
          <span className={styles.num}>02</span>New payout
        </button>
        {showOps ? (
          <button
            type="button"
            className={`${styles.link} ${current.name === 'ops' ? styles.active : ''}`}
            onClick={() => navigate('/ops')}
          >
            <span className={styles.num}>03</span>Ops
          </button>
        ) : null}
      </nav>
      <div className={styles.account}>
        <b>Funding account</b>
        ••••2290
        <div className={styles.footer}>
          <ThemeSwitch />
        </div>
      </div>
    </aside>
  );
}
