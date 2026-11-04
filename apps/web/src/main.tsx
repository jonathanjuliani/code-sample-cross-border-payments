import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/fonts.ts';
import './styles/tokens/primitives.css';
import './styles/tokens/roles.css';
import './styles/base.css';
import styles from './app.module.css';

function App() {
  return (
    <main className={styles.page}>
      <header className={styles.head}>
        <p className={styles.eyebrow}>Cross-border</p>
        <h1 className={styles.title}>Payouts</h1>
        <p className={styles.lede}>Foundation placeholder. Screens arrive in a later phase.</p>
      </header>
    </main>
  );
}

const root = document.getElementById('root');
if (!root) {
  throw new Error('Missing #root');
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
