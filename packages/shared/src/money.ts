export const BASE_RATE_E4 = 172_500;
export const FEE_BPS = 50;
export const FEE_MIN_MINOR = 200;
export const SEND_MIN_MINOR = 1_000;
export const SEND_MAX_MINOR = 5_000_000;
export const CONFIRMATIONS = 3;
export const RATE_MOVE_BPS = 200;

export type CurrencyCode = 'USD' | 'MXN' | 'DUSD';

export type PricedAmounts = {
  sendMinor: number;
  feeMinor: number;
  convertMinor: number;
  receiveMinor: number;
  rateE4: number;
};

/** Integer round-half-up of n / d for non-negative integers. */
function roundHalfUp(n: bigint, d: bigint): number {
  return Number((n + d / 2n) / d);
}

/** Integer ceil of n / d for positive integers. */
function ceilDiv(n: bigint, d: bigint): number {
  return Number((n + d - 1n) / d);
}

export function priceFromSend(sendMinor: number, rateE4: number): PricedAmounts {
  if (!Number.isInteger(sendMinor) || sendMinor < 0) {
    throw new RangeError('sendMinor must be a non-negative integer');
  }
  if (!Number.isInteger(rateE4) || rateE4 <= 0) {
    throw new RangeError('rateE4 must be a positive integer');
  }

  const feeMinor = Math.max(
    FEE_MIN_MINOR,
    roundHalfUp(BigInt(sendMinor) * BigInt(FEE_BPS), 10_000n),
  );
  const convertMinor = sendMinor - feeMinor;
  const receiveMinor = Number((BigInt(convertMinor) * BigInt(rateE4)) / 10_000n);

  return { sendMinor, feeMinor, convertMinor, receiveMinor, rateE4 };
}

export function priceFromReceive(receiveMinor: number, rateE4: number): PricedAmounts {
  if (!Number.isInteger(receiveMinor) || receiveMinor < 0) {
    throw new RangeError('receiveMinor must be a non-negative integer');
  }
  if (!Number.isInteger(rateE4) || rateE4 <= 0) {
    throw new RangeError('rateE4 must be a positive integer');
  }

  const convertMinor = ceilDiv(BigInt(receiveMinor) * 10_000n, BigInt(rateE4));
  const sendFromPct = ceilDiv(BigInt(convertMinor) * 10_000n, 9_950n);
  const sendMinor = Math.max(convertMinor + FEE_MIN_MINOR, sendFromPct);
  const feeMinor = sendMinor - convertMinor;

  return { sendMinor, feeMinor, convertMinor, receiveMinor, rateE4 };
}

export function inLimits(sendMinor: number): boolean {
  return Number.isInteger(sendMinor) && sendMinor >= SEND_MIN_MINOR && sendMinor <= SEND_MAX_MINOR;
}

export function formatMinor(minor: number, currency: CurrencyCode): string {
  const abs = Math.abs(minor);
  const whole = Math.trunc(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  const sign = minor < 0 ? '-' : '';
  const amount = `${sign}${whole.toLocaleString('en-US')}.${frac}`;
  return `${amount} ${currency}`;
}
