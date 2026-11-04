import { type SimulationFlags, SimulationFlagsSchema } from '@payout/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { Clock } from '../../clock.ts';
import type { Db } from '../../db/open.ts';
import { recordEvent } from '../../ops/events.ts';

const defaults = (): SimulationFlags => SimulationFlagsSchema.parse({});

let flags: SimulationFlags = defaults();
let dbRef: Db | null = null;
let clockRef: Clock | null = null;
let logRef: FastifyBaseLogger | null = null;

/** Wire ops-event recording for flag changes (called once at startup / in tests). */
export function bindFlagRecorder(db: Db, clock: Clock, log: FastifyBaseLogger): void {
  dbRef = db;
  clockRef = clock;
  logRef = log;
}

export function getFlags(): SimulationFlags {
  return { ...flags };
}

export function setFlags(next: Partial<SimulationFlags>): SimulationFlags {
  flags = SimulationFlagsSchema.parse({ ...flags, ...next });
  if (dbRef && clockRef && logRef) {
    recordEvent(dbRef, logRef, {
      kind: 'sim',
      level: 'info',
      at: clockRef.now().toISOString(),
      message: 'simulation flags updated',
      data: { ...flags },
    });
  }
  return getFlags();
}

export function resetFlags(): SimulationFlags {
  flags = defaults();
  if (dbRef && clockRef && logRef) {
    recordEvent(dbRef, logRef, {
      kind: 'sim',
      level: 'info',
      at: clockRef.now().toISOString(),
      message: 'simulation flags reset',
      data: { ...flags },
    });
  }
  return getFlags();
}

/** Load flags from SIM_FLAGS env JSON at startup. */
export function loadFlagsFromEnv(raw: string | undefined): void {
  if (!raw) {
    flags = defaults();
    return;
  }
  flags = SimulationFlagsSchema.parse(JSON.parse(raw));
}

/** One-shot: consume crash.afterCommit if set, clearing it (no ops event). */
export function consumeCrashAfterCommit(): boolean {
  if (!flags['crash.afterCommit']) return false;
  flags = { ...flags, 'crash.afterCommit': false };
  return true;
}

/** One-shot: consume webhook.duplicate for the next delivered event. */
export function consumeWebhookDuplicate(): boolean {
  if (!flags['webhook.duplicate']) return false;
  flags = { ...flags, 'webhook.duplicate': false };
  return true;
}
