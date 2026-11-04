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
