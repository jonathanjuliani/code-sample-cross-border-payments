import { z } from 'zod';
import { PayoutStatusSchema } from './payout.ts';

export const SimulationFlagsSchema = z
  .object({
    slow: z.boolean().default(false),
    'collect.decline': z.boolean().default(false),
    'transfer.timeout': z.boolean().default(false),
    'transfer.timeoutLost': z.boolean().default(false),
    'transfer.reorg': z.boolean().default(false),
    'deposit.rejectBank': z.boolean().default(false),
    'webhook.duplicate': z.boolean().default(false),
    'webhook.outOfOrder': z.boolean().default(false),
    'rate.move': z.boolean().default(false),
    'crash.afterCommit': z.boolean().default(false),
    'client.readsFail': z.boolean().default(false),
    speed: z.union([z.literal(1), z.literal(3), z.literal(10)]).default(1),
  })
  .strict();
export type SimulationFlags = z.infer<typeof SimulationFlagsSchema>;

export const OpsEventKindSchema = z.enum([
  'api',
  'db',
  'state',
  'webhook',
  'worker',
  'provider',
  'ledger',
  'sim',
]);
export type OpsEventKind = z.infer<typeof OpsEventKindSchema>;

export const OpsEventSchema = z
  .object({
    id: z.number().int().positive(),
    at: z.string().datetime(),
    kind: OpsEventKindSchema,
    level: z.enum(['info', 'warn', 'error']),
    payoutId: z.string().nullable(),
    message: z.string(),
    data: z.record(z.string(), z.unknown()).nullable(),
  })
  .strict();
export type OpsEvent = z.infer<typeof OpsEventSchema>;

export const OpsSummarySchema = z
  .object({
    payoutsByStatus: z.record(PayoutStatusSchema, z.number().int().nonnegative()),
    idempotentReplays: z.number().int().nonnegative(),
    conflicts409: z.number().int().nonnegative(),
    expired410: z.number().int().nonnegative(),
    webhooksIgnoredDuplicate: z.number().int().nonnegative(),
    webhooksIgnoredStale: z.number().int().nonnegative(),
    refusedTransitions: z.number().int().nonnegative(),
    outboxPending: z.number().int().nonnegative(),
    outboxOldestAgeMs: z.number().int().nonnegative().nullable(),
    workerLastTickAt: z.string().datetime().nullable(),
    stuck: z.array(
      z
        .object({
          payoutId: z.string(),
          leg: z.string(),
          status: z.string(),
          ageMs: z.number().int().nonnegative(),
        })
        .strict(),
    ),
  })
  .strict();
export type OpsSummary = z.infer<typeof OpsSummarySchema>;

export const OpsConfigSchema = z
  .object({
    quoteTtlMs: z.number().int().positive(),
    feeBps: z.number().int().nonnegative(),
    feeMinMinor: z.number().int().nonnegative(),
    sendMinMinor: z.number().int().positive(),
    sendMaxMinor: z.number().int().positive(),
    confirmations: z.number().int().positive(),
    workerIntervalMs: z.number().int().positive(),
    stuckAfterMs: z.number().int().positive(),
    dbPath: z.string(),
    appVersion: z.string(),
    opsEnabled: z.boolean(),
  })
  .strict();
export type OpsConfig = z.infer<typeof OpsConfigSchema>;
