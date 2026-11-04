import type { FastifyInstance } from 'fastify';
import type { Clock } from '../../clock.ts';
import type { ProviderMap } from '../types.ts';
import { type ChainProviderId, createChainProvider } from './chain.ts';
import { createAltChainProvider } from './chain-alt.ts';
import {
  createEagerSimScheduler,
  createQueuedSimScheduler,
  createRealSimScheduler,
  setSimScheduler,
  simDelay,
} from './clock.ts';
import { createCollectProvider } from './collect.ts';
import { createInjectPoster, settleSimJobs } from './deliver.ts';
import {
  bindFlagRecorder,
  consumeCrashAfterCommit,
  getFlags,
  loadFlagsFromEnv,
  resetFlags,
  setFlags,
} from './flags.ts';
import { createOfframpProvider } from './offramp.ts';
import { clearSimRecords, createSimRecords, type SimRecords } from './records.ts';
import { clearAllLegStarts, isLegSlow, markLegStarted } from './timing.ts';

export type SimBundle = {
  providers: ProviderMap;
  records: SimRecords;
  resetRecords: () => void;
  chainProvider: ChainProviderId;
};

export function createSimBundle(
  app: FastifyInstance,
  deps: { secret: string; clock: Clock; chainProvider?: ChainProviderId },
): SimBundle {
  const chainProvider = deps.chainProvider ?? 'sim';
  const records = createSimRecords();
  const post = createInjectPoster(app, deps);
  const { collect, refund } = createCollectProvider(post, records);
  const transfer =
    chainProvider === 'alt'
      ? createAltChainProvider(post, records)
      : createChainProvider(post, records);
  const deposit = createOfframpProvider(post, records);

  return {
    providers: { collect, transfer, deposit, refund },
    records,
    resetRecords: () => clearSimRecords(records),
    chainProvider,
  };
}

export { NETWORK_FEE_ACTUAL_MINOR, NETWORK_FEE_ESTIMATE_MINOR } from './chain.ts';
export {
  bindFlagRecorder,
  clearAllLegStarts,
  consumeCrashAfterCommit,
  createEagerSimScheduler,
  createQueuedSimScheduler,
  createRealSimScheduler,
  getFlags,
  isLegSlow,
  loadFlagsFromEnv,
  markLegStarted,
  resetFlags,
  setFlags,
  setSimScheduler,
  settleSimJobs,
  simDelay,
};
