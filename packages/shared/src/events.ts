import { z } from 'zod';
import { LegNameSchema } from './payout.ts';

export const WebhookProviderSchema = z.enum(['collect', 'chain', 'offramp']);
export type WebhookProvider = z.infer<typeof WebhookProviderSchema>;

export const WebhookEventStatusSchema = z.enum([
  'processing',
  'succeeded',
  'declined',
  'submitted',
  'confirming',
  'dropped',
  'final',
  'rejected',
]);
export type WebhookEventStatus = z.infer<typeof WebhookEventStatusSchema>;

export const WebhookEventSchema = z
  .object({
    eventId: z.string().min(1),
    providerRef: z.string().min(1),
    leg: LegNameSchema,
    status: WebhookEventStatusSchema,
    seq: z.number().int().positive(),
    detail: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type WebhookEvent = z.infer<typeof WebhookEventSchema>;

export const WebhookResponseSchema = z
  .object({
    ok: z.literal(true),
    ignored: z.enum(['duplicate', 'stale']).optional(),
  })
  .strict();
export type WebhookResponse = z.infer<typeof WebhookResponseSchema>;

export const LedgerEntrySchema = z
  .object({
    id: z.string().min(1),
    payoutId: z.string().min(1),
    journalId: z.string().min(1),
    account: z.string().min(1),
    currency: z.enum(['USD', 'DUSD', 'MXN']),
    amountMinor: z.number().int(),
    memo: z.string(),
    createdAt: z.string().datetime(),
  })
  .strict();
export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;

export const LedgerResponseSchema = z
  .object({
    entries: z.array(LedgerEntrySchema),
    sums: z.record(z.string(), z.number().int()),
  })
  .strict();
export type LedgerResponse = z.infer<typeof LedgerResponseSchema>;

export const ReconciliationItemSchema = z
  .object({
    payoutId: z.string().min(1),
    mismatches: z.array(z.string()),
    fxVarianceMinor: z.number().int(),
    networkFeeExpenseMinor: z.number().int().default(0),
  })
  .strict();
export type ReconciliationItem = z.infer<typeof ReconciliationItemSchema>;

export const ReconciliationResponseSchema = z
  .object({
    items: z.array(ReconciliationItemSchema),
    totals: z
      .object({
        fxVarianceMinor: z.number().int(),
        networkFeeExpenseMinor: z.number().int(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type ReconciliationResponse = z.infer<typeof ReconciliationResponseSchema>;
