import { useEffect, useState } from 'react';
import { usePoll } from './poll.ts';
import { openSse } from './sse.ts';

export function useLiveOps(opts: { while: boolean; load: () => Promise<boolean> }): {
  transport: 'sse' | 'poll';
  offline: boolean;
  lastConfirmedAt: Date | null;
} {
  const [preferSse, setPreferSse] = useState(true);
  const [sseLive, setSseLive] = useState(false);
  const [lastConfirmedAt, setLastConfirmedAt] = useState<Date | null>(null);

  useEffect(() => {
    if (!opts.while || !preferSse) return;
    const stop = openSse('/ops/stream', {
      onOpen: () => setSseLive(true),
      onEvent: (event) => {
        if (event !== 'ops') return;
        setSseLive(true);
        setLastConfirmedAt(new Date());
        void opts.load();
      },
      onError: () => {
        setSseLive(false);
        setPreferSse(false);
      },
    });
    return () => {
      stop();
      setSseLive(false);
    };
  }, [opts.while, preferSse, opts.load]);

  const poll = usePoll(opts.load, 2000, { while: opts.while && !preferSse });

  return {
    transport: preferSse && sseLive ? 'sse' : 'poll',
    offline: preferSse ? false : poll.offline,
    lastConfirmedAt: preferSse ? lastConfirmedAt : poll.lastConfirmedAt,
  };
}
