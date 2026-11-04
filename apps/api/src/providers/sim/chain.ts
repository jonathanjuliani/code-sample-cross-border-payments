import { type Provider, type ProviderStatus, ProviderTimeout } from '../types.ts';
import { simDelay } from './clock.ts';
import { deliverEvent, enqueueSimJob, newEventId, type WebhookPoster } from './deliver.ts';
import { getFlags } from './flags.ts';
import type { SimRecords } from './records.ts';

/** Quoted/estimate chain fee (USD minor). */
export const NETWORK_FEE_ESTIMATE_MINOR = 25;
/** Actual fee the chain reports on `final` (differs from estimate — P2). */
export const NETWORK_FEE_ACTUAL_MINOR = 40;

type Payload = { payoutId?: string; amountMinor?: number };

export type ChainProviderId = 'sim' | 'alt';

/** Hop-2 chain behind the shared `Provider` interface. `id` only changes the hash prefix (N6). */
export function createChainProvider(
  post: WebhookPoster,
  records: SimRecords,
  opts: { id?: ChainProviderId } = {},
): Provider {
  const chainId = opts.id ?? 'sim';
  const seqByRef = new Map<string, number>();
  const attemptByRef = new Map<string, number>();

  function txHashFor(ref: string): string {
    return `0x${chainId}_${ref.replace(/[^a-zA-Z0-9]/g, '')}`;
  }

  function nextSeq(ref: string): number {
    const n = (seqByRef.get(ref) ?? 0) + 1;
    seqByRef.set(ref, n);
    return n;
  }

  async function emitConfirmations(ref: string, amountMinor: number, resubmit: boolean) {
    const txHash = txHashFor(ref);
    await simDelay(1400);
    await deliverEvent(post, 'chain', {
      eventId: newEventId(),
      providerRef: ref,
      leg: 'transfer',
      status: 'submitted',
      seq: nextSeq(ref),
      detail: { txHash },
    });

    for (let n = 1; n <= 3; n++) {
      await simDelay(1100);

      if (!resubmit && getFlags()['transfer.reorg'] && n === 2) {
        records.chain.set(ref, {
          status: 'dropped',
          amountMinor,
          txHash,
        });
        await deliverEvent(post, 'chain', {
          eventId: newEventId(),
          providerRef: ref,
          leg: 'transfer',
          status: 'dropped',
          seq: nextSeq(ref),
          detail: { confirmations: 2, txHash },
        });
        return;
      }

      if (n < 3) {
        await deliverEvent(post, 'chain', {
          eventId: newEventId(),
          providerRef: ref,
          leg: 'transfer',
          status: 'confirming',
          seq: nextSeq(ref),
          detail: { confirmations: n, txHash },
        });
      } else {
        records.chain.set(ref, {
          status: 'final',
          amountMinor,
          txHash,
          networkFeeMinor: NETWORK_FEE_ACTUAL_MINOR,
          convertMinor: amountMinor,
        });
        await deliverEvent(post, 'chain', {
          eventId: newEventId(),
          providerRef: ref,
          leg: 'transfer',
          status: 'final',
          seq: nextSeq(ref),
          detail: {
            confirmations: 3,
            txHash,
            networkFeeMinor: NETWORK_FEE_ACTUAL_MINOR,
          },
        });
      }
    }
  }

  return {
    async submit(ref, raw) {
      const payload = raw as Payload;
      const amountMinor = payload.amountMinor ?? 0;
      const attempt = (attemptByRef.get(ref) ?? 0) + 1;
      attemptByRef.set(ref, attempt);
      const resubmit = attempt > 1 || (raw as { resubmit?: boolean }).resubmit === true;

      if (getFlags()['transfer.timeoutLost'] && attempt === 1) {
        await simDelay(3200);
        throw new ProviderTimeout('transfer timeout lost');
      }

      if (getFlags()['transfer.timeout'] && attempt === 1) {
        // Transfer happened; status will show final when queried.
        const txHash = txHashFor(ref);
        records.chain.set(ref, {
          status: 'final',
          amountMinor,
          txHash,
          networkFeeMinor: NETWORK_FEE_ACTUAL_MINOR,
          convertMinor: amountMinor,
        });
        seqByRef.set(ref, 1);
        await simDelay(3200);
        throw new ProviderTimeout('transfer timeout');
      }

      const existing = records.chain.get(ref);
      if (existing?.status === 'final') {
        return { accepted: true as const };
      }

      records.chain.set(ref, {
        status: 'submitted',
        amountMinor,
      });

      enqueueSimJob(() => emitConfirmations(ref, amountMinor, resubmit));
      return { accepted: true as const };
    },

    async getStatus(ref): Promise<ProviderStatus | 'not_found'> {
      const rec = records.chain.get(ref);
      if (!rec) return 'not_found';
      if (rec.status === 'final') {
        return {
          status: 'final',
          seq: Math.max(seqByRef.get(ref) ?? 1, 1),
          detail: {
            confirmations: 3,
            txHash: rec.txHash,
            networkFeeMinor: rec.networkFeeMinor ?? NETWORK_FEE_ACTUAL_MINOR,
          },
        };
      }
      if (rec.status === 'dropped') {
        return { status: 'dropped', seq: seqByRef.get(ref) ?? 1 };
      }
      return {
        status: 'confirming',
        seq: seqByRef.get(ref) ?? 1,
        detail: { confirmations: 1 },
      };
    },
  };
}
