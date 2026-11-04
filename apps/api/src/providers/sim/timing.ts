/** Normal hop totals at 1× speed (PLAN §19), used for the per-leg `slow` flag. */
export const HOP_NORMAL_MS = {
  collect: 1800,
  transfer: 1400 + 3 * 1100,
  deposit: 1800 + 600,
  refund: 2600,
} as const;

const legStartedAt = new Map<string, number>();

function key(payoutId: string, leg: string): string {
  return `${payoutId}:${leg}`;
}

export function markLegStarted(payoutId: string, leg: string, atMs: number): void {
  const k = key(payoutId, leg);
  if (!legStartedAt.has(k)) {
    legStartedAt.set(k, atMs);
  }
}

export function clearLegStarted(payoutId: string, leg: string): void {
  legStartedAt.delete(key(payoutId, leg));
}

export function clearAllLegStarts(): void {
  legStartedAt.clear();
}

export function legStartMs(payoutId: string, leg: string): number | undefined {
  return legStartedAt.get(key(payoutId, leg));
}

const DONE = new Set(['waiting', 'succeeded', 'failed', 'final']);

export function isLegSlow(input: {
  payoutId: string;
  leg: keyof typeof HOP_NORMAL_MS;
  status: string;
  nowMs: number;
  speed: 1 | 3 | 10;
}): boolean {
  if (DONE.has(input.status)) return false;
  const started = legStartedAt.get(key(input.payoutId, input.leg));
  if (started === undefined) return false;
  const normal = HOP_NORMAL_MS[input.leg];
  const threshold = (normal * 3) / input.speed;
  return input.nowMs - started > threshold;
}
