import { type Payout, PayoutSchema } from '@payout/shared';
import { useCallback, useEffect, useState } from 'react';
import { request } from './api.ts';
import { usePoll } from './poll.ts';
import { openSse } from './sse.ts';

export function useLivePayout(
  id: string,
  opts: { while: boolean },
): {
  payout: Payout | null;
  offline: boolean;
  lastConfirmedAt: Date | null;
  transport: 'sse' | 'poll';
} {
  const [payout, setPayout] = useState<Payout | null>(null);
  const [preferSse, setPreferSse] = useState(true);
  const [sseLive, setSseLive] = useState(false);
  const [lastConfirmedAt, setLastConfirmedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    const res = await request(`/payouts/${encodeURIComponent(id)}`, {
      method: 'GET',
      schema: PayoutSchema,
    });
    if (!res.ok) return false;
    setPayout(res.data);
    setLastConfirmedAt(new Date());
    return true;
  }, [id]);

  const final =
    payout?.status === 'delivered' || payout?.status === 'failed' || payout?.status === 'refunded';
  const shouldLive = opts.while && !final;

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!shouldLive || !preferSse) return;

    const stop = openSse(`/payouts/${encodeURIComponent(id)}/stream`, {
      onOpen: () => setSseLive(true),
      onEvent: (event, data) => {
        if (event === 'error') {
          setSseLive(false);
          setPreferSse(false);
          return;
        }
        if (event !== 'payout') return;
        const parsed = PayoutSchema.safeParse(data);
        if (!parsed.success) return;
        setPayout(parsed.data);
        setLastConfirmedAt(new Date());
        setSseLive(true);
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
  }, [id, shouldLive, preferSse]);

  const poll = usePoll(load, 1000, { while: shouldLive && !preferSse });

  return {
    payout,
    offline: preferSse ? false : poll.offline,
    lastConfirmedAt: preferSse ? lastConfirmedAt : poll.lastConfirmedAt,
    transport: preferSse && sseLive ? 'sse' : 'poll',
  };
}
