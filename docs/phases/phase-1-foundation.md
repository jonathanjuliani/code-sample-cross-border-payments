# Phase 1: Foundation

**Goal**: an empty repo becomes a pnpm workspace that builds, tests, runs in `docker compose`, and already enforces the money rules and the token rules.

**Read first**: PLAN §4 (stack and shape), §8 (money rules), §14 (design system), §19 (fixed values). Mockup DECISIONS § Tokens. AGENTS.md "When running the code".

**Start state**: the docs and the mockup only, committed on `main` as Phase 0.

## Build, in this order

### 1. Workspace

- `package.json` at the root: `"type": "module"`, `packageManager` (pnpm 11), `engines.node` `^24.0.0`, scripts:
  - `dev`, `build`, `start` (parallel over `./apps/*`)
  - `test` (`pnpm -r test`), `typecheck` (`pnpm -r typecheck`), `lint` (`biome check .`), `format` (`biome check --write .`)
  - `check:tokens` (`node scripts/check-tokens.mjs`)
  - `verify`: `pnpm lint && pnpm check:tokens && pnpm typecheck && pnpm test`
  - `test:e2e` (`playwright test`), `prepare` (sets `core.hooksPath` to `.githooks`)
- `pnpm-workspace.yaml`: `apps/*`, `packages/*`, and `allowBuilds: { better-sqlite3: false }`.
- `.nvmrc` (`24`), `tsconfig.base.json` (strict, `erasableSyntaxOnly`, `verbatimModuleSyntax`, `allowImportingTsExtensions`, `noEmit`), `biome.json`, `.gitignore` (`node_modules`, `dist`, `data`, `test-results`, `playwright-report`).
- `.githooks/pre-commit`: `pnpm exec biome check --staged --no-errors-on-unmatched --files-ignore-unknown=true`.
- `.github/workflows/ci.yml`: job `verify` (install with `--frozen-lockfile`, `pnpm verify`) and job `e2e` (installs Playwright Chromium, `pnpm test:e2e`). The e2e job may be a placeholder that passes with zero tests until Phase 5.

### 2. `packages/shared`

- `src/money.ts`: the constants from §19 Money, `priceFromSend(sendMinor, rateE4)`, `priceFromReceive(receiveMinor, rateE4)`, `inLimits(sendMinor)`, `formatMinor(minor, currency)` (for display only). Integer arithmetic only; use `BigInt` inside a function if an intermediate could pass `Number.MAX_SAFE_INTEGER`.
- `src/quote.ts`, `src/payout.ts`, `src/events.ts`, `src/ops.ts`: Zod schemas for every request and response body in PLAN §7, with the types inferred. `PayoutStatus`, `LegName`, `LegStatus` as `z.enum` (not TS `enum`). Simulation flags schema with every switch in §11 and `speed: 1 | 3 | 10`; unknown keys rejected (`.strict()`).
- `src/index.ts` re-exports.
- `test/money.test.ts`: the cases listed in §19 Money, including a property-style loop over a few thousand amounts and rates (plain loop with a seeded generator; no extra dependency).
- `test/contracts.test.ts`: each schema accepts the example in PLAN and rejects a float amount, a negative amount and an unknown simulation switch.

### 3. `apps/api` skeleton

- Fastify app factory `src/app.ts` (`buildApp({ db, clock, config })`), `src/server.ts` (reads `config.ts`, opens the DB, listens on `PORT`).
- `src/config.ts`: every env var in §19 parsed with Zod, defaults from the table.
- `src/clock.ts`: `now()` that tests can replace (`createFakeClock(start)` with `advance(ms)`).
- `src/db/open.ts`: opens `better-sqlite3`, `journal_mode = WAL`, `foreign_keys = ON`, runs `src/db/schema.sql` (every table in PLAN §6, with the `CHECK` on payout `status` and leg `status`, unique `quotes.payout_id`, unique `payouts.quote_id`, primary keys as listed).
- `GET /health` → `{ ok: true, version }`.
- `X-Account-Id` hook: 401 `unknown_account` unless it equals `ACCOUNT_ID`. `/health`, `/webhooks/*` and `/ops/*` are exempt.
- Logger: pino with `redact: ['*.bankAccountToken', 'req.headers["idempotency-key"]']`.
- `seed/seed.ts`: recipients and the funding account from §19 Seed data. The two delivered history payouts are added in Phase 3, once the ledger exists. Leave a `TODO(phase-3)` comment.
- `test/health.test.ts` using `app.inject`.
- `Dockerfile` (node:24-slim, `pnpm install --frozen-lockfile --prod=false`, runs `node apps/api/src/server.ts`).

### 4. `apps/web` skeleton

- Vite + React + TypeScript. `vite.config.ts` with the `/api` proxy from §19.
- `src/styles/tokens/primitives.css` and `roles.css`: copy the primitive and role blocks from the mockup's `<style>`, light and both dark selectors, unchanged values.
- `src/styles/base.css`: reset, body type, focus ring, `tabular-nums` on `.money`.
- `src/styles/fonts.ts`: imports `@fontsource-variable/figtree` and `@fontsource/jetbrains-mono/400.css` and `500.css`.
- `index.html`: the inline theme script from PLAN §14 (reads `localStorage` in `try`, sets `data-theme`), a `preload` link for the Figtree file.
- `src/main.tsx` renders a placeholder page head ("Payouts") using role tokens, so the font and theme load are visible.
- `test/tokens.test.ts`: parses both CSS files, resolves every role in light and in dark, and asserts the text pairs at ≥ 4.5:1 and the line pairs at ≥ 3:1, using the pair list in mockup DECISIONS § Colour roles. Write a small `contrast(hexA, hexB)` helper; no dependency.
- `Dockerfile` (build with Vite, serve `dist` with nginx) and `nginx.conf` (`/api/` proxied to `http://api:3000/`, `try_files $uri /index.html`).

### 5. Token check

- `scripts/check-tokens.mjs`: fails on a hex, `rgb(`, `rgba(`, `hsl(` in `apps/web/src/**/*.{css,ts,tsx}` outside `styles/tokens/`, and on `var(--p-` outside `styles/tokens/roles.css`. Prints file and line.

### 6. Compose

- `docker-compose.yml`: `api` (env `OPS_ENABLED=true`, `DB_PATH=/data/payouts.db`, volume `payout-data:/data`, healthcheck on `/health`, `restart: unless-stopped`) and `web` (port `${WEB_PORT:-8801}:80`, depends on `api` healthy).

## Tests this phase adds

- `money.test.ts`: send mode minimum fee, percentage fee, receive mode exact pesos, limits at both edges, the property loop. Titles start `T1:` where they prove no float is involved.
- `contracts.test.ts`.
- `health.test.ts`.
- `tokens.test.ts`: `S6: every text pair passes AA in light`, `… in dark`.

## Gate

```bash
pnpm install
pnpm verify
docker compose up -d --build && curl -fsS localhost:8801/api/health && docker compose down
```

All three succeed. `pnpm check:tokens` fails if you add `color: #fff` to `main.tsx` (try it, then remove it).

## Write down

PROCESS: Phase 1 entry with the gate output. DECISIONS: only if a tool version or config forced a choice.

## Out of scope

Any endpoint besides `/health`. Any screen. The ledger.
