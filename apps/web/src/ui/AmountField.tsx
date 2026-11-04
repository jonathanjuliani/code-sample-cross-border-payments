import { useEffect, useState } from 'react';
import styles from './AmountField.module.css';

/** Parse a typed decimal string into minor units (integer cents). */
export function parseAmountToMinor(raw: string): number | null {
  const cleaned = raw.replace(/,/g, '').trim();
  if (!cleaned) return null;
  const m = cleaned.match(/^(\d+)(?:\.(\d{0,2}))?$/);
  if (!m) return null;
  const whole = Number(m[1]);
  const frac = (m[2] ?? '').padEnd(2, '0').slice(0, 2);
  if (!Number.isInteger(whole) || whole < 0) return null;
  return whole * 100 + Number(frac || '0');
}

function formatFromMinor(minor: number | null): string {
  if (minor == null) return '';
  const whole = Math.trunc(minor / 100);
  const frac = String(minor % 100).padStart(2, '0');
  return `${whole}.${frac}`;
}

export function AmountField({
  currency,
  valueMinor,
  onChange,
  id,
  label,
}: {
  currency: string;
  valueMinor: number | null;
  onChange: (minor: number | null) => void;
  id: string;
  label: string;
}) {
  const [text, setText] = useState(formatFromMinor(valueMinor));
  useEffect(() => {
    setText(formatFromMinor(valueMinor));
  }, [valueMinor]);

  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <div className={styles.root}>
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          value={text}
          onChange={(e) => {
            const next = e.target.value;
            setText(next);
            onChange(parseAmountToMinor(next));
          }}
        />
        <span className={styles.cur}>{currency}</span>
      </div>
    </div>
  );
}
