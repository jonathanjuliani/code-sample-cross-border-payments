import type { LegName } from '@payout/shared';
import { getFlags } from './sim/flags.ts';
import { isLegSlow as simIsLegSlow } from './sim/timing.ts';

/** Sender-facing simulation hints. Domain routes depend on this port, not on providers/sim. */
export type ClientHints = {
  readsFail: () => boolean;
  isLegSlow: (input: { payoutId: string; leg: LegName; status: string; nowMs: number }) => boolean;
};

export const noopClientHints: ClientHints = {
  readsFail: () => false,
  isLegSlow: () => false,
};

/** Adapter over the in-process simulator flags and hop timers. */
export function createSimClientHints(): ClientHints {
  return {
    readsFail: () => getFlags()['client.readsFail'],
    isLegSlow: (input) =>
      simIsLegSlow({
        payoutId: input.payoutId,
        leg: input.leg,
        status: input.status,
        nowMs: input.nowMs,
        speed: getFlags().speed,
      }),
  };
}
