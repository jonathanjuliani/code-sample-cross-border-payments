import type { LegStatus, PayoutStatus } from '@payout/shared';

export type Tone = 'info' | 'success' | 'caution' | 'danger';

/** Payout status → tone (mockup DECISIONS state → role). */
export function payoutTone(status: PayoutStatus, legChecking = false): Tone {
  if (legChecking) return 'caution';
  switch (status) {
    case 'delivered':
      return 'success';
    case 'failed':
      return 'danger';
    case 'refunding':
    case 'refunded':
      return 'caution';
    case 'created':
    case 'collecting':
    case 'transferring':
    case 'paying_out':
      return 'info';
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

/** Leg status → tone for timeline rings. */
export function legTone(status: LegStatus): Tone {
  switch (status) {
    case 'succeeded':
    case 'final':
      return 'success';
    case 'failed':
    case 'dropped':
      return 'danger';
    case 'checking':
      return 'caution';
    case 'waiting':
    case 'submitted':
    case 'processing':
    case 'confirming':
      return 'info';
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

export function payoutPillLabel(status: PayoutStatus, legChecking = false): string {
  if (legChecking) return 'Checking';
  switch (status) {
    case 'delivered':
      return 'Delivered';
    case 'failed':
      return 'Not sent';
    case 'refunded':
      return 'Refunded';
    case 'refunding':
      return 'Refunding';
    case 'created':
    case 'collecting':
    case 'transferring':
    case 'paying_out':
      return 'In progress';
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}
