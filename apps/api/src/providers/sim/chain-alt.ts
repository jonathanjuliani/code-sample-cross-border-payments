import type { Provider } from '../types.ts';
import { createChainProvider } from './chain.ts';
import type { WebhookPoster } from './deliver.ts';
import type { SimRecords } from './records.ts';

/**
 * Second chain implementation for N6. Same `Provider` contract as the default sim chain;
 * selected by `CHAIN_PROVIDER=alt`. payouts/ and ledger/ do not import this file.
 */
export function createAltChainProvider(post: WebhookPoster, records: SimRecords): Provider {
  return createChainProvider(post, records, { id: 'alt' });
}
