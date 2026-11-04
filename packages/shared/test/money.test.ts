import { describe, expect, it } from 'vitest';
import {
  BASE_RATE_E4,
  FEE_MIN_MINOR,
  inLimits,
  priceFromReceive,
  priceFromSend,
  SEND_MAX_MINOR,
  SEND_MIN_MINOR,
} from '../src/money.ts';

/** Deterministic mulberry32 PRNG. */
function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

describe('priceFromSend', () => {
  it('T1: applies the minimum fee at the send minimum', () => {
    const priced = priceFromSend(SEND_MIN_MINOR, BASE_RATE_E4);
    expect(priced.feeMinor).toBe(FEE_MIN_MINOR);
    expect(priced.convertMinor).toBe(SEND_MIN_MINOR - FEE_MIN_MINOR);
    expect(priced.receiveMinor).toBe(Math.floor((priced.convertMinor * BASE_RATE_E4) / 10_000));
    expect(Number.isInteger(priced.receiveMinor)).toBe(true);
  });

  it('T1: uses the percentage fee when it exceeds the minimum', () => {
    const sendMinor = 100_000; // $1,000 → 0.5% = $5.00
    const priced = priceFromSend(sendMinor, BASE_RATE_E4);
    expect(priced.feeMinor).toBe(500);
    expect(priced.convertMinor).toBe(99_500);
    expect(priced.receiveMinor).toBe(Math.floor((99_500 * BASE_RATE_E4) / 10_000));
  });

  it('T1: never gives more pesos than convert buys (floor)', () => {
    const priced = priceFromSend(12_345, BASE_RATE_E4);
    const maxBuyable = Math.floor((priced.convertMinor * BASE_RATE_E4) / 10_000);
    expect(priced.receiveMinor).toBe(maxBuyable);
  });
});

describe('priceFromReceive', () => {
  it('T1: returns exactly the asked pesos at the receive equivalent of the send minimum', () => {
    // Find a receive amount whose priced send sits at/above the minimum.
    const receiveMinor = 42_800_00; // 42,800.00 MXN from the mockup
    const priced = priceFromReceive(receiveMinor, BASE_RATE_E4);
    expect(priced.receiveMinor).toBe(receiveMinor);
    expect(priced.sendMinor).toBeGreaterThanOrEqual(SEND_MIN_MINOR);
    expect(priced.feeMinor).toBe(priced.sendMinor - priced.convertMinor);
    expect(priced.feeMinor).toBeGreaterThanOrEqual(FEE_MIN_MINOR);
  });

  it('T1: applies the minimum fee when the percentage fee would be smaller', () => {
    const priced = priceFromReceive(10_000, BASE_RATE_E4); // 100.00 MXN
    expect(priced.feeMinor).toBe(FEE_MIN_MINOR);
    expect(priced.receiveMinor).toBe(10_000);
  });
});

describe('inLimits', () => {
  it('accepts the send minimum and maximum', () => {
    expect(inLimits(SEND_MIN_MINOR)).toBe(true);
    expect(inLimits(SEND_MAX_MINOR)).toBe(true);
  });

  it('rejects just outside both edges', () => {
    expect(inLimits(SEND_MIN_MINOR - 1)).toBe(false);
    expect(inLimits(SEND_MAX_MINOR + 1)).toBe(false);
  });
});

describe('property-style pricing', () => {
  it('T1: receive mode always returns exactly the asked pesos; send mode never overshoots', () => {
    const rand = mulberry32(0xc0ffee);
    for (let i = 0; i < 3_000; i++) {
      const rateE4 = 150_000 + Math.floor(rand() * 50_000);
      const receiveMinor = 1 + Math.floor(rand() * 5_000_000);
      const fromReceive = priceFromReceive(receiveMinor, rateE4);
      expect(fromReceive.receiveMinor).toBe(receiveMinor);
      expect(Number.isInteger(fromReceive.sendMinor)).toBe(true);
      expect(Number.isInteger(fromReceive.feeMinor)).toBe(true);
      expect(Number.isInteger(fromReceive.convertMinor)).toBe(true);

      const sendMinor = SEND_MIN_MINOR + Math.floor(rand() * (SEND_MAX_MINOR - SEND_MIN_MINOR));
      const fromSend = priceFromSend(sendMinor, rateE4);
      const maxBuyable = Math.floor((fromSend.convertMinor * rateE4) / 10_000);
      expect(fromSend.receiveMinor).toBeLessThanOrEqual(maxBuyable);
      expect(fromSend.sendMinor).toBe(sendMinor);
      expect(fromSend.feeMinor + fromSend.convertMinor).toBe(sendMinor);
    }
  });
});
