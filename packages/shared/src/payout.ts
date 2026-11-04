import { z } from 'zod';

export const PayoutStatusSchema = z.enum([
  'created',
  'collecting',
  'transferring',
  'paying_out',
  'delivered',
  'failed',
  'refunding',
  'refunded',
]);
export type PayoutStatus = z.infer<typeof PayoutStatusSchema>;

export const LegNameSchema = z.enum(['collect', 'transfer', 'deposit', 'refund']);
export type LegName = z.infer<typeof LegNameSchema>;

export const LegStatusSchema = z.enum([
  'waiting',
  'submitted',
  'checking',
  'processing',
  'confirming',
  'succeeded',
  'failed',
  'final',
  'dropped',
]);
export type LegStatus = z.infer<typeof LegStatusSchema>;

export const CreatePayoutRequestSchema = z
  .object({
    quoteId: z.string().min(1),
  })
  .strict();
export type CreatePayoutRequest = z.infer<typeof CreatePayoutRequestSchema>;

export const PayoutLegSchema = z
  .object({
    leg: LegNameSchema,
    status: LegStatusSchema,
    attempt: z.number().int().nonnegative(),
    providerRef: z.string().nullable(),
    txHash: z.string().nullable(),
    confirmations: z.number().int().nonnegative().nullable(),
    lastSeq: z.number().int().nonnegative(),
    updatedAt: z.string().datetime(),
    slow: z.boolean(),
  })
  .strict();
export type PayoutLeg = z.infer<typeof PayoutLegSchema>;

export const PayoutSchema = z
  .object({
    id: z.string().min(1),
    quoteId: z.string().min(1),
    recipientId: z.string().min(1),
    sendMinor: z.number().int().nonnegative(),
    feeMinor: z.number().int().nonnegative(),
    convertMinor: z.number().int().nonnegative(),
    receiveMinor: z.number().int().nonnegative(),
    status: PayoutStatusSchema,
    failureReason: z.string().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    finishedAt: z.string().datetime().nullable(),
    legs: z.array(PayoutLegSchema),
  })
  .strict();
export type Payout = z.infer<typeof PayoutSchema>;

export const PayoutListItemSchema = z
  .object({
    id: z.string().min(1),
    recipientId: z.string().min(1),
    sendMinor: z.number().int().nonnegative(),
    receiveMinor: z.number().int().nonnegative(),
    status: PayoutStatusSchema,
    createdAt: z.string().datetime(),
    finishedAt: z.string().datetime().nullable(),
    legs: z.array(
      z
        .object({
          leg: LegNameSchema,
          status: LegStatusSchema,
        })
        .strict(),
    ),
  })
  .strict();
export type PayoutListItem = z.infer<typeof PayoutListItemSchema>;

export const RecipientSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    city: z.string().min(1),
    country: z.string().min(1),
    currency: z.literal('MXN'),
    bankAccountMasked: z.string().min(1),
  })
  .strict();
export type Recipient = z.infer<typeof RecipientSchema>;

export const ErrorBodySchema = z
  .object({
    error: z.string().min(1),
    message: z.string().min(1),
    issues: z.array(z.unknown()).optional(),
    payoutId: z.string().optional(),
    minMinor: z.number().int().optional(),
    maxMinor: z.number().int().optional(),
  })
  .strict();
export type ErrorBody = z.infer<typeof ErrorBodySchema>;

/** Read-only testnet transfer facts for support details (N5). */
export const NetworkRefSchema = z
  .object({
    hash: z.string().min(1),
    blockNumber: z.string().nullable(),
    from: z.string().nullable(),
    to: z.string().nullable(),
    valueWei: z.string().nullable(),
    source: z.literal('testnet-rpc'),
  })
  .strict();
export type NetworkRef = z.infer<typeof NetworkRefSchema>;
