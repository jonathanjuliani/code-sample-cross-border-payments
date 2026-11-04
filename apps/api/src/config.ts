import { z } from 'zod';

const StatusBackoffSchema = z
  .string()
  .default('1000,2000,4000,8000')
  .transform((value, ctx) => {
    const parts = value.split(',').map((part) => Number(part.trim()));
    if (parts.length === 0 || parts.some((n) => !Number.isInteger(n) || n <= 0)) {
      ctx.addIssue({ code: 'custom', message: 'STATUS_BACKOFF_MS must be positive integers' });
      return z.NEVER;
    }
    return parts;
  });

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  WEB_PORT: z.coerce.number().int().positive().default(8801),
  DB_PATH: z.string().default('./data/payouts.db'),
  OPS_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  ACCOUNT_ID: z.string().min(1).default('acct_demo'),
  QUOTE_TTL_MS: z.coerce.number().int().positive().default(60_000),
  WORKER_INTERVAL_MS: z.coerce.number().int().positive().default(250),
  STATUS_BACKOFF_MS: StatusBackoffSchema,
  PROVIDER_WINDOW_MS: z.coerce.number().int().positive().default(30_000),
  CHECKING_GIVE_UP_MS: z.coerce.number().int().positive().default(600_000),
  STUCK_AFTER_MS: z.coerce.number().int().positive().default(300_000),
  SIM_FLAGS: z.string().optional(),
  SIM_RATE_JITTER_E4: z.coerce.number().int().nonnegative().default(150),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  APP_VERSION: z.string().default('0.1.0'),
  /** Shared HMAC secret for `POST /webhooks/*`. Sample default; override in real deploys. */
  WEBHOOK_SECRET: z.string().min(8).default('whsec_demo_sample'),
});

export type AppConfig = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return EnvSchema.parse(env);
}
