import { useEffect, useRef, useState } from 'react';

const BACKOFF_MS = [1000, 2000, 4000, 10_000];

export function usePoll(
  fn: () => Promise<boolean>,
  intervalMs: number,
  opts: { while: boolean },
): { lastConfirmedAt: Date | null; offline: boolean } {
  const [lastConfirmedAt, setLastConfirmedAt] = useState<Date | null>(null);
  const [offline, setOffline] = useState(false);
  const failCount = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (!opts.while) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      if (cancelled) return;
      const ok = await fnRef.current();
      if (cancelled) return;
      if (ok) {
        failCount.current = 0;
        setOffline(false);
        setLastConfirmedAt(new Date());
        timer = setTimeout(tick, intervalMs);
      } else {
        setOffline(true);
        const delay = BACKOFF_MS[Math.min(failCount.current, BACKOFF_MS.length - 1)] ?? 10_000;
        failCount.current += 1;
        timer = setTimeout(tick, delay);
      }
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [intervalMs, opts.while]);

  return { lastConfirmedAt, offline };
}
