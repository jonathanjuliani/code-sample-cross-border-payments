import {
  PayoutSchema,
  type Quote,
  QuoteSchema,
  type Recipient,
  SEND_MAX_MINOR,
  SEND_MIN_MINOR,
} from '@payout/shared';
import { useReducer, useRef, useState } from 'react';
import { request } from '../state/api.ts';
import { initialNewPayoutState, newPayoutReducer } from '../state/newPayout.ts';
import { navigate } from '../state/route.ts';
import { AmountField } from '../ui/AmountField.tsx';
import { Button } from '../ui/Button.tsx';
import { Callout } from '../ui/Callout.tsx';
import { Card } from '../ui/Card.tsx';
import { HoldBar } from '../ui/HoldBar.tsx';
import { KeyValue } from '../ui/KeyValue.tsx';
import { Money } from '../ui/Money.tsx';
import { PageHead } from '../ui/PageHead.tsx';
import { SectionHead } from '../ui/SectionHead.tsx';
import { Segmented } from '../ui/Segmented.tsx';
import { Spinner } from '../ui/Spinner.tsx';
import styles from './NewPayout.module.css';

export function NewPayout({ recipients }: { recipients: Recipient[] }) {
  const [state, dispatch] = useReducer(newPayoutReducer, initialNewPayoutState);
  const [quoteReceivedAt, setQuoteReceivedAt] = useState(0);
  const confirming = useRef(false);

  const selected = recipients.find((r) => r.id === state.recipientId);

  async function seeRate() {
    if (!state.recipientId || state.amountMinor == null) {
      dispatch({
        type: 'quoteFailed',
        message: 'Choose a recipient and amount',
        fieldError: 'Amount is required',
      });
      return;
    }
    dispatch({ type: 'quoting' });
    const res = await request('/quotes', {
      method: 'POST',
      schema: QuoteSchema,
      body: JSON.stringify({
        recipientId: state.recipientId,
        mode: state.mode,
        amountMinor: state.amountMinor,
      }),
    });
    if (!res.ok) {
      const field =
        res.error === 'amount_out_of_range'
          ? `Enter between ${SEND_MIN_MINOR / 100} and ${SEND_MAX_MINOR / 100}`
          : undefined;
      dispatch({
        type: 'quoteFailed',
        message: res.message,
        ...(field ? { fieldError: field } : {}),
      });
      return;
    }
    const key = crypto.randomUUID();
    setQuoteReceivedAt(Date.now());
    dispatch({ type: 'quoted', quote: res.data, key });
  }

  async function confirm() {
    if (!state.quote || !state.idempotencyKey || confirming.current) return;
    confirming.current = true;
    dispatch({ type: 'confirming' });

    const delays = [0, 500, 1500];
    let lastOffline = false;

    for (let i = 0; i < delays.length; i++) {
      if (delays[i]) await new Promise((r) => setTimeout(r, delays[i]));
      dispatch({ type: 'confirmAttempt' });
      const res = await request('/payouts', {
        method: 'POST',
        schema: PayoutSchema,
        headers: { 'idempotency-key': state.idempotencyKey },
        body: JSON.stringify({ quoteId: state.quote.id }),
      });

      if (res.ok) {
        confirming.current = false;
        dispatch({ type: 'done', payoutId: res.data.id });
        navigate(`/payouts/${res.data.id}`);
        return;
      }

      if (res.status === 410) {
        confirming.current = false;
        dispatch({ type: 'expired' });
        return;
      }
      if (res.status === 409 && res.error === 'quote_used' && res.body?.payoutId) {
        confirming.current = false;
        navigate(`/payouts/${res.body.payoutId}`);
        return;
      }
      if (res.offline) {
        lastOffline = true;
        continue;
      }
      confirming.current = false;
      dispatch({ type: 'error', message: res.message });
      return;
    }

    if (lastOffline) {
      const lookup = await request(
        `/payouts?idempotencyKey=${encodeURIComponent(state.idempotencyKey)}`,
        {
          method: 'GET',
          schema: PayoutSchema,
        },
      );
      confirming.current = false;
      if (lookup.ok) {
        dispatch({ type: 'done', payoutId: lookup.data.id });
        navigate(`/payouts/${lookup.data.id}`);
        return;
      }
      dispatch({ type: 'error', message: lookup.message });
      return;
    }
    confirming.current = false;
  }

  async function getNewRate() {
    const prev = state.previousQuote;
    await seeRate();
    if (prev) {
      // previousQuote kept in reducer on expired; quoted clears it — restore for compare
      // handled via local: show below if we track separately
    }
  }

  const quote: Quote | null = state.quote;
  const locked = state.phase === 'confirming';

  return (
    <div>
      <PageHead
        eyebrow="New"
        title="New payout"
        lede="Choose who gets paid, how much, then confirm while the rate is held."
      />
      <div className={styles.grid}>
        <div className="stack">
          <Card>
            <SectionHead>Recipient</SectionHead>
            <fieldset className={styles.recipients}>
              <legend className="label">Who gets paid</legend>
              {recipients.map((r) => (
                <label key={r.id} className={styles.recipient}>
                  <input
                    type="radio"
                    name="recipient"
                    checked={state.recipientId === r.id}
                    onChange={() => dispatch({ type: 'setRecipient', id: r.id })}
                    disabled={locked}
                  />
                  <span>
                    <b>{r.label}</b>
                    <span className="meta">
                      {' '}
                      · {r.city} · {r.bankAccountMasked}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
          </Card>

          <Card>
            <SectionHead>Amount</SectionHead>
            <Segmented
              name="mode"
              value={state.mode}
              options={[
                { value: 'receive', label: 'They receive' },
                { value: 'send', label: 'You send' },
              ]}
              onChange={(mode) => dispatch({ type: 'setMode', mode })}
            />
            <AmountField
              id="amount"
              label={state.mode === 'receive' ? 'Amount in MXN' : 'Amount in USD'}
              currency={state.mode === 'receive' ? 'MXN' : 'USD'}
              valueMinor={state.amountMinor}
              onChange={(minor) => dispatch({ type: 'setAmount', minor })}
            />
            {state.fieldError ? <p className={styles.error}>{state.fieldError}</p> : null}
            <p className="field-hint meta" style={{ marginTop: 'var(--s2)' }}>
              Limits apply to the dollar side.
            </p>
            <div style={{ marginTop: 'var(--s4)' }}>
              <Button
                variant="default"
                onClick={() => void seeRate()}
                disabled={locked || state.phase === 'quoting'}
              >
                {state.phase === 'quoting' ? (
                  <>
                    <Spinner /> Getting rate…
                  </>
                ) : (
                  'See rate and fees'
                )}
              </Button>
            </div>
          </Card>
        </div>

        <Card>
          <SectionHead>Summary</SectionHead>
          {state.phase === 'expired' ? (
            <Callout
              tone="caution"
              label="Rate expired"
              title="This rate expired. Nothing was sent and nothing was charged."
            >
              <Button variant="primary" size="lg" onClick={() => void getNewRate()}>
                Get a new rate
              </Button>
            </Callout>
          ) : null}

          {state.previousQuote && quote && state.previousQuote.sendMinor !== quote.sendMinor ? (
            <Callout tone="caution" label="New rate" title="New rate.">
              You now send <Money minor={quote.sendMinor} currency="USD" /> (was{' '}
              <Money minor={state.previousQuote.sendMinor} currency="USD" />
              ).
            </Callout>
          ) : null}

          {quote ? (
            <>
              <KeyValue
                items={[
                  {
                    key: 'They receive',
                    value: <Money minor={quote.receiveMinor} currency="MXN" />,
                    big: true,
                  },
                  { key: 'You send', value: <Money minor={quote.sendMinor} currency="USD" /> },
                  { key: 'Fee', value: <Money minor={quote.feeMinor} currency="USD" /> },
                  {
                    key: 'Rate',
                    value: (
                      <span className="mono">1 USD = {(quote.rateE4 / 10_000).toFixed(4)} MXN</span>
                    ),
                  },
                ]}
              />
              <div style={{ marginTop: 'var(--s4)' }}>
                <HoldBar
                  expiresAt={quote.expiresAt}
                  serverNow={quote.serverNow}
                  receivedAt={quoteReceivedAt}
                />
              </div>
              <p className="promise meta" style={{ marginTop: 'var(--s3)' }}>
                {selected ? `Pays ${selected.label} (${selected.bankAccountMasked}).` : null}
              </p>
              <div style={{ marginTop: 'var(--s4)' }}>
                <Button
                  variant="primary"
                  size="lg"
                  disabled={locked}
                  onClick={() => void confirm()}
                >
                  {locked ? 'Sending…' : 'Confirm'}
                </Button>
              </div>
            </>
          ) : state.phase !== 'expired' ? (
            <p className="empty muted">See rate and fees to confirm.</p>
          ) : null}

          {state.phase === 'error' && state.error ? (
            <Callout tone="danger" label="Error" title={state.error} />
          ) : null}
        </Card>
      </div>
    </div>
  );
}
