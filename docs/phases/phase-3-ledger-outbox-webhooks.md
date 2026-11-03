# Phase 3: Ledger, outbox worker, webhook intake

**Goal**: a payout moves through all three hops on the happy path, driven by an outbox worker and by webhook events. Every move of money is a balanced journal. A crash between saving and sending loses nothing, and duplicate or out-of-order events change nothing.

**Read first**: PLAN §5 (legs), §6 (`ledger_entries`, `outbox`, `inbox_events`), §9 (ledger), §10 (all of it), §11 (the `Provider` interface only), §19 (events and leg states, outbox kinds, refund postings). DECISIONS D3, D5. README H7, H8, H11, H12.

**Start state**: Phase 2 gate green. Payouts are created in `created` with a `collect.request` outbox row.

## Build, in this order

1. **`src/ledger/post.ts`**: `postJournal(tx, payoutId, memo, entries: { currency, from, to, amountMinor }[])`. Each entry becomes two rows (`from` negative, `to` positive) under one `journal_id`. Throws before writing if any amount isn't a positive integer, any account isn't in PLAN §9's table for that currency, or a currency doesn't sum to zero. Records a `ledger` ops event.
2. **`src/ledger/postings.ts`**: one function per row of PLAN §9's postings table plus the refund postings in §19: `onCollectSucceeded`, `onTransferFinal`, `onDepositSucceeded(rateMoved?)`, `onDepositRejected`, `onRefundSucceeded`. Amounts come from the payout row only.
3. **`src/ledger/balances.ts`**: `balances(payoutId)` and `journalSums(payoutId)` as SQL sums. No stored balance.
4. **`src/providers/types.ts`**: the `Provider` interface from PLAN §11, `ProviderTimeout` error, `ProviderStatus`. A temporary `instantProvider` for tests that accepts everything and lets a test emit events by hand. The real simulator is Phase 4.
5. **`src/outbox/worker.ts`**: `startWorker({ db, clock, providers, intervalMs })` returns `{ stop, tickOnce }`. `tickOnce` reads unsent rows oldest first and, for each, outside any transaction:
   - calls `providers[leg].submit(providerRef, payload)`;
   - accepted: in one transaction, mark the row sent, set the leg `submitted`, `attempt + 1`, and run the payout transition the send implies (`created → collecting` for `collect.request`);
   - declined: in one transaction, mark sent, leg `failed`, payout transition, ledger if any;
   - `ProviderTimeout`: in one transaction, mark sent, leg `checking`, insert a `status.query` row due after the first `STATUS_BACKOFF_MS` step.
   - `status.query` rows call `getStatus` and either apply the status as if it were an event, schedule the next query, or, when `not_found` after `PROVIDER_WINDOW_MS`, insert a new `*.request` with the same `provider_ref`. After `CHECKING_GIVE_UP_MS` it stops scheduling and records a `worker` warn event.
   - Records a `worker` ops event per decision and stores `last_tick_at` in memory for `/ops`.
   - Add a `due_at` column to `outbox` for scheduled rows (update PLAN §6 in the same change).
6. **`src/webhooks/`**, `POST /webhooks/:provider`: validate with the shared event schema; in one transaction:
   1. insert into `inbox_events`; primary-key conflict → 200 `{ ignored: 'duplicate' }`, `webhook` ops event, nothing else;
   2. `seq <= leg.last_seq` → keep the row with `applied = false`, 200 `{ ignored: 'stale' }`;
   3. otherwise update the leg (state from the §19 mapping, `last_seq`, `confirmations`, `tx_hash`), mark applied, run the payout transition the mapping names, post the journal, and write the next hop's outbox row (`transfer.request` after collect, `deposit.request` only after transfer `final`, `refund.request` after deposit `rejected`).
   - A webhook never sets the payout status directly; it calls `machine.transition`.
7. **Seed**: finish `seed.ts` so `PO-1039` and `PO-1040` are written with legs and journals through `postings.ts`.
8. **`GET /payouts/:id/ledger`**: entries and per-currency sums.

## Tests this phase adds

- `ledger.test.ts`
  - `H12: post refuses a journal that doesn't sum to zero` and writes nothing
  - `H12: post refuses a fractional amount`
  - `T6: there is no balance column` (inspect the schema)
  - `a delivered payout leaves recipient_bank MXN equal to receive`
  - `a refunded payout leaves sender_bank USD at zero and nothing in any DUSD or MXN account`
- `worker.test.ts` (fake clock, `tickOnce`, `instantProvider`)
  - `H11: a payout saved before a crash is sent after restart` (create a payout, never tick, build a new worker on the same DB, tick, the collect submit happens once)
  - `H11: a row sent and committed is not sent again after restart`
  - `H5: a timeout sets the leg to checking and queries status, never resubmits first`
  - `P3: not found after the provider window resends with the same provider_ref`
  - `T4: every submit for a leg uses the same provider_ref`
- `webhooks.test.ts`
  - `H7: the same event twice changes nothing the second time` (leg, payout, ledger row counts equal)
  - `H8: a newer event before an older one applies the newer and ignores the older`
  - `H8: a payout never moves backwards`
  - `T5: an event can't set a payout status the machine doesn't allow`
  - `hop 3 is not requested before hop 2 is final`
  - `happy path: collect, three confirmations, deposit end in delivered with a balanced ledger`

## Gate

```bash
pnpm verify
```

Green. A helper used by the tests, `assertBalanced(payoutId)`, runs at the end of every webhook and worker test.

## Write down

PROCESS: Phase 3 entry. DECISIONS: Proposed entry for the `due_at` scheduling and the status-query backoff if the shape differs from this brief.

## Out of scope

The simulator and its switches, the `/ops/*` routes, reconciliation.
