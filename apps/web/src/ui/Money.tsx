import { type CurrencyCode, formatMinor } from '@payout/shared';

export function Money({
  minor,
  currency,
  size = 'md',
}: {
  minor: number;
  currency: CurrencyCode;
  size?: 'sm' | 'md' | 'lg' | 'hero';
}) {
  const style =
    size === 'hero'
      ? { fontSize: 'var(--fs-hero)', fontWeight: 500, letterSpacing: '-0.02em' as const }
      : size === 'lg'
        ? { fontSize: 'var(--fs-title)', fontWeight: 500 }
        : size === 'sm'
          ? { fontSize: 'var(--fs-meta)' }
          : undefined;
  return (
    <span className="money" style={style}>
      {formatMinor(minor, currency)}
    </span>
  );
}
