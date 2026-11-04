# Decisions

Short records of choices that outlive a single change. Each says what was rejected and why, so a later reader can tell a settled tradeoff from an accident. "Accepted" means it's settled. "Proposed" means whoever was building recorded a call they had to make, and it still needs a second look.

To add one: next number, same four headings. To change one: add a new entry that says which one it supersedes, and add "Superseded by Dn" to the old one. Don't edit an accepted decision in place.

## D1. Design the app before any code

**Status**: Accepted

**Decision**: The screens, copy, states and tokens are fixed by a single-file clickable mockup in [`design/mockup/`](design/mockup/DECISIONS.md). The mockup carries a small fake server so every failure can be forced before the real one exists.

**Options considered**

- _Mockup with a fake server and a simulation rail_ (chosen): the state model ran on screen before it was written down, and it found two bugs in the plan (the refunded-amount label, concurrent confirms).
- _Static screenshots_ (rejected): they can't show a countdown, a retry or an out-of-order webhook.

**Consequences**: when the app and the mockup disagree on wording, the mockup is right unless a later decision says otherwise.

## D2. SQLite through better-sqlite3, one file

**Status**: Accepted

**Decision**: One SQLite file, opened with `better-sqlite3`, WAL mode, `foreign_keys = ON`. Every write path is a synchronous `db.transaction()`.

**Options considered**

- _SQLite_ (chosen): real transactions, unique indexes and `CHECK` constraints with no server to run. Synchronous transactions can't interleave inside one process, which makes "check the key, consume the quote, insert the payout" atomic without locks.
- _Postgres_ (rejected for now): more to run for no new guarantee at this size. The schema stays portable.
- _An ORM_ (rejected): the queries are few and the transaction boundaries are the point. Plain SQL in one file per module.

**Consequences**: one API process. At much higher volume, SQLite's single writer and the one polling worker are the first limits.

## D3. Providers are only called by the outbox worker

**Status**: Accepted

**Decision**: A request handler or a webhook handler only writes rows: the state change, ledger entries, `ops_events`, and an `outbox` row for the next provider call, all in one transaction. A worker polls the outbox and calls providers outside any transaction.

**Options considered**

- _Outbox_ (chosen): a crash between "saved" and "sent" leaves an unsent row that the worker sends on restart (H11).
- _Call the provider inside the request_ (rejected): a timeout leaves a committed payout with no record of what was asked, or a provider call with no payout.

## D4. The idempotency key is stored in the same transaction that consumes the quote

**Status**: Accepted

**Decision**: `POST /payouts` inserts into `idempotency_keys`, marks the quote consumed and inserts the payout in one transaction. A replay with the same key and body hash returns the stored status and body. A different body hash is 409 `idempotency_conflict`.

**Options considered**

- _Key and payout in one transaction_ (chosen): two confirms arriving together make one payout; the second gets a 200 replay.
- _Check the key, then create_ (rejected): two requests can both pass the check.

## D5. Double-entry ledger, the stablecoin as its own currency

**Status**: Accepted

**Decision**: Append-only `ledger_entries`, signed amounts, one journal per event, each summing to zero per currency. USD, DUSD and MXN are separate currencies. Postings are fixed in PLAN §9. Balances are sums.

**Options considered**

- _DUSD as its own currency_ (chosen): a payout stuck between hops shows exactly where the money is.
- _Treat DUSD as USD_ (rejected): a transfer in flight would be invisible in the ledger.

## D6. An unknown outcome is a state, not an error

**Status**: Accepted

**Decision**: A provider call that times out sets the leg to `checking`. The worker asks `getStatus(provider_ref)` with backoff before anything else. It resends with the same reference only when the provider says "not found" after its own expiry window. It never marks a leg failed on a guess.

**Options considered**

- _Query first, resend with the same reference_ (chosen): no double transfer, no lost one.
- _Retry on timeout_ (rejected): the transfer may already have happened.
- _Fail on timeout and refund_ (rejected): the transfer may already have happened, and then both sides have the money.

## D7. A rejected deposit refunds the sender in full

**Status**: Accepted

**Decision**: When hop 3 rejects the bank details, the off-ramp returns the DUSD, it's redeemed to USD, and the sender gets `send` back, fee included. Final state `refunded`. Any loss on the way back is the platform's.

**Options considered**

- _Full refund_ (chosen): keeps the invariant with one extra leg.
- _Hold and let the sender fix the bank details_ (rejected for now): better for the sender, but it needs a "held" state with a deadline and a recipient-edit flow, both out of scope.

## D8. The platform absorbs rate and network-fee changes after the quote

**Status**: Accepted

**Decision**: The recipient gets `receive` exactly. A different conversion rate is posted to `fx_variance` (MXN); a different chain fee to `network_fee_expense` (USD). The sender's numbers never change after confirm.

**Options considered**

- _Absorb_ (chosen): the peso amount on the confirm screen is the amount that lands. That's the promise the product makes.
- _Pass the difference on_ (rejected): the recipient gets an amount nobody agreed to.

## D9. "They receive" is the default mode

**Status**: Accepted

**Decision**: The new-payout form starts in receive mode. In receive mode the peso amount is exact and the dollar side rounds up.

**Options considered**: see [mockup DECISIONS](design/mockup/DECISIONS.md#why-they-receive-is-the-default). A supplier invoices in pesos.

## D10. Custodial wallets

**Status**: Accepted

**Decision**: The platform holds the treasury wallet and signs every hop-2 transfer server side. The sender never signs or sees a wallet. See PLAN §15.

**Options considered**

- _Custodial_ (chosen): the sender isn't a crypto user.
- _Self-custodial_ (rejected): adds a signature step and a timeout that ends in a refund.

## D11. Two-layer CSS tokens in the web app

**Status**: Accepted

**Decision**: Primitives in `styles/tokens/primitives.css`, roles for light and dark in `styles/tokens/roles.css`, CSS Modules for components, no CSS framework. Fonts self-hosted with `@fontsource`. Enforced by `check-tokens.mjs` and `tokens.test.ts`. See PLAN §14.

**Options considered**

- _Plain CSS variables_ (chosen): the mockup already uses them; no build step to learn.
- _A utility CSS framework_ (rejected): a second home for every value.
- _A `packages/tokens` package_ (deferred): one consumer today. Moves there with no renames if a second one shows up.

## D12. Simulation and server visibility live on `/ops`

**Status**: Accepted

**Decision**: A separate route shows the server log, summary, stuck legs, reconciliation, a payout inspector and the config, and holds every simulation control. The sender's screens have none. See PLAN §13.

**Options considered**

- _A separate route_ (chosen): the sender's screens stay what a real user would see; the person forcing failures can use a second screen.
- _A rail beside the app, as in the mockup_ (rejected for the app): the mockup only does it because it's one file.

## D13. Path routing with no router library

**Status**: Accepted

**Decision**: Four routes (`/`, `/new`, `/payouts/:id`, `/ops`), matched on `location.pathname` by a small `useRoute()` hook over the History API. nginx falls back to `index.html`.

**Options considered**

- _Own 30-line router_ (chosen): four routes, no nested layouts, no loaders.
- _Hash routes_ (rejected): `/ops` should be a plain URL someone can type.
- _A router library_ (rejected): more surface than the app needs.

## D14. pnpm `allowBuilds` for better-sqlite3 and esbuild

**Status**: Accepted

**Decision**: Set `allowBuilds.better-sqlite3: true` and `allowBuilds.esbuild: true` in `pnpm-workspace.yaml`. Phase 1's brief said `better-sqlite3: false`; under pnpm 11 that skips the package's install script entirely, so no `.node` binding is present and the API cannot open a database. With `true`, `prebuild-install` downloads a platform binary (it does not fall through to node-gyp when a prebuild exists). `esbuild` must also be allowed or Vite's binary is missing.

**Options considered**

- _`allowBuilds: true` for both_ (chosen): install scripts run; bindings exist locally and in `node:24-slim`.
- _`better-sqlite3: false` as the brief said_ (rejected): no native binding after `pnpm install`.
- _Commit a vendored `.node` file_ (rejected): platform-specific and brittle.

**Consequences**: AGENTS.md matches this. If a platform has no prebuild, install will try node-gyp and may fail in slim images — revisit then.

## D15. Idempotency body hash is canonical JSON (sorted keys)

**Status**: Accepted

**Decision**: `POST /payouts` hashes the validated body with SHA-256 over `JSON.stringify` of recursively key-sorted objects (`apps/api/src/util/canonical-json.ts`). Key order in the raw request must not change the hash.

**Options considered**

- _Sorted-key canonical JSON_ (chosen): stable across clients that reorder fields.
- _Raw request bytes_ (rejected): same object, different whitespace or key order, would 409.

## D16. Recipients expose `city`; column added to the schema

**Status**: Accepted

**Decision**: Phase 2's `GET /recipients` returns `city`. PLAN §6's recipients table omitted it; the seed cities (Monterrey, Guadalajara, Veracruz) are stored in a `city` column and returned in the shared `RecipientSchema`.

## D17. Idempotent payout replay answers 200

**Status**: Accepted

**Decision**: The first successful `POST /payouts` stores `response_status = 201`. A later request with the same key and body hash returns **200** with that stored body (PLAN §7: "201 created; 200 replay"), not 201 again.

## D18. Outbox `due_at` and resend-safe collect transition

**Status**: Accepted

**Decision**: Scheduled outbox work uses a nullable `due_at` column (`NULL` = due now). On `ProviderTimeout` the original request row is marked sent, the leg goes to `checking`, and a `status.query` row is inserted with `due_at = now + STATUS_BACKOFF_MS[0]`. Later queries walk the backoff list; after `PROVIDER_WINDOW_MS` with `not_found`, a new `*.request` is inserted with the same `provider_ref`. Accepting a `collect.request` transitions `created → collecting` only when the payout is still `created`, so a timeout-then-resend path does not attempt an illegal `collecting → collecting`.

**Options considered**

- _`due_at` on the outbox row_ (chosen): one poll query; no separate scheduler table.
- _Always transition on accept_ (rejected): resend after a timeout would throw `IllegalTransition` and leave the hop stuck.
- _In-memory timers only_ (rejected): a restart would lose the next query time (breaks H11 for checking legs).

## D19. In-process webhook delivery and network-fee constants

**Status**: Accepted

**Decision**: Simulator providers post events with `app.inject` to `/webhooks/:provider` (same validation, inbox, machine and ledger as an external caller). Chain fee estimate and actual are `NETWORK_FEE_ESTIMATE_MINOR = 25` and `NETWORK_FEE_ACTUAL_MINOR = 40` in `providers/sim/chain.ts`; the `final` event carries the actual in `detail.networkFeeMinor`, and `onTransferFinal` posts that amount (skipping the fee legs when 0).

**Options considered**

- _`app.inject`_ (chosen): one code path for webhooks; tests and compose share behaviour.
- _Direct `applyProviderEvent` from the sim_ (rejected): bypasses inbox dedupe and HTTP validation.
- _Fee hardcoded only in postings_ (rejected): reconciliation and P2 need the sim record and the ledger to share the same actual.

## D20. Ops speed control and scrollable logs

**Status**: Accepted

**Decision**: `/ops` speed is a `<fieldset>` of `aria-pressed` buttons (accent-soft when pressed), not `Button variant="primary"`. Ops log `<pre>` panels grow with the page (no inner scroll). Support details on the payout screen use `Button variant="link"`.

**Options considered**

- _Pressed fieldset for speed_ (chosen): matches ThemeSwitch / Segmented; axe S6 stays green in light and dark.
- _Primary fill for the active speed_ (rejected): Chromium/axe reported surface behind white `on-accent` text even when the painted pixels were indigo.
- _No inner scroll on logs_ (chosen): avoids axe `scrollable-region-focusable` vs Biome `noNoninteractiveTabindex` on a focusable `<pre>`.

## D21. What PLAN §16 skipped, and why it stays skipped

**Status**: Accepted

**Decision**: The items under PLAN §16 "Skipped, and why" stay out of scope for this sample. Recorded here so a later reader does not treat them as unfinished work.

**Options considered**

- _Auth and multiple businesses_ (skipped): one sender keeps the focus on the money path. `X-Account-Id` marks where auth would go.
- _Adding and editing recipients_ (skipped): bank-detail validation is its own problem; seeds are enough to trigger hop 3's rejection.
- _Real providers and a real chain_ (skipped): the simulator can fail on demand; a live chain cannot.
- _Compliance (KYC, sanctions, daily limits)_ (skipped): required in production; it would sit before `collecting` and drown the payout story.
- _Fix bank details and retry instead of refunding_ (skipped): needs a held state with a deadline; the refund path keeps the invariant simpler.
- _Postgres_ (skipped): SQLite gives transactions and unique constraints in one file; the schema stays portable (see D2).

## D22. Idempotent SQLite column migrations

**Status**: Accepted

**Decision**: After `schema.sql` runs, `migrate(db)` adds any columns that older compose volumes lack (`recipients.city`, `outbox.due_at`) and backfills seed cities when blank. `CREATE TABLE IF NOT EXISTS` alone is not enough for additive columns on a persisted file DB.

**Options considered**

- _Idempotent `ALTER TABLE … ADD COLUMN`_ (chosen): keeps existing payout history on the volume; one test covers each column.
- _Wipe the compose volume on every upgrade_ (rejected): surprising for a sample someone leaves running.
- _A versioned migration framework_ (rejected): two columns do not justify the machinery.

## D23. SSE via fetch, and closing streams on read outage

**Status**: Accepted

**Decision**: Timeline and `/ops` live updates use `GET …/stream` as server-sent events. The client opens the stream with `fetch` (not `EventSource`) so it can send `X-Account-Id`. On stream error it falls back to the existing 2s poll. While `client.readsFail` is on, stream ticks emit an `error` event and close the connection so the offline strip still shows the last confirmed time (S2); new stream opens get 503 the same as `GET /payouts*`.

**Options considered**

- _`fetch` + stream reader_ (chosen): same auth header as every other call.
- _Browser `EventSource`_ (rejected): cannot set custom headers.
- _Leave open streams running under `client.readsFail`_ (rejected): S2 never shows offline while SSE stays preferred.

## D24. Webhook HMAC over raw body

**Status**: Accepted

**Decision**: Webhooks are authenticated with HMAC-SHA256 of `` `${timestamp}.${rawBody}` ``, hex-encoded in the `Signature` header, with unix-seconds `Timestamp`. Tolerance is 5 minutes against the injectable clock. The JSON content-type parser stores the exact request string as `rawBody` before `JSON.parse`. `/ops/config` exposes only a masked form of `WEBHOOK_SECRET`. Inbox dedupe still applies after a valid signature (replay ≠ re-apply).

**Options considered**

- _Raw body HMAC_ (chosen): matches what providers sign on the wire.
- _Canonical JSON of the parsed object_ (rejected): whitespace and key order would invalidate honest signatures.
- _Skip signing in tests_ (rejected): the sim and tests share the same signed path.

## D25. Ops support actions never move money

**Status**: Accepted

**Decision**: "Re-run status query" only inserts a due-now `status.query` outbox row for a leg already in `checking`. "Flag for review" only sets `payouts.flagged_at` (idempotent). Both record an `api` ops event. Neither transitions the payout, mutates legs, or posts ledger entries. Stuck rows expose `flagged` for the badge.

**Options considered**

- _Outbox-only re-query_ (chosen): reuses the worker's getStatus path; no second code path into providers from HTTP.
- _Call getStatus inside the request_ (rejected): providers are never called from request handlers.
- _A separate flagged table_ (rejected): one nullable column is enough for this sample.

## D26. Testnet lookup is opt-in and keyless

**Status**: Accepted

**Decision**: Support-details network lookup uses public JSON-RPC (`eth_getTransactionByHash`) behind `TESTNET_LOOKUP_ENABLED` (default false). No explorer API keys. Unit tests inject a recorded response; CI never contacts a remote host.

**Options considered**

- _Public RPC, no keys_ (chosen): matches "display only" and the no-keys constraint.
- _Etherscan-style API_ (rejected): needs a key.
- _Always-on live fetch in tests_ (rejected): flakes and violates the no-network-in-CI rule.

## D27. Second chain is a Provider swap only

**Status**: Accepted

**Decision**: `CHAIN_PROVIDER=alt` wires `createAltChainProvider` (same `Provider` contract, distinct hash prefix). Selection happens in `createSimBundle` / `server.ts`. `payouts/` and `ledger/` do not import either chain module.

**Options considered**

- _Config-selected Provider at the seam_ (chosen): proves hop 2 is swappable without touching money paths.
- _If/else inside payouts or the worker_ (rejected): would couple domain code to a vendor.

## D28. Screenshot baselines mask clock-owned pixels

**Status**: Accepted

**Decision**: N7 screenshots use fixed amounts and themes, with Playwright masks over hold countdown, timeline timestamps, monospace ids, and ops `<pre>` panels. Darwin and Linux baselines are both committed because Chromium paints differ by OS. Update snapshots only on purpose (`--update-snapshots`).

**Options considered**

- _Mask dynamic regions_ (chosen): e2e keeps a real system clock; no second fake-clock path in `server.ts`.
- _Fake clock in the e2e API process_ (rejected): larger surface for a sample that already masks those pixels.
