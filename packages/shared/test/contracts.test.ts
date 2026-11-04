import { describe, expect, it } from 'vitest';
import { WebhookEventSchema } from '../src/events.ts';
import { SimulationFlagsSchema } from '../src/ops.ts';
import { CreatePayoutRequestSchema, PayoutSchema } from '../src/payout.ts';
import { CreateQuoteRequestSchema, QuoteSchema } from '../src/quote.ts';

const quoteExample = {
  id: 'q_7k2m9x4p1t8c',
  recipientId: 'r1',
  mode: 'receive' as const,
  rateE4: 172_500,
  sendMinor: 249_363,
  feeMinor: 1_247,
  convertMinor: 248_116,
  receiveMinor: 4_280_000,
  createdAt: '2026-11-03T15:00:00.000Z',
  expiresAt: '2026-11-03T15:01:00.000Z',
  status: 'active' as const,
  serverNow: '2026-11-03T15:00:00.000Z',
};

const payoutExample = {
  id: 'PO-1041',
  quoteId: 'q_7k2m9x4p1t8c',
  recipientId: 'r1',
  sendMinor: 249_363,
  feeMinor: 1_247,
  convertMinor: 248_116,
  receiveMinor: 4_280_000,
  status: 'created' as const,
  failureReason: null,
  createdAt: '2026-11-03T15:00:10.000Z',
  updatedAt: '2026-11-03T15:00:10.000Z',
  finishedAt: null,
  legs: [
    {
      leg: 'collect' as const,
      status: 'waiting' as const,
      attempt: 0,
      providerRef: 'PO-1041-C1',
      txHash: null,
      confirmations: null,
      lastSeq: 0,
      updatedAt: '2026-11-03T15:00:10.000Z',
      slow: false,
    },
  ],
};

const webhookExample = {
  eventId: 'evt_3n8q7k2m9x4p',
  providerRef: 'PO-1041-T1',
  leg: 'transfer' as const,
  status: 'final' as const,
  seq: 4,
  detail: { confirmations: 3 },
};

describe('CreateQuoteRequestSchema', () => {
  it('accepts the PLAN example shape', () => {
    expect(
      CreateQuoteRequestSchema.parse({
        recipientId: 'r1',
        mode: 'receive',
        amountMinor: 4_280_000,
      }),
    ).toEqual({ recipientId: 'r1', mode: 'receive', amountMinor: 4_280_000 });
  });

  it('rejects a float amount', () => {
    expect(() =>
      CreateQuoteRequestSchema.parse({
        recipientId: 'r1',
        mode: 'send',
        amountMinor: 10.5,
      }),
    ).toThrow();
  });

  it('rejects a negative amount', () => {
    expect(() =>
      CreateQuoteRequestSchema.parse({
        recipientId: 'r1',
        mode: 'send',
        amountMinor: -1,
      }),
    ).toThrow();
  });
});

describe('QuoteSchema', () => {
  it('accepts the PLAN example quote', () => {
    expect(QuoteSchema.parse(quoteExample).id).toBe('q_7k2m9x4p1t8c');
  });
});

describe('CreatePayoutRequestSchema and PayoutSchema', () => {
  it('accepts { quoteId } and the PLAN payout example', () => {
    expect(CreatePayoutRequestSchema.parse({ quoteId: 'q_7k2m9x4p1t8c' })).toEqual({
      quoteId: 'q_7k2m9x4p1t8c',
    });
    expect(PayoutSchema.parse(payoutExample).id).toBe('PO-1041');
  });

  it('rejects a float amount on a payout', () => {
    expect(() => PayoutSchema.parse({ ...payoutExample, sendMinor: 249_363.5 })).toThrow();
  });
});

describe('WebhookEventSchema', () => {
  it('accepts the PLAN webhook example', () => {
    expect(WebhookEventSchema.parse(webhookExample).eventId).toBe('evt_3n8q7k2m9x4p');
  });
});

describe('SimulationFlagsSchema', () => {
  it('accepts every §11 switch with speed 1|3|10', () => {
    const parsed = SimulationFlagsSchema.parse({
      slow: true,
      'collect.decline': false,
      'transfer.timeout': false,
      'transfer.timeoutLost': false,
      'transfer.reorg': false,
      'deposit.rejectBank': false,
      'webhook.duplicate': false,
      'webhook.outOfOrder': false,
      'rate.move': false,
      'crash.afterCommit': false,
      'client.readsFail': false,
      speed: 3,
    });
    expect(parsed.speed).toBe(3);
    expect(parsed.slow).toBe(true);
  });

  it('rejects an unknown simulation switch', () => {
    expect(() =>
      SimulationFlagsSchema.parse({
        slow: false,
        speed: 1,
        'unknown.switch': true,
      }),
    ).toThrow();
  });
});
