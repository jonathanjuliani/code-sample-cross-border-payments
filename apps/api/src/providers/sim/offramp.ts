import { BASE_RATE_E4 } from '@payout/shared';
import type { Provider, ProviderStatus } from '../types.ts';
import { simDelay } from './clock.ts';
import { deliverEvent, enqueueSimJob, newEventId, type WebhookPoster } from './deliver.ts';
import { getFlags } from './flags.ts';
import type { SimRecords } from './records.ts';

type Payload = {
  payoutId?: string;
  amountMinor?: number;
  receiveMinor?: number;
  rateE4?: number;
};

export function createOfframpProvider(post: WebhookPoster, records: SimRecords): Provider {
  const seqByRef = new Map<string, number>();

  function nextSeq(ref: string): number {
    const n = (seqByRef.get(ref) ?? 0) + 1;
    seqByRef.set(ref, n);
    return n;
  }

  return {
    async submit(ref, raw) {
      const payload = raw as Payload;
      const amountMinor = payload.amountMinor ?? 0;
      const quotedRate = payload.rateE4 ?? BASE_RATE_E4;
      const rateMoved = getFlags()['rate.move'];
      const rateE4 = rateMoved ? Math.floor(quotedRate * 0.98) : quotedRate;

      if (records.offramp.get(ref)?.status === 'succeeded') {
        return { accepted: true as const };
      }

      records.offramp.set(ref, {
        status: 'processing',
        amountMinor,
        rateE4,
        convertMinor: amountMinor,
      });

      enqueueSimJob(async () => {
        await simDelay(1800);

        if (getFlags()['deposit.rejectBank']) {
          records.offramp.set(ref, {
            status: 'rejected',
            amountMinor,
            rateE4,
          });
          await deliverEvent(post, 'offramp', {
            eventId: newEventId(),
            providerRef: ref,
            leg: 'deposit',
            status: 'processing',
            seq: nextSeq(ref),
          });
          await simDelay(600);
          await deliverEvent(post, 'offramp', {
            eventId: newEventId(),
            providerRef: ref,
            leg: 'deposit',
            status: 'rejected',
            seq: nextSeq(ref),
          });
          return;
        }

        if (getFlags()['webhook.outOfOrder']) {
          const ok = newEventId();
          const processing = newEventId();
          const seqProcessing = nextSeq(ref);
          const seqSucceeded = nextSeq(ref);
          records.offramp.set(ref, {
            status: 'succeeded',
            amountMinor,
            rateE4,
          });
          // Succeeded (higher seq) before processing.
          await deliverEvent(post, 'offramp', {
            eventId: ok,
            providerRef: ref,
            leg: 'deposit',
            status: 'succeeded',
            seq: seqSucceeded,
            detail: { rateMoved },
          });
          await deliverEvent(post, 'offramp', {
            eventId: processing,
            providerRef: ref,
            leg: 'deposit',
            status: 'processing',
            seq: seqProcessing,
          });
          return;
        }

        await deliverEvent(post, 'offramp', {
          eventId: newEventId(),
          providerRef: ref,
          leg: 'deposit',
          status: 'processing',
          seq: nextSeq(ref),
        });
        await simDelay(600);
        records.offramp.set(ref, {
          status: 'succeeded',
          amountMinor,
          rateE4,
        });
        await deliverEvent(post, 'offramp', {
          eventId: newEventId(),
          providerRef: ref,
          leg: 'deposit',
          status: 'succeeded',
          seq: nextSeq(ref),
          detail: { rateMoved },
        });
      });

      return { accepted: true as const };
    },

    async getStatus(ref): Promise<ProviderStatus | 'not_found'> {
      const rec = records.offramp.get(ref);
      if (!rec) return 'not_found';
      if (rec.status === 'succeeded') {
        return {
          status: 'succeeded',
          seq: seqByRef.get(ref) ?? 1,
          detail: { rateMoved: getFlags()['rate.move'] },
        };
      }
      if (rec.status === 'rejected') {
        return { status: 'rejected', seq: seqByRef.get(ref) ?? 1 };
      }
      return { status: 'processing', seq: seqByRef.get(ref) ?? 1 };
    },
  };
}
