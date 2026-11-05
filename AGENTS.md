# AGENTS.md

A small app that pays a supplier abroad: dollars collected, moved as a dollar stablecoin, paid out as pesos. `apps/api` (Fastify + SQLite), `apps/web` (Vite + React), `packages/shared` (Zod contracts both import). Vocabulary is in [CONTEXT.md](CONTEXT.md).

## Read before you start

1. [README.md](README.md): the invariant and the H1 to H12 list.
2. [docs/PLAN.md](docs/PLAN.md): the spec. States, tables, endpoints, money rules, ledger postings, simulator switches, fixed values (§19).
3. [docs/phases/](docs/phases/README.md): one brief per phase. Work one phase at a time, in order.
4. [docs/design/mockup/index.html](docs/design/mockup/index.html), opened in a browser, and its [DECISIONS.md](docs/design/mockup/DECISIONS.md): what every screen shows and says. Colour, type and the app shell follow the Harbor direction ([D30](docs/DECISIONS.md#d30-harbor-visual-direction), [docs/design/directions/](docs/design/directions/index.html)); the token values live in `apps/web/src/styles/tokens/`.
5. [docs/DECISIONS.md](docs/DECISIONS.md): choices already made. Don't reopen one without writing a new entry that supersedes it.

When two documents disagree, PLAN wins over the mockup, and a phase brief wins over PLAN only where it says so explicitly. If something is still ambiguous, pick the reading that keeps the invariant, record it as a "Proposed" entry in `docs/DECISIONS.md`, and carry on.

## Before you finish a change

```bash
pnpm verify   # biome check, tsc in every package, vitest in every package, token checks
```

From Phase 5 on, also `pnpm test:e2e`. CI runs both on every pull request. The pre-commit hook refuses unformatted staged files; fix with `pnpm format`, never with `--no-verify`.

A phase is done when its gate in the brief passes on fresh output from these commands. Paste the output summary into `docs/PROCESS.md` for that phase. Don't mark a gate passed from reading the code.

## When touching money

- Integer minor units everywhere (`...Minor`, `*_minor`): schema, column, client state. A rate is an integer scaled by 10^4 (`rateE4`). Never a float, never a formatted string until it's rendered.
- All pricing goes through `packages/shared/src/money.ts`. No second copy of the fee or rounding rule anywhere.
- The four amounts (`send`, `fee`, `convert`, `receive`) are frozen on the payout at confirm. Nothing downstream recomputes them.
- Balances are sums of `ledger_entries`. Never add a balance column.
- Every ledger journal sums to zero per currency. Post entries only through `ledger/post.ts`, which checks this and throws.

## When adding or changing a field

Change the Zod schema in `packages/shared` first and infer the type from it. Never hand-write a type the schema already describes. Validate every request body, query and webhook at the edge.

## When changing a payout or a leg

- Every transition goes through the table in `apps/api/src/payouts/machine.ts`. A transition not in the table is refused, logged as an `ops_events` row of kind `state`, and counted on `/ops`.
- Webhooks change a leg. Only the state machine changes the payout.
- A state change, its ledger entries, its next outbox row and its `ops_events` row are written in one SQLite transaction. No provider is ever called inside a transaction or inside a request handler.
- A provider call with an unknown outcome sets the leg to `checking`. The next step is `getStatus(provider_ref)`. Never resend with a new reference, never mark failed on a guess.

## When confirming a payout

`POST /payouts` needs an `Idempotency-Key`. The client generates it once when a quote arrives and reuses it for every retry of that confirm. Same key and same body replays the stored response; same key and a different body is 409. Don't generate a new key on retry; that's how money moves twice.

## When touching the UI

- Components use role tokens only (`var(--surface)`, `var(--danger)`). No hex, `rgb()` or `hsl()` outside `apps/web/src/styles/tokens/`, and no `var(--p-…)` outside `roles.css`. `scripts/check-tokens.mjs` enforces it.
- A new colour need is a new role, defined for light and dark in the same change, with its contrast pair added to `tokens.test.ts`.
- Payout state → tone goes through `state/tone.ts`. A component never picks a colour from a state name.
- Copy comes from the mockup. Don't invent new wording for a state; if one is missing, add it to the mockup's DECISIONS first.
- The sender's screens have no simulation controls. Those live on `/ops` only.

## When logging

No full bank account numbers, wallet secrets or keys in logs, `ops_events` or API responses. Masked values only. The logger redacts `bankAccountToken`; keep the test that asserts it.

## When running the code

- Node runs the API's TypeScript directly (type stripping), so source must stay erasable: no `enum`, no `namespace`, no parameter properties. Relative imports keep their `.ts` extension.
- `better-sqlite3` loads a prebuilt binary via its install script (`prebuild-install`). In pnpm 11 that script only runs when `allowBuilds.better-sqlite3` is `true` in `pnpm-workspace.yaml`; `false` leaves no `.node` file at all. The script downloads a prebuild rather than compiling with node-gyp.
- Tests use an in-memory SQLite database and an injected clock (`now()` from `apps/api/src/clock.ts`). Never call `Date.now()` directly in API code, and never sleep in a test to wait for a quote to expire.

## Commits

One phase per branch or per series of commits, small commits inside it. Conventional prefixes (`feat:`, `fix:`, `test:`, `docs:`, `chore:`). Each commit leaves `pnpm verify` green.
