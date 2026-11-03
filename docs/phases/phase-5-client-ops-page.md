# Phase 5: Components, the client and the /ops page

**Goal**: the sender's three screens and the `/ops` page, built on the token system and the components in PLAN §14, rendering only what the server says. The browser tests prove the cases a person can see.

**Read first**: the mockup in a browser, every scenario in its rail; mockup DECISIONS (all of it: structure, states on screen, recovery screens, timeline copy, tokens, state → role); PLAN §12, §13, §14, §19 Client timing. DECISIONS D9, D11, D12, D13. README H1, H2, H9; S1, S2, S3, S6; T7, T9.

**Start state**: Phase 4 gate green. `docker compose up` gives a working API with `/ops/*`.

## Build, in this order

### 1. Plumbing

- `src/state/api.ts`: one `request(path, init)` that adds `X-Account-Id`, parses with the shared Zod schemas, and returns `{ ok, data } | { ok: false, error, offline }`. No other file calls `fetch`.
- `src/state/route.ts`: `useRoute()` over `location.pathname` and `popstate`; `navigate(path)`. Routes: `/`, `/new`, `/payouts/:id`, `/ops`. Unknown path → list.
- `src/state/poll.ts`: `usePoll(fn, intervalMs, { while })` with the back-off from §19 and `lastConfirmedAt`.
- `src/state/tone.ts`: payout state and leg state → `'info' | 'success' | 'caution' | 'danger'`, exactly the mockup DECISIONS state → role table. Unit-tested against every enum value.
- `src/state/newPayout.ts`: a reducer for the new-payout screen (`editing → quoting → quoted → confirming → done | expired | error`), holding the quote, the idempotency key, and the confirm attempt count.

### 2. `ui/` components

Build each with a CSS Module, role tokens only, and a small test where it has logic. The list and props are in PLAN §14: `Button`, `Pill`, `Callout`, `Card`, `SectionHead`, `PageHead`, `SideNav`, `Timeline`, `KeyValue`, `Table`, `Segmented`, `AmountField`, `HoldBar`, `Money`, `Spinner`, `ThemeSwitch`. Match the mockup's markup and spacing; copy its CSS rules into the modules, swapping nothing but selectors.

- `Money` uses `formatMinor` from `packages/shared`. Never formats with floats.
- `AmountField` takes and emits minor units; it parses the typed string with integer maths.
- `HoldBar` takes `expiresAt`, `serverNow`, `receivedAt`, ticks every 250 ms, and announces 10 s left to screen readers once.
- `Callout` with `role="status"` or `role="alert"` by tone; the payout banner is `aria-live="polite"`.
- `ThemeSwitch` writes `data-theme` and `localStorage` inside `try`.

### 3. Screens

Copy, layout and states come from the mockup; don't reword.

- **`PayoutList`** (`/`): table of payouts, newest first, status pill, amounts, polling while any isn't final.
- **`NewPayout`** (`/new`): recipient cards, `Segmented` mode toggle defaulting to "They receive", `AmountField`, "See rate and fees". The `QuoteCard` shows both amounts, rate, fee, the hold bar and Confirm. Editing amount, mode or recipient drops the quote. Confirm:
  - creates the idempotency key when the quote arrives (`crypto.randomUUID()`), not on click;
  - locks on first click;
  - on a network error retries per §19 with the same key, then looks it up by key;
  - 410 → the expired callout, "Nothing was sent", and "Get a new rate", which shows the old and new numbers side by side;
  - 409 `quote_used` → navigates to the existing payout;
  - 422 / 400 → inline field error with the limits.
- **`PayoutDetail`** (`/payouts/:id`): page head with the status, the banner callout for the current state, the `Timeline` built from legs exactly as the mockup's timeline copy, the amounts block (with the "Not delivered. Quoted amount" label on `refunded` and "Not sent. Quoted amount" on `failed`), and a collapsed "Support details" with provider refs and the network reference. The words "stablecoin", "DUSD", "chain" and "wallet" appear only inside support details (T9). An offline strip with "Last confirmed …" when polling fails (S2). "Taking longer than usual. Nothing is wrong yet." when the API marks a hop slow (S1).
- **`Ops`** (`/ops`): `PageHead` with eyebrow "Ops · not part of the product". Panels from PLAN §13 in this order: Simulation, Summary, Stuck, Server log (filter by kind and payout id, newest first, monospace lines), Reconciliation, Config. Any payout id on the page opens the inspector as a drawer or a section below. Polls every 2 s. Shows a clear empty state when `OPS_ENABLED` is off (the API answers 404).
- **`SideNav`**: Payouts, New payout, the theme switch; in dev builds (`import.meta.env.DEV`) a small "Ops" link in the footer.

### 4. Browser tests (`e2e/`)

`playwright.config.ts` starts the API with `OPS_ENABLED=true`, `SIM_RATE_JITTER_E4=0`, an in-memory or temp DB, `speed` 10, plus the Vite dev server. Tests set flags through `PUT /api/ops/simulation` in `beforeEach` and reset after.

- `confirm.spec.ts`
  - `H1: double-clicking Confirm creates one payout` (assert through `GET /api/payouts` count, not the UI)
  - `H2: confirming with 1s left is accepted` (use `POST /api/ops/quotes/:id/expire-in` with 1500 ms)
  - `H2: confirming after expiry shows "Nothing was sent" and offers a new rate`
  - `S4: a dropped confirm response still lands on the one payout` (route-intercept the first `POST /payouts` response to abort after the server handled it)
- `timeline.spec.ts`
  - `happy path reaches Delivered and shows the quoted pesos`
  - `H4: a declined hop 1 shows failed and "Not sent"`
  - `H6: a rejected deposit shows refunded with the fee included`
  - `H9: reloading mid-payout shows the server's status`
  - `S2: when reads fail the strip shows the last confirmed time, and recovers`
  - `T7: the page doesn't say Delivered before the API does` (`slow` on at speed 1; while the API's deposit leg isn't `succeeded`, the page has no "Delivered")
- `ops.spec.ts`
  - `S5: a switch set on /ops changes the next payout`
  - `S8: the server log shows the replay when Confirm is sent twice with the same key`
- `a11y.spec.ts`
  - `S6: list, new payout, payout and /ops have no axe violations in light` and `… in dark` (`@axe-core/playwright`)
  - `tabular figures: "0000" and "1111" render at equal width`
  - `no request leaves localhost` (collect `page.on('request')` hosts)
  - `375 px wide: no horizontal scroll on any screen`

## Gate

```bash
pnpm verify
pnpm test:e2e
```

Both green. `pnpm check:tokens` passes with the full UI in place.

## Write down

PROCESS: Phase 5 entry with what the real screens showed that the mockup didn't. If any copy had to change, update the mockup's DECISIONS in the same change. DECISIONS: Proposed entries for anything about routing or polling that differs from this brief.

## Out of scope

Server-sent events (N1), screenshot tests (N7), support actions (N3).
