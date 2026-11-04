import { z } from 'zod';

export const QuoteModeSchema = z.enum(['send', 'receive']);
export type QuoteMode = z.infer<typeof QuoteModeSchema>;

export const QuoteStatusSchema = z.enum(['active', 'consumed', 'expired']);
export type QuoteStatus = z.infer<typeof QuoteStatusSchema>;

export const CreateQuoteRequestSchema = z
  .object({
    recipientId: z.string().min(1),
    mode: QuoteModeSchema,
    amountMinor: z.number().int().nonnegative(),
  })
  .strict();
export type CreateQuoteRequest = z.infer<typeof CreateQuoteRequestSchema>;

export const QuoteSchema = z
  .object({
    id: z.string().min(1),
    recipientId: z.string().min(1),
    mode: QuoteModeSchema,
    rateE4: z.number().int().positive(),
    sendMinor: z.number().int().nonnegative(),
    feeMinor: z.number().int().nonnegative(),
    convertMinor: z.number().int().nonnegative(),
    receiveMinor: z.number().int().nonnegative(),
    createdAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    status: QuoteStatusSchema,
    serverNow: z.string().datetime(),
  })
  .strict();
export type Quote = z.infer<typeof QuoteSchema>;

export const ExpireQuoteRequestSchema = z
  .object({
    ms: z.number().int().nonnegative(),
  })
  .strict();
export type ExpireQuoteRequest = z.infer<typeof ExpireQuoteRequestSchema>;
