export type LedgerCurrency = 'USD' | 'DUSD' | 'MXN';

/** Accounts allowed per currency (PLAN §9). */
export const ACCOUNTS_BY_CURRENCY: Record<LedgerCurrency, ReadonlySet<string>> = {
  USD: new Set(['sender_bank', 'usd_clearing', 'fee_revenue', 'onramp', 'network_fee_expense']),
  DUSD: new Set(['onramp', 'treasury_wallet', 'offramp_wallet', 'offramp']),
  MXN: new Set(['offramp', 'recipient_bank', 'fx_variance']),
};
