import type { Provider, ProviderStatus } from '../types.ts';
import { simDelay } from './clock.ts';
import { deliverEvent, enqueueSimJob, newEventId, type WebhookPoster } from './deliver.ts';
import { getFlags } from './flags.ts';
import type { SimRecords } from './records.ts';

type Payload = { payoutId?: string; amountMinor?: number; providerRef?: string };

export function createCollectProvider(
  post: WebhookPoster,
  records: SimRecords,
): { collect: Provider; refund: Provider } {
  const seqByRef = new Map<string, number>();

  function nextSeq(ref: string): number {
    const n = (seqByRef.get(ref) ?? 0) + 1;
    seqByRef.set(ref, n);
    return n;
  }

  const collect: Provider = {
    async submit(ref, raw) {
      const payload = raw as Payload;
      const existing = records.collect.get(ref);
      if (existing && existing.status !== 'declined') {
        return { accepted: true as const };
      }

      if (getFlags()['collect.decline']) {
        records.collect.set(ref, {
          status: 'declined',
          amountMinor: payload.amountMinor ?? 0,
        });
        return { declined: 'collect_declined' };
      }

      records.collect.set(ref, {
        status: 'accepted',
        amountMinor: payload.amountMinor ?? 0,
      });

      enqueueSimJob(async () => {
        await simDelay(1800);
        records.collect.set(ref, {
          status: 'succeeded',
          amountMinor: payload.amountMinor ?? 0,
        });
        await deliverEvent(post, 'collect', {
          eventId: newEventId(),
          providerRef: ref,
          leg: 'collect',
          status: 'succeeded',
          seq: nextSeq(ref),
        });
      });

      return { accepted: true as const };
    },

    async getStatus(ref) {
      const rec = records.collect.get(ref);
      if (!rec) return 'not_found';
      if (rec.status === 'succeeded') {
        return { status: 'succeeded', seq: seqByRef.get(ref) ?? 1 } satisfies ProviderStatus;
      }
      if (rec.status === 'declined') {
        return { status: 'declined', seq: seqByRef.get(ref) ?? 1 };
      }
      return { status: 'processing', seq: seqByRef.get(ref) ?? 1 };
    },
  };

  const refund: Provider = {
    async submit(ref, raw) {
      const payload = raw as Payload;
      if (records.refund.has(ref) && records.refund.get(ref)?.status === 'succeeded') {
        return { accepted: true as const };
      }

      records.refund.set(ref, {
        status: 'accepted',
        amountMinor: payload.amountMinor ?? 0,
      });

      enqueueSimJob(async () => {
        await simDelay(2600);
        records.refund.set(ref, {
          status: 'succeeded',
          amountMinor: payload.amountMinor ?? 0,
        });
        await deliverEvent(post, 'collect', {
          eventId: newEventId(),
          providerRef: ref,
          leg: 'refund',
          status: 'succeeded',
          seq: nextSeq(ref),
        });
      });

      return { accepted: true as const };
    },

    async getStatus(ref) {
      const rec = records.refund.get(ref);
      if (!rec) return 'not_found';
      if (rec.status === 'succeeded') {
        return { status: 'succeeded', seq: seqByRef.get(ref) ?? 1 };
      }
      return { status: 'processing', seq: seqByRef.get(ref) ?? 1 };
    },
  };

  return { collect, refund };
}
