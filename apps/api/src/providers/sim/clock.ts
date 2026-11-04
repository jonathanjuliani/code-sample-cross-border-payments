import { getFlags } from './flags.ts';

export type SimScheduler = {
  delay(ms: number): Promise<void>;
};

export function adjustSimMs(baseMs: number): number {
  const flags = getFlags();
  let ms = baseMs;
  if (flags.slow) ms *= 4;
  ms = Math.floor(ms / flags.speed);
  return Math.max(0, ms);
}

let scheduler: SimScheduler = createRealSimScheduler();

export function setSimScheduler(next: SimScheduler): void {
  scheduler = next;
}

export function getSimScheduler(): SimScheduler {
  return scheduler;
}

/** Apply slow/speed and wait via the injectable scheduler. */
export async function simDelay(baseMs: number): Promise<void> {
  await scheduler.delay(adjustSimMs(baseMs));
}

export type QueuedSimScheduler = SimScheduler & {
  releaseDue(nowMs: number): void;
  nextDueAt(): number | null;
  pendingCount(): number;
  clear(): void;
};

/** Test scheduler: delays park until `releaseDue` after the fake clock advances. */
export function createQueuedSimScheduler(getNowMs: () => number): QueuedSimScheduler {
  type Waiter = { dueAt: number; resolve: () => void };
  let waiters: Waiter[] = [];

  return {
    async delay(ms) {
      const dueAt = getNowMs() + ms;
      await new Promise<void>((resolve) => {
        waiters.push({ dueAt, resolve });
      });
    },
    releaseDue(nowMs: number) {
      const due = waiters.filter((w) => w.dueAt <= nowMs);
      waiters = waiters.filter((w) => w.dueAt > nowMs);
      for (const w of due) w.resolve();
    },
    nextDueAt() {
      if (waiters.length === 0) return null;
      return Math.min(...waiters.map((w) => w.dueAt));
    },
    pendingCount() {
      return waiters.length;
    },
    clear() {
      for (const w of waiters) w.resolve();
      waiters = [];
    },
  };
}

/** Real wall-clock scheduler (production). */
export function createRealSimScheduler(): SimScheduler {
  return {
    async delay(ms) {
      if (ms <= 0) return;
      await new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      });
    },
  };
}

/** Test scheduler: advances a fake clock immediately (no wall waiting). */
export function createEagerSimScheduler(clock: {
  now(): Date;
  advance(ms: number): void;
}): SimScheduler {
  return {
    async delay(ms) {
      if (ms > 0) clock.advance(ms);
    },
  };
}
