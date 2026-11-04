import { useEffect, useState } from 'react';
import styles from './ThemeSwitch.module.css';

type Mode = 'system' | 'light' | 'dark';

function apply(mode: Mode) {
  const root = document.documentElement;
  if (mode === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', mode);
  try {
    if (mode === 'system') localStorage.removeItem('theme');
    else localStorage.setItem('theme', mode);
  } catch {
    /* ignore */
  }
}

export function ThemeSwitch() {
  const [mode, setMode] = useState<Mode>('system');
  useEffect(() => {
    try {
      const stored = localStorage.getItem('theme');
      if (stored === 'light' || stored === 'dark') {
        setMode(stored);
        apply(stored);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const choose = (next: Mode) => {
    setMode(next);
    apply(next);
  };

  const labels = { system: 'System', light: 'Light', dark: 'Dark' } as const;
  return (
    <fieldset className={styles.root} aria-label="Theme">
      {(['system', 'light', 'dark'] as const).map((m) => (
        <button key={m} type="button" aria-pressed={mode === m} onClick={() => choose(m)}>
          {labels[m]}
        </button>
      ))}
    </fieldset>
  );
}
