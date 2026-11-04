import type { FastifyInstance } from 'fastify';
import type { ProviderMap } from '../types.ts';
import { createChainProvider } from './chain.ts';
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
};

export function createSimBundle(app: FastifyInstance): SimBundle {
  const records = createSimRecords();
  const post = createInjectPoster(app);
  const { collect, refund } = createCollectProvider(post, records);
  const transfer = createChainProvider(post, records);
  const deposit = createOfframpProvider(post, records);

  return {
    providers: { collect, transfer, deposit, refund },
    records,
    resetRecords: () => clearSimRecords(records),
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
