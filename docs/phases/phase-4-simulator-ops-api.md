# Phase 4: Provider simulator and the /ops API

**Goal**: three fake providers that behave like real ones and misbehave on demand, every switch in PLAN §11 settable over HTTP, and the `/ops/*` API that shows everything the server did. Every switch ends in exactly one final state with a balanced ledger.

**Read first**: PLAN §8 (rate moves, network fee), §11, §13, §7 (the `/ops/*` rows and `/reconciliation`), §19 (timing, flags, error codes). DECISIONS D6, D7, D8, D12. README H4, H5, H6, H10. P1, P2, P3, S5, S7, S8.

**Start state**: Phase 3 gate green. The happy path works with `instantProvider`.

## Build, in this order

1. **`src/providers/sim/flags.ts`**: in-memory flags typed by the shared simulation schema. `getFlags()`, `setFlags(next)`, `resetFlags()`. Loaded from `SIM_FLAGS` at startup. Every change records a `sim` ops event.
2. **`src/providers/sim/clock.ts`**: `simDelay(ms)` applies `slow` and `speed` and uses an injectable scheduler, so tests run with zero real waiting.
3. **`src/providers/sim/collect.ts`, `chain.ts`, `offramp.ts`**: each implements `Provider`, keeps its own record (`Map<providerRef, { status, amountMinor, rateE4?, txHash? }>`), dedupes `submit` on `providerRef`, and posts events to `/webhooks/:provider` through `app.inject` (in-process) with increasing `seq` per leg. Behaviour per switch as in PLAN §11, timing as in §19. Specifically:
   - `transfer.timeout`: records the transfer as done, then throws `ProviderTimeout`. `getStatus` returns it.
   - `transfer.timeoutLost`: throws `ProviderTimeout` without recording. `getStatus` is `not_found`.
   - `transfer.reorg`: after confirmation 2, emits `dropped`; the worker resubmits with the same reference; the second submit reaches `final`.
   - `deposit.rejectBank`: after `processing`, emits `rejected`; then accepts `refund.request` on the collect provider.
   - `webhook.duplicate`: the next event is sent twice with the same `eventId`.
   - `webhook.outOfOrder`: deposit `succeeded` (seq 2) is sent before `processing` (seq 1).
   - `rate.move`: the off-ramp converts at `floor(rateE4 × 0.98)`; `onDepositSucceeded` posts the shortfall from `fx_variance`.
   - Network fee: the chain reports the actual fee in the `final` event's `detail`, different from the estimate; `onTransferFinal` posts the actual from `fee_revenue` to `network_fee_expense` (P2). Define the estimate and the actual as two constants in `chain.ts`. Phase 3's `onTransferFinal` takes the fee as an argument and `instantProvider` sends `0`.
   - `crash.afterCommit`: see §19.
   - `client.readsFail`: a Fastify `onRequest` hook answers 503 `simulated_outage` on `GET /payouts*`.
4. **Rate**: `quotes/rate.ts` reads the simulator's current rate (base ± jitter).
5. **`src/ops/`** routes, registered only when `OPS_ENABLED`:
   - `GET /ops/summary`: payouts by state, counters (replays, 409s, 410s, duplicate and stale webhooks, refused transitions, computed from `ops_events`), stuck legs (not final for `STUCK_AFTER_MS`, or `checking`, with age and hop), outbox pending count and oldest age, worker `last_tick_at`.
   - `GET /ops/events?after=&payoutId=&kind=`: paged by id, 200 rows max.
   - `GET /ops/payouts/:id`: payout, legs, inbox events, outbox rows, idempotency record (hash, status; not the full key), ledger entries, per-currency sums, the "delivered = quoted" check, its ops events.
   - `GET /ops/config`: the parsed config, minus nothing secret (there is nothing secret; still assert no token appears).
   - `GET` / `PUT /ops/simulation`, `POST /ops/simulation/reset`, `POST /ops/quotes/:id/expire-in`.
6. **`GET /reconciliation`**: per payout, compare our ledger's hop amounts with each simulator's record; list mismatches and `fx_variance` and `network_fee_expense` totals. Corrects nothing.
7. **Slow flag**: `GET /payouts/:id` and `GET /payouts` add `slow: boolean` per leg, true when a hop has run longer than the §19 threshold. The client only reads it (S1).
8. **Logs**: confirm pino redaction covers `bankAccountToken` and that no ops event `data` carries it.

## Tests this phase adds

A helper `runToFinal(app, flags)` creates a quote and a payout with those flags, runs the worker and the sim scheduler until the payout is final (or a step limit, which fails the test), and returns the payout and its ledger sums.

- `scenarios.test.ts`, one test per switch, each ending with `assertBalanced` and exactly one final state:
  - `happy path ends delivered`
  - `slow: ends delivered, and the hop shows as slow on the way` (via `GET /payouts/:id` while running)
  - `H4: hop 1 declines, ends failed, nothing in the ledger`
  - `H5: hop 2 times out but happened, ends delivered with one transfer in the chain's record`
  - `P3: hop 2 times out and didn't happen, resent with the same ref, ends delivered`
  - `P4: reorg at 2 of 3, resubmitted with the same ref, deposit requested only after final`
  - `H6: hop 3 rejects the bank details, ends refunded, sender_bank back to zero, fee included`
  - `H7: duplicate webhook is ignored`
  - `H8: out-of-order deposit events end delivered`
  - `H10 P1: rate moved 2%, recipient gets the quoted pesos, fx_variance holds the difference`
  - `P2: network fee differs, posted to network_fee_expense, sender's numbers unchanged`
  - `H11: crash after commit, restart sends hop 1 once`
  - `S2: reads fail with 503 while client.readsFail is on`
- `ops.test.ts`
  - `S5: every switch in §11 can be set through PUT /ops/simulation` (iterate the schema keys)
  - `an unknown switch is 400`
  - `ops routes don't exist when OPS_ENABLED is false` (404)
  - `S8: the inspector shows legs, inbox, outbox, idempotency record and ledger for a payout`
  - `summary counts a replay, a 410, a duplicate webhook and a refused transition`
  - `expire-in moves a quote's expiry and a confirm after it is 410`
  - `P5: a leg pending longer than the threshold shows in stuck`
  - `S7: no bank account token in any ops event, log line or response` (capture pino output in the test)
- `reconciliation.test.ts`
  - `P6: a mismatch between our ledger and a simulator record is listed, not fixed` (tamper the sim record)

## Gate

```bash
pnpm verify
docker compose up -d --build
curl -fsS -X PUT localhost:8801/api/ops/simulation -H 'content-type: application/json' -d '{"deposit.rejectBank":true}'
docker compose down
```

Green, and the `PUT` answers 200 against the container. Every switch in §11 has a scenario test.

## Write down

PROCESS: Phase 4 entry, including anything the simulator showed that the plan got wrong. DECISIONS: Proposed entry for the network-fee constants and for the in-process webhook delivery.

## Out of scope

Any screen, including `/ops` (Phase 5). Signed webhooks (N2).
