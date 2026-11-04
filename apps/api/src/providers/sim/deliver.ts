import type { WebhookEvent, WebhookProvider } from '@payout/shared';
import type { FastifyInstance } from 'fastify';
import type { Clock } from '../../clock.ts';
import { randomBase32 } from '../../util/ids.ts';
import { signWebhook } from '../../webhooks/sign.ts';
import { simDelay } from './clock.ts';
import { consumeWebhookDuplicate } from './flags.ts';

export type WebhookPoster = (provider: WebhookProvider, event: WebhookEvent) => Promise<void>;

const pendingJobs: Promise<void>[] = [];

/** Track background sim progress so tests can await settlement. */
export function enqueueSimJob(job: () => Promise<void>): void {
  const p = job().catch(() => undefined);
  pendingJobs.push(p);
  void p.finally(() => {
    const i = pendingJobs.indexOf(p);
    if (i >= 0) pendingJobs.splice(i, 1);
  });
}

export async function settleSimJobs(): Promise<void> {
  while (pendingJobs.length > 0) {
    await Promise.all([...pendingJobs]);
  }
}

export function createInjectPoster(
  app: FastifyInstance,
  deps: { secret: string; clock: Clock },
): WebhookPoster {
  return async (provider, event) => {
    const body = JSON.stringify(event);
    const timestamp = String(Math.floor(deps.clock.now().getTime() / 1000));
    const signature = signWebhook(deps.secret, timestamp, body);
    const res = await app.inject({
      method: 'POST',
      url: `/webhooks/${provider}`,
      headers: {
        'content-type': 'application/json',
        timestamp,
        signature,
      },
      payload: body,
    });
    if (res.statusCode >= 400) {
      app.log.warn(
        { statusCode: res.statusCode, body: res.body, event },
        'sim webhook delivery failed',
      );
    }
  };
}

/** Post an event; if webhook.duplicate is on, send the next one twice (one-shot). */
export async function deliverEvent(
  post: WebhookPoster,
  provider: WebhookProvider,
  event: WebhookEvent,
): Promise<void> {
  await post(provider, event);

  if (consumeWebhookDuplicate()) {
    await simDelay(400);
    await post(provider, event);
  }
}

export function newEventId(): string {
  return `evt_${randomBase32(12)}`;
}
