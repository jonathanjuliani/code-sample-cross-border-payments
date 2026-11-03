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
