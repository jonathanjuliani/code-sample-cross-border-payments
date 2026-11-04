export type Clock = {
  now(): Date;
};

export function createSystemClock(): Clock {
  return {
    now: () => new Date(),
  };
}

export function createFakeClock(start: Date | number = 0): Clock & { advance(ms: number): void } {
  let current = typeof start === 'number' ? start : start.getTime();
  return {
    now: () => new Date(current),
    advance(ms: number) {
      current += ms;
    },
  };
}
