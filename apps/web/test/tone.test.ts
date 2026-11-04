import { LegStatusSchema, PayoutStatusSchema } from '@payout/shared';
import { describe, expect, it } from 'vitest';
import { legTone, payoutTone } from '../src/state/tone.ts';

describe('tone', () => {
  it('maps every payout status', () => {
    for (const status of PayoutStatusSchema.options) {
      expect(['info', 'success', 'caution', 'danger']).toContain(payoutTone(status));
    }
    expect(payoutTone('collecting', true)).toBe('caution');
    expect(payoutTone('delivered')).toBe('success');
    expect(payoutTone('failed')).toBe('danger');
    expect(payoutTone('refunded')).toBe('caution');
  });

  it('maps every leg status', () => {
    for (const status of LegStatusSchema.options) {
      expect(['info', 'success', 'caution', 'danger']).toContain(legTone(status));
    }
  });
});
