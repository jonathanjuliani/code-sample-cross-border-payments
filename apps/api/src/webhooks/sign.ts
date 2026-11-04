import { createHmac, timingSafeEqual } from 'node:crypto';

export const WEBHOOK_TOLERANCE_MS = 5 * 60 * 1000;

/** HMAC-SHA256 hex of `${timestamp}.${rawBody}`. */
export function signWebhook(secret: string, timestamp: string, rawBody: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`, 'utf8').digest('hex');
}

export type VerifyWebhookResult =
  | { ok: true }
  | { ok: false; reason: 'missing' | 'bad_signature' | 'stale_timestamp' };

export function verifyWebhookSignature(opts: {
  secret: string;
  timestampHeader: string | string[] | undefined;
  signatureHeader: string | string[] | undefined;
  rawBody: string;
  nowMs: number;
  toleranceMs?: number;
}): VerifyWebhookResult {
  const timestamp = Array.isArray(opts.timestampHeader)
    ? opts.timestampHeader[0]
    : opts.timestampHeader;
  const signature = Array.isArray(opts.signatureHeader)
    ? opts.signatureHeader[0]
    : opts.signatureHeader;

  if (!timestamp || !signature) {
    return { ok: false, reason: 'missing' };
  }

  const tsSec = Number(timestamp);
  if (!Number.isInteger(tsSec)) {
    return { ok: false, reason: 'stale_timestamp' };
  }

  const ageMs = Math.abs(opts.nowMs - tsSec * 1000);
  const tolerance = opts.toleranceMs ?? WEBHOOK_TOLERANCE_MS;
  if (ageMs > tolerance) {
    return { ok: false, reason: 'stale_timestamp' };
  }

  const expected = signWebhook(opts.secret, timestamp, opts.rawBody);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: 'bad_signature' };
  }

  return { ok: true };
}

/** Mask a secret for `/ops/config` (never the full value). */
export function maskSecret(secret: string): string {
  if (secret.length <= 8) return '••••••••';
  return `${secret.slice(0, 4)}…${secret.slice(-4)}`;
}
