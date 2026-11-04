import { describe, expect, it } from 'vitest';
import { parseAmountToMinor } from '../src/ui/AmountField.tsx';

describe('AmountField parse', () => {
  it('parses whole and fractional amounts to minor units', () => {
    expect(parseAmountToMinor('10')).toBe(1000);
    expect(parseAmountToMinor('10.5')).toBe(1050);
    expect(parseAmountToMinor('10.50')).toBe(1050);
    expect(parseAmountToMinor('2,493.63')).toBe(249363);
    expect(parseAmountToMinor('')).toBeNull();
    expect(parseAmountToMinor('10.999')).toBeNull();
    expect(parseAmountToMinor('abc')).toBeNull();
  });
});
