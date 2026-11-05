# Plan

The handoff for building this app. Someone with this file, the [README](../README.md) and the [mockup](design/mockup/index.html) should be able to build it with nothing else. The design decisions behind the screens, and the token system the app uses, are in [design/mockup/DECISIONS.md](design/mockup/DECISIONS.md). Choices already made are in [DECISIONS.md](DECISIONS.md).

To build it, work through [phases/](phases/README.md): one brief per phase, each with the files to create, the tests to write and the gate to pass. Rules that hold for every change are in [AGENTS.md](../AGENTS.md). Every number and name the code needs is in [§19](#19-fixed-values).

## 1. Who it's for

**The sender.** Handles payments at a small US business that buys from Mexico. Knows bank transfers, not wallets or tokens. Clicks a button twice when the screen is slow, confirms with seconds left on a price, and leaves a payout running while doing something else. Wants three answers: how many pesos, by when, and can the screen be believed.

**The recipient.** A supplier in Mexico with a peso bank account. The peso amount on the sender's screen is the peso amount that lands, to the cent.

**The developer.** Clones the repo, runs one command, and can force every failure from `/ops`.

## 2. The invariant

> A payout finishes once, in one final state. Each hop moves money at most one time. The supplier gets exactly what was quoted, or the sender gets every cent back. When a provider and our ledger disagree, the ledger is right.

Work that doesn't protect this rule comes after the work that does.

## 3. Assumptions

Decided up front, so nobody has to guess:

- One sender business, one funding account, no login. A fixed `X-Account-Id` stands in for auth.
- One corridor: USD → MXN. Recipients are seeded; creating them is out of scope.
- The stablecoin is modelled as `DUSD`, a generic dollar token, 1 DUSD = 1 USD in the ledger, tracked as its own currency. No real chain.
- Custodial model: the platform holds the wallets and signs every transfer. The sender never sees a key (see [Custody](#15-custody)).
- Quote TTL is 60 seconds, enforced by the server clock.
- Fee: 0.5% of the amount sent, minimum $2.00. Limits: $10.00 to $50,000.00 per payout.
- English UI, desktop first, works at 375 wide.

## 4. Stack and shape

Same shape as a small production service, nothing more:

| Part              | Choice                                     | Why                                                                                     |
| ----------------- | ------------------------------------------ | --------------------------------------------------------------------------------------- |
| Workspace         | pnpm workspace, Node 26                    | One install, shared contracts, Node runs the API's TypeScript directly.                 |
| `apps/api`        | Fastify + `better-sqlite3`                 | SQLite gives real transactions and unique indexes in one file. No server to run.        |
| `apps/web`        | Vite + React                               | Three screens, `/ops` and a reducer. Path routes on the History API, no router library ([D13](DECISIONS.md#d13-path-routing-with-no-router-library)). |
| Styling           | CSS custom properties + CSS Modules        | The token system is already CSS variables. Vite supports CSS Modules with no extra dependency. No CSS framework. |
| Fonts             | `@fontsource-variable/figtree`, `@fontsource/jetbrains-mono` | Self-hosted from the bundle: no runtime request to a font CDN, works offline in the container. |
| `packages/shared` | Zod schemas, types inferred                | The client and the API validate against the same contract.                              |
| Tests             | Vitest (unit + HTTP via `inject`), Playwright | Failure paths at the HTTP seam; a few browser tests for double click, expiry, reload. |
| Run               | `docker compose up`                        | API, web and the simulator in one command. SQLite file on a volume.                     |
| Lint and format   | Biome                                      | One tool, one config.                                                                   |

```
apps/api/src
  quotes/       pricing, the 60-second hold, marking a quote used
  payouts/      POST /payouts with the idempotency record, machine.ts (the transition table)
  ledger/       journals, computed balances, the zero-sum check
  outbox/       the worker that calls providers
  webhooks/     event intake: dedupe by id, apply by sequence
  providers/    the Provider interface and the three simulated providers
  recon/        our ledger against each simulator's own record
  ops/          /ops API: event log, summary, payout inspector, simulation flags, effective config
apps/web/src
  styles/tokens/  primitives.css, roles.css (light + dark), the only place a colour literal may live
  styles/         base.css (reset, type, focus), fonts.ts
  ui/             Button, Pill, Callout, Card, SectionHead, PageHead, SideNav, Timeline, KeyValue,
                  Table, Segmented, AmountField, HoldBar, Money, Spinner, ThemeSwitch
  screens/        PayoutList, NewPayout (QuoteCard), PayoutDetail, Ops
  state/          reducer, api client, tone.ts (payout state → tone)
packages/shared/src
  money.ts, quote.ts, payout.ts, events.ts
```

## 5. States

All transitions live in one table in `payouts/machine.ts`. Anything not listed is refused and logged.

### Quote

`active → consumed` (a payout used it) or `active → expired` (server time passed `expires_at`). Both are final.

### Payout

```
created ─▶ collecting ─▶ transferring ─▶ paying_out ─▶ delivered
               │                │              │
               ▼                ▼              ▼
             failed         refunding ◀────────┘
                                │
                                ▼
                            refunded
```

| From         | To                          | Trigger                                              |
| ------------ | --------------------------- | ---------------------------------------------------- |
| created      | collecting                  | Worker sent `collect.request`                        |
| collecting   | transferring, failed        | Collect succeeded / declined                         |
| transferring | paying_out, refunding       | Transfer final / transfer cannot complete            |
| paying_out   | delivered, refunding        | Deposit succeeded / deposit rejected                 |
| refunding    | refunded                    | Refund to sender succeeded                           |

Final: `delivered`, `failed`, `refunded`. Exactly one per payout, enforced by the table and by a `CHECK` on the column.

### Leg (one row per hop, plus the refund)

`waiting → submitted → (checking) → processing → succeeded | failed` for collect, deposit and refund. The transfer leg goes `waiting → submitted → (checking) → confirming(n) → final`, and can go `confirming → dropped → submitted` (reorg). `checking` means "we asked and got no answer"; it is never final. The event-status-to-leg-state mapping is in [§19](#19-fixed-values).

The payout state never moves backwards. A leg's state only moves forward by event sequence.

## 6. Data model

Integer minor units everywhere (`*_minor`), rates as an integer scaled by 10^4.

| Table             | Key columns                                                                                                                                                       | Notes                                                                         |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `recipients`      | `id`, `label`, `country`, `currency`, `bank_account_masked`, `bank_account_token`                                                                                 | Seeded. The full account number never reaches the client.                     |
| `quotes`          | `id`, `recipient_id`, `mode` (`send`/`receive`), `rate_e4`, `send_minor`, `fee_minor`, `convert_minor`, `receive_minor`, `created_at`, `expires_at`, `status`, `payout_id` | `payout_id` unique: a quote is consumed once.                                 |
| `payouts`         | `id`, `quote_id` (unique), `recipient_id`, the four amounts copied from the quote, `status`, `failure_reason`, `flagged_at`, `created_at`, `updated_at`, `finished_at` | Amounts are frozen at confirm. `flagged_at` is ops-only (N3); it never changes status or ledger. |
| `payout_legs`     | `payout_id`, `leg` (`collect`/`transfer`/`deposit`/`refund`), `status`, `attempt`, `provider_ref`, `tx_hash`, `confirmations`, `last_seq`, `updated_at`           | Primary key `(payout_id, leg)`. `provider_ref` is ours and stable across retries. |
| `ledger_entries`  | `id`, `payout_id`, `journal_id`, `account`, `currency`, `amount_minor` (signed), `memo`, `created_at`                                                            | Append only. Each `journal_id` sums to zero per currency.                    |
| `outbox`          | `id`, `payout_id`, `kind`, `payload`, `created_at`, `due_at`, `sent_at`, `attempts`                                                                               | Written in the same transaction as the state change. `due_at` schedules `status.query` (and any deferred send); null means due now. |
| `inbox_events`    | `event_id` (primary key), `payout_id`, `leg`, `seq`, `status`, `received_at`, `applied` (bool)                                                                   | Dedupe on insert. `applied = false` records an ignored stale event.          |
| `ops_events`      | `id` (autoincrement), `at`, `kind` (`api`/`db`/`state`/`webhook`/`worker`/`provider`/`ledger`/`sim`), `level`, `payout_id`, `message`, `data` (JSON) | The server log `/ops` shows. Written by the same code paths, in the same transaction as the change it describes. Last 5,000 kept. |
| `idempotency_keys`| `key` (primary key), `body_hash`, `payout_id`, `response_status`, `response_body`, `created_at`                                                                   | Same key + same hash → stored response. Different hash → 409.                 |

## 7. API

JSON, validated with the shared Zod schemas. Errors are `{ error: code, message, issues? }`.

| Method and path                       | Does                                                                                     | Responses                                                                                                      |
| ------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `GET /recipients`                     | Saved recipients, masked                                                                 | 200                                                                                                            |
| `POST /quotes`                        | `{ recipientId, mode, amountMinor }` → priced quote with `expiresAt` and `serverNow`     | 201; 422 below min / above max                                                                                 |
| `POST /payouts`                       | Header `Idempotency-Key` (UUID). Body `{ quoteId }`                                      | 201 created; 200 replay; 409 `idempotency_conflict` or `quote_used`; 410 `quote_expired`; 404; 400 no key      |
| `GET /payouts`                        | List, newest first, with status and leg summary                                          | 200                                                                                                            |
| `GET /payouts/:id`                    | One payout with legs, timestamps and a per-leg `slow` flag (§19)                          | 200, 404                                                                                                       |
| `GET /payouts?idempotencyKey=`        | Find the attempt after a lost response                                                   | 200, 404                                                                                                       |
| `POST /webhooks/:provider`            | Simulator status events `{ eventId, providerRef, leg, status, seq, detail }`; headers `Timestamp` (unix sec) + `Signature` (HMAC-SHA256 hex of `timestamp.body`) | 200 applied; 200 `ignored: duplicate`; 200 `ignored: stale`; 401 bad/stale signature; 400                                               |
| `GET /payouts/:id/ledger`             | Entries and per-currency sums                                                            | 200                                                                                                            |
| `GET /reconciliation`                 | Per payout: our ledger vs the simulator's record, and the mismatches                     | 200                                                                                                            |
| `GET /ops/summary`                    | Counters, payouts by state, stuck legs, outbox backlog, worker heartbeat (see §13)        | 200                                                                                                            |
| `GET /ops/events?after=&payoutId=&kind=` | The server log, newest last, paged by id                                              | 200                                                                                                            |
| `GET /ops/payouts/:id`                | Everything the server holds for one payout: legs, inbox events, outbox rows, idempotency record, ledger and sums, its events | 200, 404                                                                       |
| `GET /ops/config`                     | The effective configuration, read only                                                    | 200                                                                                                            |
| `GET /ops/simulation`                 | Current simulator flags                                                                   | 200                                                                                                            |
| `PUT /ops/simulation`                 | Replace the flags. Unknown switches are 400                                               | 200                                                                                                            |
| `POST /ops/simulation/reset`          | Back to "everything works"                                                                | 204                                                                                                            |
| `POST /ops/quotes/:id/expire-in`      | `{ ms }`: move one quote's expiry, to test confirming at the edge                         | 200, 404, 409 if not active                                                                                    |

Every `/ops/*` route is registered only when `OPS_ENABLED=true` (on in `docker compose`, off by default elsewhere). There is no auth; this is where staff sign-in would go.

`serverNow` lets the client compute the countdown from the server's clock, so a skewed laptop clock doesn't change what the person sees.

## 8. Money rules

- **Send mode**: `fee = max(200, round(send × 0.005))`, `convert = send − fee`, `receive = floor(convert × rate)`. The supplier gets whole cents, rounded down, and the screen shows exactly that.
- **Receive mode**: `convert = ceil(receive ÷ rate)`, `send = ceil(convert ÷ 0.995)` with the minimum fee applied. The peso amount is exact; the dollar side rounds up.
- The four amounts are copied from the quote to the payout at confirm and never recomputed.
- **Rate moves between quote and conversion**: the recipient still gets `receive_minor`. The difference is posted to `fx_variance` (platform loss or gain). Visible in the ledger and in reconciliation, never to the sender.
- **Network fee differs from estimate**: absorbed, posted to `network_fee_expense` in USD.
- **Refund**: the sender gets `send_minor` back, fee included. Any FX loss on the way back is the platform's, posted to `fx_variance`.

## 9. Ledger

Accounts, by currency:

| Account                | USD | DUSD | MXN | Meaning                                         |
| ---------------------- | --- | ---- | --- | ----------------------------------------------- |
| `sender_bank`          | ✓   |      |     | External: the sender's funding account          |
| `usd_clearing`         | ✓   |      |     | Dollars collected, not yet converted            |
| `fee_revenue`          | ✓   |      |     | Our fee                                         |
| `onramp`               | ✓   | ✓    |     | Conversion account, USD in, DUSD out            |
| `treasury_wallet`      |     | ✓    |     | Our wallet on the sending side                  |
| `offramp_wallet`       |     | ✓    |     | The off-ramp provider's receiving wallet        |
| `offramp`              |     | ✓    | ✓   | Conversion account, DUSD in, MXN out            |
| `recipient_bank`       |     |      | ✓   | External: the supplier's account                |
| `fx_variance`          |     |      | ✓   | Rate moved after the quote; platform absorbs    |
| `network_fee_expense`  | ✓   |      |     | Chain fee, absorbed                             |

Postings per event (from → to, amount):

| Event              | Entries                                                                                                                                         |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Collect succeeded  | USD `sender_bank → usd_clearing` send; USD `usd_clearing → fee_revenue` fee; USD `usd_clearing → onramp` convert; DUSD `onramp → treasury_wallet` convert |
| Transfer final     | DUSD `treasury_wallet → offramp_wallet` convert; USD `fee_revenue → network_fee_expense` the actual chain fee (the platform pays it out of its fee) |
| Deposit succeeded  | DUSD `offramp_wallet → offramp` convert; MXN `offramp → recipient_bank` receive (split with `fx_variance` if the rate moved)                    |
| Refund succeeded   | The reverse of everything posted so far, plus the fee back to the sender                                                                       |

Checks that run in tests and in `GET /reconciliation`: every journal sums to zero per currency; a delivered payout has `recipient_bank` MXN equal to `receive_minor`; a refunded or failed payout has `sender_bank` USD back to zero and nothing left in a DUSD or MXN account. Platform accounts (`fee_revenue`, `network_fee_expense`, `fx_variance`) may be negative; that is the platform's cost, and it is the number reconciliation reports.

## 10. The worker, outbox and webhooks

**Creating a payout** is one SQLite transaction: check and store the idempotency key, check the quote is active and `now < expires_at`, mark it consumed, insert the payout and its four legs, insert `outbox(collect.request)`. No provider is called inside the request.

**The worker** polls the outbox every 250ms, sends each pending row to its provider with our stable `provider_ref` (`PO-1041-T1`), and marks it sent. Every state change that needs a next step writes that step's outbox row in the same transaction. On restart, unsent rows are sent again; providers dedupe on `provider_ref`.

**Webhooks**: insert into `inbox_events` first. A primary key conflict means a duplicate: answer 200, change nothing. Then compare `seq` with the leg's `last_seq`; lower or equal is stored with `applied = false` and ignored. Otherwise apply the leg change, run the payout transition, post ledger entries and write any outbox row, all in one transaction.

**Unknown outcome**: a provider call that times out sets the leg to `checking`. The worker then calls `getStatus(provider_ref)` with backoff. Found → continue from that status. Not found after the provider's own expiry window → resend with the same `provider_ref`. Still unknown after N minutes → the payout stays in its state, the leg stays `checking`, and it shows up in the stuck list. It is never retried blind and never marked failed on a guess.

**Hop 2 finality**: `submitted → confirming(n) → final` at 3 confirmations. Hop 3 is not requested until hop 2 is `final`. A reorg before final sets `dropped` and resubmits with the same reference.

## 11. Provider simulator

One interface, three fakes, the same code path as a real provider:

```ts
interface Provider {
  submit(ref: string, payload: unknown): Promise<{ accepted: true } | { declined: string }>; // may throw Timeout
  getStatus(ref: string): Promise<ProviderStatus | 'not_found'>;
}
```

The fakes post signed-shaped events to `/webhooks/:provider`, keep their own record of what happened (for reconciliation), and read their behaviour from the flags behind `PUT /ops/simulation`, set from the `/ops` page and by env vars for tests. The flags live in memory; a restart or "Reset" goes back to "everything works".

| Switch                     | Hop | What it does                                                         |
| -------------------------- | --- | -------------------------------------------------------------------- |
| `slow`                     | any | Multiplies every delay by 4                                         |
| `collect.decline`          | 1   | Refuses the debit                                                    |
| `transfer.timeout`         | 2   | `submit` throws a timeout; the transfer actually happened            |
| `transfer.timeoutLost`     | 2   | `submit` throws a timeout; the transfer did not happen               |
| `transfer.reorg`           | 2   | Drops the transfer at 2 of 3 confirmations (optional, N4)            |
| `deposit.rejectBank`       | 3   | Refuses the supplier's bank details once the funds reach the off-ramp |
| `webhook.duplicate`        | any | Sends the next event twice with the same id                          |
| `webhook.outOfOrder`       | 3   | Sends `succeeded` before `processing`                                |
| `rate.move`                | 3   | Converts at a rate 2% worse than quoted                              |
| `crash.afterCommit`        | —   | Kills the worker after the payout commit, before sending hop 1       |
| `client.readsFail`         | —   | `GET /payouts*` answers 503, so the client shows its offline strip   |
| `speed`                    | any | 1×, 3× or 10× on every simulated delay                               |

## 12. Client

- **List**: `GET /payouts` every 2s while any payout is unfinished. Clicking a row opens the payout.
- **New payout**: recipient, mode toggle (default "They receive"), amount, "See rate and fees". The quote card shows both amounts, the rate, the fee and a hold bar from `expiresAt − serverNow`. Editing the amount or recipient drops the quote.
- **Confirm**: one `Idempotency-Key` generated when the quote arrives, reused for every retry of that confirm. The button locks on the first click. A network error retries with the same key, then falls back to `GET /payouts?idempotencyKey=`. 410 shows "Rate expired… Nothing was sent". 409 `quote_used` shows the existing payout.
- **Payout**: `GET /payouts/:id` every 1s until final. The timeline renders only what the server returned. If the API is unreachable, a strip says so and shows when the status was last confirmed. Nothing says "Delivered" until the server does.
- State in a reducer; no client cache library needed for three screens.
- No simulation controls on the sender's screens. The mockup keeps its rail beside the app only because it is one file; in the app that rail is `/ops`.

## 13. The /ops page

A separate route, `/ops`, for whoever runs or demos the app. It shows everything that happens on the server side, and it is the only place that can change the simulator. It never presses buttons on the sender's screen: open the app in one tab and `/ops` in another. Same idea as a counter page next to a self-service screen.

It is not linked from the sender's side nav. Dev builds show a small "Ops" link in the nav footer; otherwise it is reached by URL. It uses the same tokens and components, with an "Ops · not part of the product" eyebrow on its page head.

### What it shows

| Panel                | Source                      | Content                                                                                                                                  |
| -------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Summary              | `GET /ops/summary`          | Payouts by state; idempotent replays; 409 and 410 answers; duplicate and stale webhooks ignored; refused transitions; outbox rows pending and oldest age; worker last tick |
| Stuck                | `GET /ops/summary`          | Legs not final for longer than a threshold (5 minutes, configurable), and every leg in `checking`, with how long and which hop          |
| Reconciliation       | `GET /reconciliation`       | Per-payout mismatches between our ledger and the simulator's record, and `fx_variance` totals                                           |
| Server log           | `GET /ops/events`           | Live tail, newest first, filter by kind and by payout id. Same lines as the mockup's log: API calls and their status, transactions, state transitions (and refused ones), webhooks applied or ignored with the reason, outbox sends, worker decisions, provider calls |
| Payout inspector     | `GET /ops/payouts/:id`      | Opened from any payout id on the page: legs with sequence numbers, inbox events, outbox rows, the idempotency record, ledger entries with per-currency sums and the "delivered = quoted" check |
| Config               | `GET /ops/config`           | Read only: quote TTL, fee, limits, confirmations, worker interval, stuck threshold, DB path, app version, `OPS_ENABLED`, masked `WEBHOOK_SECRET` |
| Simulation           | `GET`/`PUT /ops/simulation` | The next-payout scenario, every switch in §11, speed, "Expire a quote in 1s" (picks the newest active quote), and Reset                 |

The page polls every 2 seconds; server-sent events are N1. Every number and log line comes from the API, so anyone can check a claim ("two confirms made one payout") on `/ops` instead of in the database.

### Why a route and not a panel in the app

- The sender's screens stay what a real user would see. Nothing on them can change the simulator by accident.
- The person forcing failures and the person using the app can be on two screens.
- Stuck payouts show up in one place before anyone has to report them. In production that query is what an alert would watch.

### Logging rules

- Every `ops_events` row is also a structured log line (`payoutId`, `leg`, `eventId`, `kind`). The table is for the page; the log is for production.
- No full bank account numbers, keys or wallet secrets in either. Masked values only.
- An event that describes a state change is written in the same transaction as that change, so the log can't show something that was rolled back.

## 14. Design system

The look is fixed by the mockup: warm paper backgrounds, near-black ink, one deep indigo accent, Figtree with medium-weight headings, JetBrains Mono for references, left-border callouts, a ring-dot timeline and a sticky side nav. Values, contrast numbers and the patterns to keep are in [DECISIONS § Tokens](design/mockup/DECISIONS.md#tokens). This section is how the app sets it up so it stays that way.

### Where the tokens live

- `apps/web/src/styles/tokens/primitives.css` holds the raw values (`--p-paper-1`, `--p-indigo-700`). Copied from the mockup, not retyped.
- `apps/web/src/styles/tokens/roles.css` maps them to roles for light (`:root`) and for dark (`@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) }` and `:root[data-theme="dark"]`). Both themes are defined in the same change, never one derived from the other later.
- Only `apps/web` consumes the tokens, so they live there and not in a package. If a second consumer shows up (a separate ops app, email templates), they move to `packages/tokens` with no renames.
- Components use roles only. A component that needs its own decision gets a component token pointing at a role (`--hold-bar-fill: var(--accent)`), never a primitive and never a literal.

### Fonts

- `@fontsource-variable/figtree` (one variable file covers 400 to 700) and `@fontsource/jetbrains-mono` 400 and 500, Latin subset, imported once in `styles/fonts.ts`.
- `font-display: swap`, and a `<link rel="preload">` for the Figtree file so the first paint of amounts doesn't reflow.
- Fallback stacks stay as in the mockup (`system-ui` for sans, `ui-monospace` for mono).
- Amounts use Figtree with `font-variant-numeric: tabular-nums`; a browser test renders "0000" and "1111" and asserts equal width, so a font swap can't silently break column alignment.

### Theme

- Default follows the system. The side nav's System / Light / Dark switch sets `data-theme` on `<html>` and stores the choice in `localStorage` (read and write wrapped in `try`, so a blocked storage still works for the visit).
- A four-line inline script in `index.html` applies the stored choice before first paint, so there is no flash of the wrong theme.

### Components

Each one lives in `ui/` with a CSS Module and takes a small typed prop surface. Tone is one union, `'info' | 'success' | 'caution' | 'danger'`, used by `Pill`, `Callout` and `Timeline` steps. The mapping from payout state to tone is one function, `state/tone.ts`, matching the table in DECISIONS, so a new state can't pick a colour on its own.

| Component     | Props worth naming                                    | Pattern it carries                            |
| ------------- | ----------------------------------------------------- | --------------------------------------------- |
| `PageHead`    | `eyebrow`, `title`, `lede`, `action`                  | Eyebrow, medium title, glow, rule             |
| `Callout`     | `tone`, `label`, `title`, `children`, `role`          | 3px left border, soft fill, uppercase key     |
| `Pill`        | `tone`, `children`                                    | Dot plus word                                 |
| `Timeline`    | `steps: { tone, index, word, at?, title, detail }[]`  | Ring dots, mono "01 · Done · time" line       |
| `Money`       | `minor`, `currency`, `size`                           | Sans, tabular figures, never mono             |
| `SideNav`     | `current`                                             | Active link tint and left border              |

### Guardrails in `pnpm verify`

- `scripts/check-tokens.mjs` fails the build on a hex, `rgb()` or `hsl()` literal anywhere in `apps/web/src` outside `styles/tokens/`, and on any `var(--p-…)` outside `roles.css`.
- `tokens.test.ts` parses both token files, resolves every role in both themes, and asserts the text pairs in DECISIONS at 4.5:1 or more and the line pairs at 3:1 or more.
- Playwright runs axe on the list, new payout and payout screens, in light and in dark.

## 15. Custody

The platform holds the treasury wallet's key and signs every hop-2 transfer from a server-side signer. The sender never signs anything and never sees a wallet. If the signer is down, payouts wait in `transferring` with hop 2 `waiting`; the outbox keeps the request and the stuck list shows them. Nothing is lost and nothing is refunded early. A self-custodial version, where the sender signs, would add a "waiting for your signature" leg state and a timeout that ends in a refund; that is out of scope.

## 16. Requirements

IDs are stable; status will be tracked in `docs/COVERAGE.md` once code exists.

### Must handle (H)

The H1 to H12 list in the [README](../README.md#what-happens-when). Each one gets an HTTP test and, where the person can see it, a browser test.

### Should handle (S)

| ID  | Situation                                         | Plan                                                                                                     |
| --- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| S1  | A provider is slow                                | "Taking longer than usual. Nothing is wrong yet." after a per-hop threshold. No state change.             |
| S2  | The API is unreachable from the client            | Warning strip with the last confirmed time; polling backs off; screens never guess.                       |
| S3  | Invalid input                                     | Zod at the edge, 400 with `issues`; inline field errors; min and max shown in the message.              |
| S4  | The confirm response is lost                      | Retry with the same key; then look up by key. Never a new key for the same attempt.                       |
| S5  | Every failure can be forced quickly               | The simulation panel on `/ops` plus env vars; each switch in §11 has a test.                             |
| S6  | Accessibility                                     | Labels on every field, status in words and symbols, live region on the payout banner, AA contrast in both themes checked by `tokens.test.ts` and axe. |
| S7  | Logs are useful and safe                          | Structured logs with `payoutId`, `leg`, `eventId`. No full bank account numbers.                         |
| S8  | Someone can see what the server did, without the database | `/ops`: summary, stuck legs, reconciliation, the server log and a per-payout inspector (§13).     |

### Money-movement problems (P)

| ID  | Situation                                         | Plan                                                                                                     |
| --- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| P1  | Rate moved 2% between quote and conversion        | Recipient gets the quoted pesos; `fx_variance` records the cost; reconciliation lists it.                |
| P2  | Network fee differs from the estimate             | Absorbed, posted to `network_fee_expense`. The sender's numbers don't change.                            |
| P3  | Transfer timed out and the transfer never happened | `getStatus` says not found; resend with the same reference after the provider's window.                 |
| P4  | Reorg before finality (optional)                  | `dropped`, resubmit with the same reference, no hop 3 until final.                                       |
| P5  | Hop 3 pending for hours                           | The screen keeps saying it's in progress; appears in a stuck list with how long and on which leg.                          |
| P6  | Our ledger and a provider disagree                | `GET /reconciliation` lists per-payout mismatches; nothing is auto-corrected.                           |

### Traps to avoid (T)

| ID  | Trap                                                        | How it's avoided                                                                      |
| --- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| T1  | Floats for money                                            | Integer minor units and an integer-scaled rate, from schema to column to state.       |
| T2  | Trusting the client's countdown                             | The server checks `expires_at` against its own clock.                                 |
| T3  | Calling a provider inside the request transaction           | The request only writes the outbox; the worker calls providers.                       |
| T4  | Retrying a timed-out call with a new reference              | One `provider_ref` per leg, reused on every send; status query first.                 |
| T5  | Letting a webhook set the payout state directly             | Webhooks change a leg; the state machine decides the payout.                          |
| T6  | A stored balance column                                     | Balances are sums of entries.                                                         |
| T7  | Showing "Done" from client logic                            | The client renders server state only.                                                 |
| T8  | Recomputing amounts after confirm                           | The four amounts are frozen on the payout.                                            |
| T9  | Crypto vocabulary in the main flow                          | "Funds moving to Mexico"; the network reference lives under support details.          |

### Nice to have (N)

Only once H, S and P1 to P3 are green.

| ID  | What                                                                         |
| --- | ---------------------------------------------------------------------------- |
| N1  | Server-sent events instead of polling for the timeline|
| N2  | Signed webhooks (HMAC) with a timestamp window against replay|
| N3  | Support actions on `/ops`: re-run a status query, flag a payout for review|
| N4  | Reorg simulation (P4)|
| N5  | Read one real testnet stablecoin transfer by hash, display only|
| N6  | A second chain behind the same `Provider` interface, to prove the seam|
| N7  | Screenshot tests per screen in both themes, to catch token regressions|

### Skipped, and why

- **Auth and multiple businesses.** One sender keeps the focus on the money path. `X-Account-Id` marks where auth would go.
- **Adding and editing recipients.** Bank-detail validation is its own problem; seeds are enough to trigger hop 3's rejection.
- **Real providers and a real chain.** The simulator is more useful: it can fail on demand.
- **Compliance (KYC, sanctions screening, limits per day).** Real and required in production; it would be a step before `collecting`.
- **Fixing bank details and retrying instead of refunding.** A better experience, but it needs a "held" state with a deadline. The refund path is simpler and keeps the invariant.
- **Postgres.** SQLite gives transactions and unique constraints in one file. The schema is portable.

## 17. Delivery phases

Each phase ends with `pnpm verify` green and a commit. A phase isn't done until its gate passes. The step-by-step brief for each one is in [phases/](phases/README.md).

| Phase | Output                                                                                   | Gate                                                                                  |
| ----- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 0     | This plan, the mockup, `docs/DECISIONS.md` v1, `AGENTS.md`, the phase briefs             | The invariant and H1 to H12 written before code (done)                                |
| 1     | Workspace, compose, shared money and contract schemas; tokens, fonts, base styles, theme script, token guardrails | `docker compose up` serves a health check; money tests pass; `check-tokens` and `tokens.test.ts` green |
| 2     | Quotes and payouts: pricing, expiry, idempotency, the state machine                      | H1, H2, H3 HTTP tests; illegal transitions refused                                    |
| 3     | Ledger, outbox worker, webhook intake                                                    | H7, H8, H11, H12 tests; every journal sums to zero                                    |
| 4     | Simulator with every switch in §11; `ops_events` and the `/ops/*` API                    | H4, H5, H6, H10, P1, P3 tests end in a final state with a balanced ledger; every switch settable through `PUT /ops/simulation` |
| 5     | `ui/` components, then the client: list, new payout, timeline, and the `/ops` page       | Playwright: double click, expiry at the edge, reload mid-payout, decline, refund; axe clean in both themes |
| 6     | Reconciliation, README run steps, DECISIONS, COVERAGE                                    | Fresh clone → one command → every switch tried by hand                                |
| 7     | Nice-to-haves in N order                                                                 | Each one with a test, or it doesn't ship                                              |

## 18. Done means

- [x] A fresh clone on a Unix machine runs with `docker compose up` and nothing else. _(Phase 6: compose gate; see PROCESS)_
- [x] Two Confirm clicks leave one row in `payouts` (checked with a query, not on screen). _(e2e H1; api H1)_
- [x] A quote past its hold is refused, and the screen offers a new price. _(e2e H2 expiry)_
- [x] Each switch in §11 leaves its payout in one final state and its ledger at zero per currency. _(scenarios + ops S5)_
- [x] Reopening a payout after closing the tab shows what the server has. _(e2e H9)_
- [x] `recipient_bank` MXN for a delivered payout equals the `receive` shown at confirm. _(ledger test)_
- [x] `docs/DECISIONS.md` records what was left out (PLAN §16 "Skipped") and why. _(D21)_
- [x] No colour literal in `apps/web/src` outside the token files, and every text pair passes AA in both themes. _(check-tokens + tokens.test + axe)_
- [x] The app makes no request to a third-party host at runtime (fonts included). _(e2e localhost-only)_
- [x] Every switch can be forced from `/ops`, and `/ops` shows each payout's full server-side history: events, legs, inbox, outbox, idempotency record and ledger. _(ops S8 inspector + e2e S5)_

## 19. Fixed values

Every number and name the code needs, so nobody invents one. Each one lives in exactly one place in code: env vars in `apps/api/src/config.ts` (parsed with Zod at startup, shown on `/ops/config`), money constants in `packages/shared/src/money.ts`.

### Runtime and env vars

| Name                  | Default                  | Notes                                                                            |
| --------------------- | ------------------------ | -------------------------------------------------------------------------------- |
| Node                  | 26 (`.nvmrc`)            | `engines` `^26.0.0`. pnpm via `packageManager` (Docker installs pnpm with npm; Corepack is not shipped in Node 26). |
| `PORT`                | `3000`                   | API, inside the container only.                                                  |
| `WEB_PORT`            | `8801`                   | Host port for the web container (nginx). nginx proxies `/api/*` to `api:3000/*`. |
| Vite dev              | `5173`                   | `vite.config.ts` proxies `/api` to `localhost:3000`, stripping the prefix.       |
| `DB_PATH`             | `./data/payouts.db`      | `/data/payouts.db` on the compose volume. Tests use `:memory:`.                  |
| `OPS_ENABLED`         | `false`                  | `true` in `docker-compose.yml`.                                                  |
| `ACCOUNT_ID`          | `acct_demo`              | Expected value of `X-Account-Id`. Anything else is 401 `unknown_account`.        |
| `QUOTE_TTL_MS`        | `60000`                  |                                                                                  |
| `WORKER_INTERVAL_MS`  | `250`                    | Outbox poll.                                                                     |
| `STATUS_BACKOFF_MS`   | `1000,2000,4000,8000`    | `getStatus` retries for a `checking` leg, then every 8000 until given up.        |
| `PROVIDER_WINDOW_MS`  | `30000`                  | After this, a provider's `not_found` is trusted and the leg is resent.           |
| `CHECKING_GIVE_UP_MS` | `600000`                 | After this, a `checking` leg stops being retried and stays in the stuck list.   |
| `STUCK_AFTER_MS`      | `300000`                 | A leg not final for this long is "stuck" on `/ops`.                              |
| `SIM_FLAGS`           | unset                    | JSON of §11 flags applied at startup. Used by tests and by e2e.                  |
| `SIM_RATE_JITTER_E4`  | `150`                    | Quote rate is `172500 ± jitter`. `0` in tests.                                   |
| `LOG_LEVEL`           | `info`                   | Fastify's pino logger.                                                           |
| `WEBHOOK_SECRET`      | `whsec_demo_sample`      | HMAC-SHA256 for `POST /webhooks/*` (`Signature` over `timestamp.body`). Masked on `/ops/config`. |
| `TESTNET_LOOKUP_ENABLED` | `false`              | When true, `GET /payouts/:id/network-ref` looks up the transfer hash via public JSON-RPC (no keys). |
| `TESTNET_RPC_URL`     | `https://rpc.sepolia.org` | Used only when lookup is enabled. Tests inject a recorded response instead.                  |
| `CHAIN_PROVIDER`      | `sim`                    | Hop-2 `Provider`: `sim` (default) or `alt` (N6 seam). Nothing in `payouts/` / `ledger/` changes. |

### Money

| Constant           | Value        |                                                                          |
| ------------------ | ------------ | ------------------------------------------------------------------------ |
| `BASE_RATE_E4`     | `172500`     | 17.2500 MXN per USD.                                                     |
| `FEE_BPS`          | `50`         | 0.5% of `send`.                                                          |
| `FEE_MIN_MINOR`    | `200`        | $2.00.                                                                   |
| `SEND_MIN_MINOR`   | `1000`       | $10.00. Checked on `send` in both modes.                                 |
| `SEND_MAX_MINOR`   | `5000000`    | $50,000.00. Checked on `send` in both modes.                             |
| `CONFIRMATIONS`    | `3`          | Hop 2 is final at 3.                                                     |
| `RATE_MOVE_BPS`    | `200`        | `rate.move` converts at `floor(rateE4 × 0.98)`.                          |

Rounding, with integers only (no floats in the formula):

- Send mode: `fee = max(200, roundHalfUp(send × 50 / 10000))`; `convert = send − fee`; `receive = floor(convert × rateE4 / 10000)`.
- Receive mode: `convert = ceil(receive × 10000 / rateE4)`; `send = max(convert + 200, ceil(convert × 10000 / 9950))`; `fee = send − convert`.
- `money.test.ts` covers: both modes at the minimum, at the maximum, where the minimum fee applies and where it doesn't, and a property test that receive mode always gives exactly the asked pesos and send mode never gives more pesos than `convert` buys.

### Identifiers

| Thing         | Format                       | Example          |
| ------------- | ---------------------------- | ---------------- |
| Payout        | `PO-` + counter from 1041    | `PO-1041`        |
| Quote         | `q_` + 12 random base32      | `q_7k2m9x4p1t8c` |
| Provider ref  | payout id + leg letter (`C`, `T`, `D`, `R`) + `1`. Never changes for that leg, also on resend and reorg resubmit; `attempt` counts the sends | `PO-1041-T1` |
| Webhook event | `evt_` + 12 random base32    | `evt_3n8q…`      |
| Journal       | `j_` + 12 random base32      |                  |
| Recipient     | `r1`, `r2`, `r3` (seeded)    |                  |

### Seed data

On an empty database, `apps/api/seed/seed.ts` inserts:

- Funding account `••••2290`.
- `r1` Fabric supplier, Monterrey, MX, `••••4821`. `r2` Packaging supplier, Guadalajara, MX, `••••0937`. `r3` Freight agent, Veracruz, MX, `••••5510`. `bank_account_token` is a random opaque string.
- Two delivered payouts, `PO-1039` (r2, 48,200.00 MXN, 26 hours ago) and `PO-1040` (r1, 310,000.00 MXN, 3 hours ago), with legs and ledger entries written through the same posting code as live payouts.

### Error codes

| HTTP | `error`                   | When                                                          |
| ---- | ------------------------- | ------------------------------------------------------------- |
| 400  | `validation_failed`       | Zod failure; `issues` has the paths                            |
| 400  | `missing_idempotency_key` | `POST /payouts` without the header, or not a UUID              |
| 401  | `unknown_account`         | `X-Account-Id` missing or wrong                                |
| 404  | `not_found`               | Unknown recipient, quote or payout                             |
| 409  | `idempotency_conflict`    | Same key, different body                                       |
| 409  | `quote_used`              | Quote already consumed by another payout; body has `payoutId`  |
| 409  | `quote_not_active`        | `POST /ops/quotes/:id/expire-in` on a consumed or expired quote |
| 410  | `quote_expired`           | `now >= expires_at`                                            |
| 422  | `amount_out_of_range`     | `send` below min or above max; body has `minMinor`, `maxMinor` |
| 503  | `simulated_outage`        | `client.readsFail` is on                                       |

### Providers, events and leg states

Webhook paths: `/webhooks/collect` (hop 1 and refund), `/webhooks/chain` (hop 2), `/webhooks/offramp` (hop 3).

| Leg      | Event `status` | Leg state after          | Payout transition it can trigger      |
| -------- | -------------- | ------------------------ | ------------------------------------- |
| collect  | `processing`   | `processing`             |                                       |
| collect  | `succeeded`    | `succeeded`              | `collecting → transferring`           |
| collect  | `declined`     | `failed`                 | `collecting → failed`                 |
| transfer | `submitted`    | `submitted` (+ `tx_hash`) |                                      |
| transfer | `confirming`   | `confirming` (+ n)       |                                       |
| transfer | `dropped`      | `dropped`, then resubmitted as `submitted` attempt 2 |               |
| transfer | `final`        | `final`                  | `transferring → paying_out`           |
| deposit  | `processing`   | `processing`             |                                       |
| deposit  | `succeeded`    | `succeeded`              | `paying_out → delivered`              |
| deposit  | `rejected`     | `failed`                 | `paying_out → refunding`              |
| refund   | `succeeded`    | `succeeded`              | `refunding → refunded`                |

A leg that times out on submit is `checking` until `getStatus` answers. `failure_reason` on the payout: `collect_declined`, `bank_details_rejected`.

Outbox kinds: `collect.request`, `transfer.request`, `deposit.request`, `refund.request`, `status.query`. Payload carries `payoutId`, `leg`, `providerRef` and the amount for that hop.

### Ledger postings for the refund

When hop 3 rejects: DUSD `offramp_wallet → treasury_wallet` convert (returned); DUSD `treasury_wallet → onramp` convert; USD `onramp → usd_clearing` convert; USD `fee_revenue → usd_clearing` fee; USD `usd_clearing → sender_bank` send. After it, every account for that payout is back to zero in every currency.

### Simulator timing at 1× speed

| Step                                   | Delay   |
| -------------------------------------- | ------- |
| collect submit → `succeeded`           | 1800 ms |
| transfer submit → `submitted`          | 1400 ms |
| each confirmation                      | 1100 ms |
| deposit submit → `processing`          | 1800 ms |
| deposit `processing` → `succeeded`     | 600 ms  |
| refund submit → `succeeded`            | 2600 ms |
| `transfer.timeout` hang before throwing | 3200 ms |
| `webhook.duplicate` second send        | 400 ms after the first |

`slow` multiplies every delay by 4; `speed` divides by 1, 3 or 10. The "Taking longer than usual" line shows when a hop has run longer than 3× its normal total at the current speed.

Flags are read when the worker sends a leg's request, except `client.readsFail`, `slow` and `speed`, which act immediately. `crash.afterCommit` is one-shot: the next `POST /payouts` commits, then the worker stops without sending. In compose the API process exits with code 1 and `restart: unless-stopped` brings it back; in tests the worker is stopped and a new one started on the same database.

### Client timing

| What                         | Value                                               |
| ---------------------------- | --------------------------------------------------- |
| List poll                    | 2000 ms while any payout isn't final                |
| Payout poll                  | 1000 ms until final                                 |
| `/ops` poll                  | 2000 ms                                             |
| Back-off after a failed read | 1000, 2000, 4000, then every 10000 ms               |
| Confirm retries              | 2, same key, 500 and 1500 ms apart, then `GET /payouts?idempotencyKey=` |
| Countdown tick               | 250 ms, from `expiresAt − serverNow` plus the time since the response |
