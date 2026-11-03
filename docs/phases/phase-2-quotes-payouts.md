# Phase 2: Quotes and payouts

**Goal**: the API can price a quote, hold it for 60 seconds on its own clock, and turn it into exactly one payout, no matter how many times or how late Confirm arrives. The payout state machine exists and refuses anything not in its table.

**Read first**: PLAN §5 (states), §6 (tables `recipients`, `quotes`, `payouts`, `payout_legs`, `idempotency_keys`, `outbox`, `ops_events`), §7 (the first seven rows), §8, §10 "Creating a payout", §19. DECISIONS D4. README H1, H2, H3.

**Start state**: Phase 1 gate green.

## Build, in this order

1. **`src/ops/events.ts`**: `recordEvent(tx, { kind, level, payoutId?, message, data? })`. Inserts into `ops_events` inside the caller's transaction and logs the same fields through pino. Trims the table to the last 5,000 rows every 500 inserts. Everything below calls it.
2. **`src/recipients/`**: `GET /recipients` returns `id`, `label`, `city`, `country`, `currency`, `bankAccountMasked`. Never the token.
3. **`src/quotes/`**
   - `rate.ts`: `currentRateE4()` = `BASE_RATE_E4 ± SIM_RATE_JITTER_E4` (random). The simulator replaces this in Phase 4; keep it a function.
   - `POST /quotes` `{ recipientId, mode, amountMinor }`: prices with `packages/shared` money functions, checks limits on `send` (422 `amount_out_of_range` with `minMinor`, `maxMinor`), stores `expires_at = now() + QUOTE_TTL_MS`, returns the quote with `expiresAt` and `serverNow`. 201.
   - `expireDue(tx)`: marks `active` quotes with `expires_at <= now()` as `expired`. Called by `POST /payouts` before it reads the quote, and on a 5-second timer.
4. **`src/payouts/machine.ts`**: the transition table from PLAN §5 as data (`{ from, to, trigger }[]`). `transition(tx, payoutId, to, trigger)` checks the table, updates `status` and `updated_at` (and `finished_at` for a final state), records an `ops_events` `state` row, and returns the new row. A transition not in the table throws `IllegalTransition`, records a `state` row at level `warn` with `refused: true`, and changes nothing.
5. **`src/payouts/create.ts`**, `POST /payouts`, in one `db.transaction()`:
   1. Header `Idempotency-Key` must be a UUID, else 400 `missing_idempotency_key`.
   2. Hash the canonical JSON body (sha256). Look up the key. Found with the same hash: return the stored `response_status` and `response_body` (a replay, counted on `/ops`). Found with a different hash: 409 `idempotency_conflict`.
   3. `expireDue`, then load the quote. Missing: 404. `consumed`: 409 `quote_used` with `payoutId`. `expired` or `now() >= expires_at`: 410 `quote_expired`.
   4. Mark the quote `consumed`, insert the payout (`PO-` counter, the four amounts copied), its four legs (`collect`, `transfer`, `deposit` at `waiting`, `refund` at `waiting`; refund stays unused unless needed) with their `provider_ref`, the `outbox` row `collect.request`, and the `idempotency_keys` row with the response.
   5. Transition `created → collecting` happens in Phase 3 when the worker sends. For now the payout stays `created`.
   - Error responses for 404, 409 and 410 are stored under the key too, so a retry gets the same answer.
6. **`GET /payouts`**, **`GET /payouts/:id`**, **`GET /payouts?idempotencyKey=`**: list newest first with a per-leg summary; one payout with legs and timestamps; lookup by key (404 if none).

## Tests this phase adds (`apps/api/test/`)

Use `app.inject`, an in-memory DB and the fake clock. No sleeps.

- `quotes.test.ts`
  - `S3: rejects a float amount with 400 and the issue path`
  - `rejects an amount below $10 with 422 and the limits` (both modes)
  - `receive mode quotes the exact pesos asked`
  - `the quote expires 60 seconds after it was made, by the server clock`
- `payouts.create.test.ts`
  - `H1: confirming twice with the same key creates one payout` (second answer is 200 with the same body; count rows)
  - `H1: two confirms with the same key sent at once create one payout` (`Promise.all` of two `inject`s)
  - `H1: the same key with a different body is 409 idempotency_conflict`
  - `H2: a confirm 1ms before expiry is accepted at the quoted rate`
  - `H2: a confirm at expiry is 410 and nothing is written` (count payouts, outbox, keys for the quote)
  - `H3: a used quote can't make a second payout, even with a new key` (409 `quote_used` with the first `payoutId`)
  - `S4: a retry after a lost response finds the payout by key`
  - `T2: the client's countdown is ignored` (send a body with a client time field; it's rejected as unknown, and expiry still follows the server clock)
  - `T3: creating a payout calls no provider` (inject a provider spy; zero calls)
  - `T8: the payout keeps the quote's four amounts`
  - `writes the collect request to the outbox in the same transaction` (force the payout insert to fail; no outbox row, no key, quote still active)
- `machine.test.ts`
  - every allowed transition in the table succeeds
  - `refuses delivered → collecting and records it` (and every other pair not in the table, generated)
  - `a final state can't change`

## Gate

```bash
pnpm verify
```

Green, with every test above present. `grep -r "Date.now" apps/api/src` returns nothing outside `clock.ts`.

## Write down

PROCESS: Phase 2 entry, test counts. DECISIONS: Proposed entry for anything the plan didn't fix (for example the canonical-JSON hashing rule).

## Out of scope

The worker, ledger entries and webhooks (Phase 3). Simulator flags (Phase 4). `/ops` routes (Phase 4), though `ops_events` rows are written from here on.
