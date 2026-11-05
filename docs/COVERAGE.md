# Coverage

Statuses as of 2026-11-04 (Phases 0–7 complete, including N1–N7). Node `v24.21.0`. Commands that produced them:

```bash
pnpm verify
pnpm test:e2e
```

Since then the runtime moved to Node 26 ([D29](DECISIONS.md#d29-node-26)) and the look to Harbor ([D30](DECISIONS.md#d30-harbor-visual-direction)). `pnpm verify` was re-run on 2026-11-05 on Node `v26.9.0` (shared 17, web 7, api 87). `pnpm test:e2e` has not been re-run since. The N7 screenshot tests were removed until they are rebaselined for the new look ([D31](DECISIONS.md#d31-screenshot-tests-removed-until-rebaselined)).

Every row below was checked against those runs (or the named test file), not by reading production code alone. `How to see it` is the `/ops` switch or the UI steps a person can follow.

Status values: **Handled**, **Partial**, **Not handled: by choice**, **Not handled: later**, **Unverified**.

## Must handle (H)

| ID | Situation | Status | How it's handled | Evidence | How to see it |
| --- | --- | --- | --- | --- | --- |
| H1 | Double-click on Confirm | Handled | Button locks; API dedupes on `Idempotency-Key` | `apps/api/test/payouts.create.test.ts` › `H1: confirming twice with the same key creates one payout`; `e2e/confirm.spec.ts` › `H1: double-clicking Confirm creates one payout` | New payout → Confirm twice; one row on the list |
| H2 | Confirm at the edge of the hold | Handled | Server clock vs `expires_at`; 410 after | `apps/api/test/payouts.create.test.ts` › `H2: a confirm 1ms before expiry is accepted at the quoted rate`; `e2e/confirm.spec.ts` › both H2 tests | `/ops` → expire quote in 1s, or wait out the bar |
| H3 | Quote expired or already used | Handled | Quote consumed once; 409 / 410 | `apps/api/test/payouts.create.test.ts` › `H3: a used quote can't make a second payout, even with a new key` | Confirm, then try the same quote with a new key via API |
| H4 | Hop 1 declines | Handled | Final `failed`; empty ledger | `apps/api/test/scenarios.test.ts` › `H4: hop 1 declines…`; `e2e/timeline.spec.ts` › `H4: a declined hop 1…` | `/ops` → `collect.decline` → new payout |
| H5 | Provider times out without an answer | Handled | Leg `checking`; status query before any resend | `apps/api/test/worker.test.ts` › `H5: a timeout sets the leg to checking…`; `apps/api/test/scenarios.test.ts` › `H5: hop 2 times out but happened…` | `/ops` → `transfer.timeout` |
| H6 | Hop 3 refuses bank details | Handled | Refund path; fee included; `refunded` | `apps/api/test/scenarios.test.ts` › `H6: hop 3 rejects…`; `e2e/timeline.spec.ts` › `H6: a rejected deposit…` | `/ops` → `deposit.rejectBank` |
| H7 | Duplicate status update | Handled | Inbox dedupe on `event_id` | `apps/api/test/webhooks.test.ts` › `H7: the same event twice…`; `apps/api/test/scenarios.test.ts` › `H7: duplicate webhook is ignored` | `/ops` → `webhook.duplicate` |
| H8 | Out-of-order status | Handled | Apply by `seq` per leg; ignore stale | `apps/api/test/webhooks.test.ts` › `H8: a newer event before an older one…`; `apps/api/test/scenarios.test.ts` › `H8: out-of-order deposit…` | `/ops` → `webhook.outOfOrder` |
| H9 | Close tab mid-payout | Handled | Client holds nothing that matters; polls server | `e2e/timeline.spec.ts` › `H9: reloading mid-payout shows the server's status` | Start a payout, reload the detail URL |
| H10 | Quoted pesos land | Handled | Frozen amounts; FX variance absorbs rate move | `apps/api/test/scenarios.test.ts` › `H10 P1: rate moved 2%…` | `/ops` → `rate.move`; delivered receive = quote |
| H11 | Crash between save and hop 1 | Handled | Outbox in the same transaction; worker on restart | `apps/api/test/worker.test.ts` › `H11: a payout saved before a crash…`; `apps/api/test/scenarios.test.ts` › `H11: crash after commit…` | `/ops` → `crash.afterCommit` (compose restarts the API) |
| H12 | Money as integers + balanced ledger | Handled | Minor units; journals sum to zero | `apps/api/test/ledger.test.ts` › `H12: post refuses a journal…`; `packages/shared/test/money.test.ts` › `T1:…` | Any delivered payout's ledger on `/ops` |

## Should handle (S)

| ID | Situation | Status | How it's handled | Evidence | How to see it |
| --- | --- | --- | --- | --- | --- |
| S1 | Provider is slow | Handled | Per-leg `slow` from API; copy on the timeline | `apps/api/test/scenarios.test.ts` › `slow: ends delivered…` | `/ops` → `slow` + speed 1; watch the payout banner |
| S2 | API unreachable from the client | Handled | Offline strip + last confirmed time; poll backs off | `e2e/timeline.spec.ts` › `S2: when reads fail…`; `apps/api/test/scenarios.test.ts` › `S2: reads fail with 503…` | `/ops` → `client.readsFail` |
| S3 | Invalid input | Handled | Zod at the edge; 400/422 with issues | `apps/api/test/quotes.test.ts` › `S3: rejects a float amount…` | Type a non-integer amount (API) |
| S4 | Confirm response lost | Handled | Same key retry; lookup by key | `apps/api/test/payouts.create.test.ts` › `S4: a retry after a lost response…`; `e2e/confirm.spec.ts` › `S4: a dropped confirm response…` | Drop the first confirm response in DevTools |
| S5 | Force every failure quickly | Handled | `/ops` simulation + `PUT /ops/simulation` | `apps/api/test/ops.test.ts` › `S5: every switch in §11…`; `e2e/ops.spec.ts` › `S5: a switch set on /ops…` | Open `/ops`, flip a switch, pay in another tab |
| S6 | Accessibility | Handled | Labels, live regions, AA tokens, axe in both themes | `apps/web/test/tokens.test.ts` › `S6:…`; `e2e/a11y.spec.ts` › `S6:…` | `pnpm test:e2e` a11y project |
| S7 | Logs useful and safe | Handled | Structured `ops_events`; no bank tokens | `apps/api/test/ops.test.ts` › `S7: no bank account token…` | Inspect `/ops` server log and events API |
| S8 | See what the server did | Handled | `/ops` summary, stuck, log, recon, config, inspector | `apps/api/test/ops.test.ts` › `S8: the inspector shows…`; `e2e/ops.spec.ts` › `S8: the server log shows the replay…` | Open `http://localhost:8801/ops` |

## Money-movement problems (P)

| ID | Situation | Status | How it's handled | Evidence | How to see it |
| --- | --- | --- | --- | --- | --- |
| P1 | Rate moved 2% | Handled | Quoted pesos; `fx_variance` | `apps/api/test/scenarios.test.ts` › `H10 P1: rate moved 2%…` | `/ops` → `rate.move` |
| P2 | Network fee differs | Handled | Actual posted; sender amounts unchanged | `apps/api/test/scenarios.test.ts` › `P2: network fee differs…` | Happy path; compare ledger fee legs |
| P3 | Timeout and transfer never happened | Handled | `getStatus` not_found → resend same `provider_ref` | `apps/api/test/worker.test.ts` › `P3: not found after the provider window…`; `apps/api/test/scenarios.test.ts` › `P3: hop 2 times out and didn't happen…` | `/ops` → `transfer.timeoutLost` |
| P4 | Reorg before finality | Handled | Dropped → resubmit same ref; deposit after final | `apps/api/test/scenarios.test.ts` › `P4: reorg at 2 of 3…` | `/ops` → `transfer.reorg` |
| P5 | Hop 3 pending for hours | Handled | Stuck list with age and leg | `apps/api/test/ops.test.ts` › `P5: a leg pending longer than the threshold…` | `/ops` Stuck panel (or advance clock in tests) |
| P6 | Ledger vs provider disagree | Handled | `GET /reconciliation` lists; no auto-fix | `apps/api/test/reconciliation.test.ts` › `P6: a mismatch…` | `/ops` Reconciliation panel |

## Traps (T)

| ID | Trap | Status | How it's handled | Evidence | How to see it |
| --- | --- | --- | --- | --- | --- |
| T1 | Floats for money | Handled | Integer minor units + `rateE4` | `packages/shared/test/money.test.ts` › `T1:…` | Schemas reject floats |
| T2 | Trusting the client countdown | Handled | Server clock on confirm | `apps/api/test/payouts.create.test.ts` › `T2: the client's countdown is ignored` | Skew the laptop clock; confirm still follows server |
| T3 | Provider call inside the request | Handled | Outbox only in the handler | `apps/api/test/payouts.create.test.ts` › `T3: creating a payout calls no provider` | Create a payout; provider called by worker |
| T4 | Retry with a new reference | Handled | One `provider_ref` per leg | `apps/api/test/worker.test.ts` › `T4: every submit for a leg uses the same provider_ref` | Timeout path on `/ops` |
| T5 | Webhook sets payout state directly | Handled | Webhook → leg; machine → payout | `apps/api/test/webhooks.test.ts` › `T5: an event can't set a payout status…` | Illegal transition logged on `/ops` |
| T6 | Stored balance column | Handled | Balances are sums | `apps/api/test/ledger.test.ts` › `T6: there is no balance column` | Schema has no balance column |
| T7 | "Done" from client logic | Handled | Client renders server state only | `e2e/timeline.spec.ts` › `T7: the page doesn't say Delivered before the API does` | `/ops` → `slow` at speed 1 |
| T8 | Recompute amounts after confirm | Handled | Four amounts frozen on the payout | `apps/api/test/payouts.create.test.ts` › `T8: the payout keeps the quote's four amounts` | Compare quote vs payout payload |
| T9 | Crypto vocabulary in the main flow | Handled | Main copy avoids it; refs under support details | Mockup DECISIONS + payout support panel; `e2e/a11y` + timeline copy | Open support details on a payout |

## Nice to have (N)

| ID | What | Status | How it's handled | Evidence | How to see it |
| --- | --- | --- | --- | --- | --- |
| N1 | SSE instead of polling | Handled | `GET /payouts/:id/stream` + `/ops/stream`; client prefers SSE, polls on error | `apps/api/test/stream.test.ts`; `e2e/stream.spec.ts` › N1 | Open a payout; timeline advances without 2s poll GETs |
| N2 | Signed webhooks (HMAC) | Handled | `Timestamp` + `Signature` HMAC-SHA256 over `timestamp.body`; 5 min window; sim signs | `apps/api/test/webhooks.test.ts` › N2 | `/ops` Config shows `webhookSecretMasked` |
| N3 | Support actions on `/ops` | Handled | Re-run status.query for checking legs; `flagged_at` + Stuck badge; neither moves money | `apps/api/test/ops.test.ts` › N3; `e2e/ops-actions.spec.ts` | `/ops` → Payout inspector |
| N4 | Reorg simulation | Handled | Same as P4 via `transfer.reorg` | `apps/api/test/scenarios.test.ts` › `P4: reorg…` | `/ops` → `transfer.reorg` |
| N5 | Read a real testnet transfer | Handled | `GET /payouts/:id/network-ref` via public JSON-RPC; off by default; recorded fixture in CI | `apps/api/test/network-lookup.test.ts` | Enable `TESTNET_LOOKUP_ENABLED`; open support details |
| N6 | Second chain behind `Provider` | Handled | `CHAIN_PROVIDER=sim\|alt`; `createAltChainProvider`; scenarios run for both | `apps/api/test/scenarios.test.ts` › chain=sim and chain=alt | Set `CHAIN_PROVIDER=alt` |
| N7 | Screenshot tests both themes | Not handled: later | Removed with the Harbor look ([D31](DECISIONS.md#d31-screenshot-tests-removed-until-rebaselined)); the old baselines showed the previous palette | (none) | (none) |
