# Process

How this goes from an empty folder to a working app, one entry per phase, written as I go.

## Phase 0: design and plan

**Design and plan**

- I designed the app first, as a single static HTML mockup with a simulation rail that forces every provider behaviour (`docs/design/mockup/`). The mockup carries a small fake server, a webhook intake with dedupe and ordering, and a per-payout ledger, so the state model ran on screen before it was written down.
- The invariant and the H1 to H12 list are in the README.
- The full handoff is in [PLAN.md](PLAN.md): states, tables, endpoints, money rules, ledger postings, simulator switches, phases, the done list and every fixed value (§19).
- Each phase has its own brief in [phases/](phases/README.md), with files to build, named tests and a gate. Rules for every change are in [AGENTS.md](../AGENTS.md), vocabulary in [CONTEXT.md](../CONTEXT.md), and the choices made so far in [DECISIONS.md](DECISIONS.md) (D1 to D13).
- Assumptions: one sender, one USD → MXN corridor, seeded recipients, custodial wallets, a 60-second quote on the server clock, no auth.

**Found while building the mockup**

- "They receive" has to be the default. A supplier invoices in pesos, and in receive mode the peso amount is exact by construction.
- A refunded payout can't keep saying "They receive 42,800.00 MXN". The label changes to "Not delivered. Quoted amount".
- Two confirms with the same key arriving at once must still make one payout. The key is stored in the same transaction that consumes the quote.

**Design system**

- The mockup moved onto a two-layer token system (primitives, then roles) with light and dark defined together. Every text pair was checked for contrast. Three base colours failed as small text, so they stay as lines and fills and a darker step carries the text. One amber was added so "checking" and "not sent" don't share a colour.
- Setting it up in the app (token files, self-hosted fonts, the theme script, a literal-colour check and a contrast test in `pnpm verify`) is in [PLAN § Design system](PLAN.md#14-design-system).

**Ops page**

- The simulation controls and the server log move to their own route, `/ops`, in the app. The sender's screens get no controls. The mockup keeps its rail beside the app only because it is one file. Details are in [PLAN § The /ops page](PLAN.md#13-the-ops-page).

**Stayed**

- The mockup, the plan, and a Fastify + SQLite + React stack in a pnpm workspace.

**Dropped**

- A separate review page between quote and confirm. It spent the quote's 60 seconds on navigation.

**Gate 0** (2026-11-03)

- The invariant and H1 to H12 are in the README before any app code. PLAN, DECISIONS (D1 to D13), AGENTS, CONTEXT and the seven phase briefs are written.
- Every relative link and section anchor in the markdown files resolves (a small script over all 16 files).
- The mockup, run in a browser at 10× speed, with Confirm sent twice with the same key on every payout:

  | Scenario                 | Final state | Payouts per quote | Second confirm | Ledger      |
  | ------------------------ | ----------- | ----------------- | -------------- | ----------- |
  | Everything works         | delivered   | 1                 | 200 replay     | sums to zero |
  | Slow providers           | delivered   | 1                 | 200 replay     | sums to zero |
  | Hop 1 declines           | failed      | 1                 | 200 replay     | sums to zero |
  | Hop 2 times out          | delivered   | 1                 | 200 replay     | sums to zero |
  | Hop 2 reorg              | delivered   | 1                 | 200 replay     | sums to zero |
  | Hop 3 rejects bank details | refunded  | 1                 | 200 replay     | sums to zero |
  | Duplicate webhook        | delivered   | 1                 | 200 replay     | sums to zero |
  | Out-of-order webhook     | delivered   | 1                 | 200 replay     | sums to zero |
  | Rate moved 2%            | delivered   | 1                 | 200 replay     | sums to zero |

  Every delivered payout landed exactly 42,800.00 MXN. An expired quote answered 410 `quote_expired`; a used quote with a new key answered 409 `quote_used`.
- Next: [Phase 1](phases/phase-1-foundation.md).

## Phase 1: foundation

**Built**

- pnpm workspace (`apps/api`, `apps/web`, `packages/shared`), Biome, Vitest, Playwright config (no e2e yet), `.githooks`, CI workflow.
- `packages/shared`: money constants and pricing (`priceFromSend` / `priceFromReceive`), Zod contracts for quotes, payouts, webhooks, ops/simulation flags.
- `apps/api`: Fastify factory, Zod config, injectable clock, SQLite schema for every PLAN §6 table, seed recipients + funding account mask, `GET /health`, `X-Account-Id` hook.
- `apps/web`: Vite + React placeholder "Payouts" page head, two-layer tokens copied from the mockup, self-hosted Figtree + JetBrains Mono, theme boot script, `check-tokens.mjs`, contrast tests.
- `docker-compose.yml` with healthy API and nginx web proxying `/api/` → API.

**Found**

- pnpm 11 ignores dependency install scripts until listed under `allowBuilds`. Setting `better-sqlite3: false` (as the brief first said) leaves no native binding; `true` runs `prebuild-install` and works in `node:24-slim`. Recorded as [D14](DECISIONS.md#d14-pnpm-allowbuilds-for-better-sqlite3-and-esbuild).
- Dark `border-strong` on `surface` is ~1.9:1; DECISIONS only claims 3.3:1 for light. Token tests assert dark line contrast on `success-line`, `danger-line`, and `rule-heavy` instead.
- Root `prepare` must tolerate a missing `git` binary so Docker builds don't fail.

**Dropped**

- Nothing from the Phase 1 brief. History payouts `PO-1039`/`PO-1040` left as `TODO(phase-3)` in the seed.

**Gate 1** (2026-11-03)

- `pnpm verify`: Biome clean; `check-tokens: ok`; typecheck green in shared/api/web; 23 tests passed (shared 17, api 2, web 4).
- `pnpm check:tokens` failed on a deliberate `color: #fff` in `app.module.css`, then passed after removal.
- `docker compose up -d --build` → `curl -fsS localhost:8801/api/health` → `{"ok":true,"version":"0.1.0"}` → `docker compose down`.
- Next: [Phase 2](phases/phase-2-quotes-payouts.md).

## Phase 2: quotes and payouts

**Built**

- `ops/events.ts` writing `ops_events` inside the caller's transaction (trim last 5,000).
- `GET /recipients` (with `city`), `POST /quotes` (pricing, limits, TTL), `expireDue` on confirm and a 5s timer.
- Payout state machine (`machine.ts`) from PLAN §5; refuses illegal transitions and logs them.
- `POST /payouts` with UUID idempotency, canonical-JSON body hash, quote consume + four legs + `collect.request` outbox in one transaction; payout stays `created` until Phase 3.
- `GET /payouts`, `GET /payouts/:id`, `GET /payouts?idempotencyKey=`.

**Found**

- Replay must answer **200** while the stored create status is 201 (D17).
- Recipients need a `city` column for the Phase 2 response shape (D16).
- Body hash needs sorted-key canonical JSON so key order can't 409 (D15).

**Dropped**

- Nothing from the brief. Worker / ledger / webhooks still Phase 3.

**Gate 2** (2026-11-03)

- `pnpm verify` green. Totals: shared 17, api 22 (health 2, quotes 5, payouts.create 11, machine 4), web 4.
- `grep -r "Date.now" apps/api/src` → none (clock only).
- Next: [Phase 3](phases/phase-3-ledger-outbox-webhooks.md).

## Phase 3: ledger, outbox worker, webhooks

**Built**

- Ledger: `postJournal` / signed helper, PLAN §9 + §19 postings, balance and journal-sum queries, `GET /payouts/:id/ledger`, `assertBalanced`.
- Provider seam (`Provider`, `ProviderTimeout`, instant/decline/timeout test doubles). Real simulator is Phase 4.
- Outbox worker with `tickOnce` / `stop`, `due_at` scheduling, status-query backoff, same-`provider_ref` resend after the provider window, give-up after `CHECKING_GIVE_UP_MS`.
- Webhook intake: inbox dedupe, stale `seq`, leg update + machine transition + journal + next-hop outbox in one transaction.
- Seed history `PO-1039` / `PO-1040` with legs and journals via postings.

**Found**

- Accepting a `collect.request` must only transition `created → collecting` when the payout is still `created`, so a timeout-then-resend does not try `collecting → collecting` ([D18](DECISIONS.md#d18-outbox-due_at-and-resend-safe-collect-transition)).
- Timeout test doubles wrap an underlying provider so the first attempt still records the `provider_ref` used on resend (T4).

**Dropped**

- Nothing from the brief. Simulator switches and `/ops/*` remain Phase 4.

**Gate 3** (2026-11-03)

- `pnpm verify` green. Totals: shared 17, api 38 (health 2, quotes 5, payouts.create 11, machine 4, ledger 5, worker 5, webhooks 6), web 4.
- Next: [Phase 4](phases/phase-4-simulator-ops-api.md).

## Phase 4: provider simulator and /ops API

**Built**

- In-memory simulation flags (`SIM_FLAGS`, `PUT /ops/simulation`), injectable `simDelay` scheduler.
- Collect / chain / offramp fakes: dedupe on `provider_ref`, in-process webhook delivery via `app.inject`, every §11 switch.
- Network fee constants on the chain (`ESTIMATE` 25 / `ACTUAL` 40); `onTransferFinal` posts the actual (0 when absent).
- `/ops/*` when `OPS_ENABLED` (summary, events, inspector, config, simulation, expire-in), `GET /reconciliation`, per-leg `slow` on payout reads, `client.readsFail` → 503.

**Found**

- Simulator webhooks must go through the real Fastify stack (`app.inject`) so inbox dedupe and the state machine stay on the same path as production ([D19](DECISIONS.md#d19-in-process-webhook-delivery-and-network-fee-constants)).
- `crash.afterCommit` is one-shot: consume the flag, stop the worker (tests) or exit 1 (compose restart).

**Dropped**

- Nothing from the brief. UI for `/ops` is Phase 5.

**Gate 4** (2026-11-03)

- `pnpm verify` green. Totals: shared 17, api 60 (scenarios 13, ops 8, reconciliation 1, prior 38), web 4.
- `docker compose up -d --build` then `PUT /api/ops/simulation` with `deposit.rejectBank` → 200; `docker compose down`.
- Next: [Phase 5](phases/phase-5-client-ops-page.md).

## Phase 5: client and /ops page

**Built**

- Client plumbing: `request` + shared Zod schemas, path router (`/`, `/new`, `/payouts/:id`, `/ops`), `usePoll` with back-off and `lastConfirmedAt`, `tone` map, new-payout reducer with idempotency key on quote.
- UI primitives from PLAN §14 (role tokens only) and the three sender screens plus `/ops` (Simulation, Summary, Stuck, Server log, Reconciliation, Config).
- Playwright e2e: confirm (H1/H2/S4), timeline (happy/H4/H6/H9/S2/T7), ops (S5/S8), a11y (S6 light+dark, tabular figures, localhost-only, 375 px).

**Found**

- Speed on `/ops` is a pressed fieldset, not a primary `Button`: a selected primary fill confused axe's contrast sampling even when pixels were correct ([D20](DECISIONS.md#d20-ops-speed-control-and-scrollable-logs)).
- Ops log panels grow with the page instead of an inner scroll (axe vs Biome on focusable `<pre>`).
- Support details must not use the bare `.label` class on a `<button>` (UA button face + `--text-subtle` fails dark contrast); use `Button variant="link"`.
- `ThemeSwitch` applies the stored theme on mount, not only on click.

**Dropped**

- Nothing from the brief. SSE, screenshot tests and support actions stay nice-to-haves.

**Gate 5** (2026-11-03)

- `pnpm verify` green. Totals: shared 17, api 60, web 7 (tokens 4, tone 2, amountField 1).
- `pnpm test:e2e` → 17 passed.
- Next: [Phase 6](phases/phase-6-reconciliation-docs.md).

## Phase 6: reconciliation, run steps, coverage

**Built**

- [README](../README.md) run / develop / try-the-failures sections; H table links into coverage.
- [COVERAGE.md](COVERAGE.md): every H, S, P, T, N id with status, evidence and how to see it (from `pnpm verify` + `pnpm test:e2e` on 2026-11-03, Node 24.21.0).
- DECISIONS: D14–D20 Accepted; [D21](DECISIONS.md#d21-what-plan-16-skipped-and-why-it-stays-skipped) for PLAN §16 skipped items; [D22](DECISIONS.md#d22-idempotent-sqlite-column-migrations) for volume-safe column adds. PLAN §18 checklist ticked with evidence.
- `apps/api/src/db/migrate.ts`: add `recipients.city` and `outbox.due_at` when missing on an existing file DB.

**Found**

- S8 e2e was flaky when Confirm locked before a second click; the test now replays the stored key through the API so the ops log always records `idempotent replay`.
- A persisted Compose volume from before D16/D18 lacked `city` and `due_at`; `CREATE TABLE IF NOT EXISTS` never alters. Migration added and tested.

**Fresh-clone run** (2026-11-03)

- `docker compose up --build` → web + ops at `:8801`, API healthy.
- Every §11 switch that ends a payout, forced via the same API `/ops` uses, on that stack:

  | Switch | Final state | Ledger Σ/currency |
  | --- | --- | --- |
  | `collect.decline` | failed | 0 |
  | `deposit.rejectBank` | refunded | 0 |
  | `rate.move` | delivered | 0 |
  | `webhook.duplicate` | delivered | 0 |
  | `webhook.outOfOrder` | delivered | 0 |
  | `transfer.timeout` | delivered | 0 |
  | `transfer.timeoutLost` | delivered | 0 |
  | `transfer.reorg` | delivered | 0 |
  | `slow` | delivered | 0 |
  | `client.readsFail` | GET /payouts → 503 | — |
  | `crash.afterCommit` | covered by scenarios H11 | — |

**Gate 6** (2026-11-03)

- `pnpm verify` and `pnpm test:e2e` green after the migration + docs pass.
- Next: [Phase 7](phases/phase-7-nice-to-haves.md) only if an N item is pulled in.

## Phase 7 / N1: server-sent events

**Built**

- `GET /payouts/:id/stream` and `GET /ops/stream` as `text/event-stream` via `reply.hijack()` (`apps/api/src/http/sse.ts`). Header `x-sse-once: 1` ends after the first payload for unit tests.
- Client `openSse` uses `fetch` + `ReadableStream` so `X-Account-Id` can be sent (browser `EventSource` cannot). `useLivePayout` / `useLiveOps` prefer the stream and fall back to the existing poll path on error or an `error` event.
- Open streams close when `client.readsFail` is on, so the offline strip still appears (S2).
- e2e: timeline advances with polling GETs aborted; falls back when the stream closes.

**Found**

- Preferring SSE with `offline: false` forever hid S2 until the server closed live streams under `client.readsFail` ([D23](DECISIONS.md#d23-sse-via-fetch-and-closing-streams-on-read-outage)).

**Gate N1** (2026-11-04)

- `pnpm verify` green (api 64 including stream tests). `pnpm test:e2e` → 19 passed.
- Next: N2 (HMAC webhook signatures).

## Phase 7 / N2: signed webhooks

**Built**

- `WEBHOOK_SECRET` env (default `whsec_demo_sample`). `POST /webhooks/:provider` requires `Timestamp` (unix seconds) and `Signature` (HMAC-SHA256 hex of `timestamp.body`); rejects missing/bad signature or timestamps outside 5 minutes with 401.
- JSON parser keeps `rawBody` so the HMAC matches the bytes on the wire. Simulator `createInjectPoster` signs with the clock and secret. Masked secret on `GET /ops/config` (`webhookSecretMasked`).
- API tests: bad signature 401, stale timestamp 401, replay still deduped as duplicate.

**Found**

- Signing must use the exact request body string, not a re-serialized object ([D24](DECISIONS.md#d24-webhook-hmac-over-raw-body)).

**Gate N2** (2026-11-04)

- `pnpm verify` green (api 67). `pnpm test:e2e` → 19 passed.
- Next: N3 (ops support actions).

## Phase 7 / N3: ops support actions

**Built**

- `POST /ops/payouts/:id/status-query` queues a due-now `status.query` for a `checking` leg (409 otherwise). `POST /ops/payouts/:id/flag` sets `flagged_at` once. Neither changes payout status or ledger.
- Schema + migrate for `payouts.flagged_at`. Stuck summary includes `flagged`. `/ops` inspector panel with Load, Re-run status query, Flag for review; Stuck shows a Flagged badge.
- API tests for both actions; e2e that the button queues one query.

**Gate N3** (2026-11-04)

- `pnpm verify` green (api 70). `pnpm test:e2e` → 20 passed.
- Next: N4 already Handled via P4; N5 (testnet lookup) if pulled.
