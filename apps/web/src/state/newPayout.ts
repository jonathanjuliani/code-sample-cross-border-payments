import type { Quote, QuoteMode } from '@payout/shared';

export type NewPayoutPhase =
  | 'editing'
  | 'quoting'
  | 'quoted'
  | 'confirming'
  | 'done'
  | 'expired'
  | 'error';

export type NewPayoutState = {
  phase: NewPayoutPhase;
  recipientId: string | null;
  mode: QuoteMode;
  amountMinor: number | null;
  quote: Quote | null;
  previousQuote: Quote | null;
  idempotencyKey: string | null;
  confirmAttempts: number;
  payoutId: string | null;
  error: string | null;
  fieldError: string | null;
};

export const initialNewPayoutState: NewPayoutState = {
  phase: 'editing',
  recipientId: null,
  mode: 'receive',
  amountMinor: null,
  quote: null,
  previousQuote: null,
  idempotencyKey: null,
  confirmAttempts: 0,
  payoutId: null,
  error: null,
  fieldError: null,
};

export type NewPayoutAction =
  | { type: 'setRecipient'; id: string }
  | { type: 'setMode'; mode: QuoteMode }
  | { type: 'setAmount'; minor: number | null }
  | { type: 'quoting' }
  | { type: 'quoted'; quote: Quote; key: string }
  | { type: 'quoteFailed'; message: string; fieldError?: string }
  | { type: 'dropQuote' }
  | { type: 'confirming' }
  | { type: 'confirmAttempt' }
  | { type: 'done'; payoutId: string }
  | { type: 'expired' }
  | { type: 'error'; message: string };

export function newPayoutReducer(state: NewPayoutState, action: NewPayoutAction): NewPayoutState {
  switch (action.type) {
    case 'setRecipient':
      return {
        ...state,
        recipientId: action.id,
        quote: null,
        idempotencyKey: null,
        phase: 'editing',
        fieldError: null,
        error: null,
      };
    case 'setMode':
      return {
        ...state,
        mode: action.mode,
        quote: null,
        idempotencyKey: null,
        phase: 'editing',
        fieldError: null,
      };
    case 'setAmount':
      return {
        ...state,
        amountMinor: action.minor,
        quote: null,
        idempotencyKey: null,
        phase: 'editing',
        fieldError: null,
      };
    case 'quoting':
      return { ...state, phase: 'quoting', error: null, fieldError: null };
    case 'quoted':
      return {
        ...state,
        phase: 'quoted',
        quote: action.quote,
        idempotencyKey: action.key,
        // Keep previousQuote after an expiry so the new-rate callout can compare.
        error: null,
        fieldError: null,
      };
    case 'quoteFailed':
      return {
        ...state,
        phase: 'error',
        error: action.message,
        fieldError: action.fieldError ?? null,
      };
    case 'dropQuote':
      return {
        ...state,
        quote: null,
        idempotencyKey: null,
        phase: 'editing',
      };
    case 'confirming':
      return { ...state, phase: 'confirming', confirmAttempts: 0 };
    case 'confirmAttempt':
      return { ...state, confirmAttempts: state.confirmAttempts + 1 };
    case 'done':
      return { ...state, phase: 'done', payoutId: action.payoutId };
    case 'expired':
      return {
        ...state,
        phase: 'expired',
        previousQuote: state.quote,
        quote: null,
      };
    case 'error':
      return { ...state, phase: 'error', error: action.message };
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}
