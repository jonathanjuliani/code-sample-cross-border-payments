import { useEffect, useRef, useState } from 'react';
import styles from './HoldBar.module.css';

export function HoldBar({
  expiresAt,
  serverNow,
  receivedAt,
}: {
  expiresAt: string;
  serverNow: string;
  receivedAt: number;
}) {
  const [now, setNow] = useState(() => Date.now());
  const announced = useRef(false);
  const skew = receivedAt - Date.parse(serverNow);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  const expiresMs = Date.parse(expiresAt);
  const serverAligned = now - skew;
  const total = expiresMs - Date.parse(serverNow);
  const left = Math.max(0, expiresMs - serverAligned);
  const pct = total > 0 ? Math.min(100, (left / total) * 100) : 0;
  const low = left <= 10_000 && left > 0;
  const secs = Math.ceil(left / 1000);

  useEffect(() => {
    if (low && !announced.current) {
      announced.current = true;
    }
  }, [low]);

  return (
    <div className={low ? styles.low : undefined}>
      <div className={styles.bar} aria-hidden>
        <span className={styles.fill} style={{ width: `${pct}%` }} />
      </div>
      <p className={styles.text} aria-live={low ? 'polite' : undefined}>
        {left <= 0
          ? 'Rate expired'
          : low
            ? `Rate held for ${secs}s. Confirm now or get a new rate.`
            : `Rate held for ${secs}s`}
      </p>
    </div>
  );
}
