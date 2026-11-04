import type { SimulationFlags } from '@payout/shared';

export const SWITCHES: Array<keyof SimulationFlags> = [
  'slow',
  'collect.decline',
  'transfer.timeout',
  'transfer.timeoutLost',
  'transfer.reorg',
  'deposit.rejectBank',
  'webhook.duplicate',
  'webhook.outOfOrder',
  'rate.move',
  'crash.afterCommit',
  'client.readsFail',
];
