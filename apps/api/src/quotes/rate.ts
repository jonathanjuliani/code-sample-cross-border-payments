import { BASE_RATE_E4 } from '@payout/shared';

/** Quote rate: BASE_RATE_E4 ± jitter. Phase 4 replaces the source; keep this a function. */
export function currentRateE4(jitterE4: number, random: () => number = Math.random): number {
  if (jitterE4 <= 0) {
    return BASE_RATE_E4;
  }
  const delta = Math.floor(random() * (jitterE4 * 2 + 1)) - jitterE4;
  return BASE_RATE_E4 + delta;
}
