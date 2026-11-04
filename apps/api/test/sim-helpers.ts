import type { SimulationFlags } from '@payout/shared';
import { seedIfEmpty } from '../seed/seed.ts';
import { buildApp } from '../src/app.ts';
import { createFakeClock } from '../src/clock.ts';
import { loadConfig } from '../src/config.ts';
import { openDb } from '../src/db/open.ts';
import { assertBalanced, journalSums } from '../src/ledger/balances.ts';
import { startWorker, type Worker } from '../src/outbox/worker.ts';
import type { QueuedSimScheduler } from '../src/providers/sim/clock.ts';
import {
  bindFlagRecorder,
  clearAllLegStarts,
  createEagerSimScheduler,
  createQueuedSimScheduler,
  createSimBundle,
  resetFlags,
  type SimBundle,
  setFlags,
  setSimScheduler,
  settleSimJobs,
} from '../src/providers/sim/index.ts';
import type { SimRecords } from '../src/providers/sim/records.ts';
import { createQuote, newIdempotencyKey, type TestContext } from './helpers.ts';

const FINAL = new Set(['delivered', 'failed', 'refunded']);

export type SimTestContext = TestContext & {
  sim: SimBundle;
  worker: Worker;
  queued: QueuedSimScheduler | null;
};

export async function createSimTestContext(
  env: Record<string, string> = {},
  opts: { queued?: boolean } = {},
): Promise<SimTestContext> {
  const db = openDb(':memory:');
  const clock = createFakeClock(Date.parse('2026-11-03T15:00:00.000Z'));
  seedIfEmpty(db, clock);
  const config = loadConfig({
    ACCOUNT_ID: 'acct_demo',
    APP_VERSION: '0.1.0-test',
    LOG_LEVEL: 'silent',
    SIM_RATE_JITTER_E4: '0',
    QUOTE_TTL_MS: '60000',
    OPS_ENABLED: 'true',
    STATUS_BACKOFF_MS: '50,50,50,50',
    PROVIDER_WINDOW_MS: '200',
    CHECKING_GIVE_UP_MS: '600000',
    STUCK_AFTER_MS: '1000',
    WORKER_INTERVAL_MS: '60000',
    ...env,
  });

  let worker: Worker | null = null;
  let records: SimRecords = {
    collect: new Map(),
    chain: new Map(),
    offramp: new Map(),
    refund: new Map(),
  };

  const app = await buildApp({
    db,
    clock,
    config,
    getWorkerLastTickAt: () => worker?.lastTickAt() ?? null,
    getSimRecords: () => records,
  });

  bindFlagRecorder(db, clock, app.log);
  resetFlags();
  clearAllLegStarts();

  let queued: QueuedSimScheduler | null = null;
  if (opts.queued) {
    queued = createQueuedSimScheduler(() => clock.now().getTime());
    setSimScheduler(queued);
  } else {
    setSimScheduler(createEagerSimScheduler(clock));
  }

  const sim = createSimBundle(app, { secret: config.WEBHOOK_SECRET, clock });
  records = sim.records;

  worker = startWorker({
    db,
    clock,
    log: app.log,
    config,
    providers: sim.providers,
  });

  const ctx: SimTestContext = {
    app,
    db,
    clock,
    config,
    accountHeaders: { 'x-account-id': 'acct_demo' },
    sim,
    worker,
    queued,
    close: async () => {
      worker?.stop();
      queued?.clear();
      resetFlags();
      clearAllLegStarts();
      await app.close();
    },
  };
  return ctx;
}

async function flush(ctx: SimTestContext): Promise<void> {
  if (ctx.queued) {
    for (let i = 0; i < 10; i++) {
      ctx.queued.releaseDue(ctx.clock.now().getTime());
      await Promise.resolve();
    }
    return;
  }
  for (let i = 0; i < 5; i++) {
    await settleSimJobs();
    await Promise.resolve();
  }
}

function nextOutboxDueMs(ctx: SimTestContext): number | null {
  const now = ctx.clock.now().toISOString();
  const row = ctx.db
    .prepare(
      `SELECT due_at FROM outbox
       WHERE sent_at IS NULL AND due_at IS NOT NULL AND due_at > @now
       ORDER BY due_at ASC LIMIT 1`,
    )
    .get({ now }) as { due_at: string } | undefined;
  return row ? Date.parse(row.due_at) : null;
}

export async function pumpOnce(ctx: SimTestContext): Promise<void> {
  await ctx.worker.tickOnce();
  await flush(ctx);
}

export async function runToFinal(
  ctx: SimTestContext,
  flags: Partial<SimulationFlags>,
  opts: { amountMinor?: number; maxSteps?: number } = {},
): Promise<{ payout: Record<string, unknown>; sums: Record<string, number> }> {
  setFlags(flags);

  const quote = await createQuote(ctx, {
    mode: 'receive',
    amountMinor: opts.amountMinor ?? 4_280_000,
  });
  if (quote.statusCode !== 201) {
    throw new Error(`expected quote 201, got ${quote.statusCode}: ${quote.body}`);
  }

  const created = await ctx.app.inject({
    method: 'POST',
    url: '/payouts',
    headers: { ...ctx.accountHeaders, 'idempotency-key': newIdempotencyKey() },
    payload: { quoteId: quote.json().id },
  });
  if (created.statusCode !== 201) {
    throw new Error(`expected payout 201, got ${created.statusCode}: ${created.body}`);
  }
  const payoutId = created.json().id as string;

  const maxSteps = opts.maxSteps ?? 400;
  for (let step = 0; step < maxSteps; step++) {
    await pumpOnce(ctx);

    const row = ctx.db
      .prepare(`SELECT status FROM payouts WHERE id = @id`)
      .get({ id: payoutId }) as {
      status: string;
    };
    if (FINAL.has(row.status)) {
      assertBalanced(ctx.db, payoutId);
      const payout = (
        await ctx.app.inject({
          method: 'GET',
          url: `/payouts/${payoutId}`,
          headers: ctx.accountHeaders,
        })
      ).json();
      return { payout, sums: journalSums(ctx.db, payoutId) };
    }

    const now = ctx.clock.now().getTime();
    const nextSim = ctx.queued?.nextDueAt() ?? null;
    const nextOut = nextOutboxDueMs(ctx);
    const nexts = [nextSim, nextOut].filter((n): n is number => n != null && n > now);
    if (nexts.length > 0) {
      ctx.clock.advance(Math.min(...nexts) - now);
      continue;
    }

    if (ctx.queued && ctx.queued.pendingCount() > 0) {
      const due = ctx.queued.nextDueAt();
      if (due != null && due > now) {
        ctx.clock.advance(due - now);
      } else {
        ctx.clock.advance(1);
      }
      continue;
    }

    if (nextOut != null) {
      ctx.clock.advance(Math.max(1, nextOut - now));
      continue;
    }

    ctx.clock.advance(50);
  }

  const status = ctx.db
    .prepare(`SELECT status FROM payouts WHERE id = @id`)
    .get({ id: payoutId }) as {
    status: string;
  };
  throw new Error(`runToFinal step limit; status=${status.status}`);
}
