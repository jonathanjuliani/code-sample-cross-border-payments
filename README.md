# Cross-Border Payout

A small web app for paying a supplier abroad. Someone in the finance team of a US business picks a supplier in Mexico, types an amount in pesos or in dollars, gets a price that holds for a minute, confirms it, and watches the payout until the pesos arrive or the dollars come back.

Underneath, the money takes three hops, and the person at the screen never sees them:

1. **Collect**: dollars are pulled from the sender's account.
2. **Transfer**: the dollars become a dollar stablecoin and move on a blockchain.
3. **Deposit**: the stablecoin becomes pesos, paid into the supplier's bank account.

Each hop's provider is simulated, and can be made to fail on purpose: slow, declined, timed out without an answer, or sending duplicate or out-of-order status updates.

> Status: Phases 0–7 are done. Sender screens, `/ops`, coverage, and every N nice-to-have ship with tests. See [docs/COVERAGE.md](docs/COVERAGE.md) and [docs/PROCESS.md](docs/PROCESS.md).

## The rule everything serves

> A payout finishes once, in one final state. Each hop moves money at most one time. The supplier gets exactly what was quoted, or the sender gets every cent back. When a provider and our ledger disagree, the ledger is right.

## Run it

```bash
docker compose up --build
```

Then open:

- App: [http://localhost:8801](http://localhost:8801)
- Ops: [http://localhost:8801/ops](http://localhost:8801/ops)

Override the host port with `WEB_PORT=9000 docker compose up --build` if 8801 is taken. `OPS_ENABLED` is on in Compose.

## Develop

Needs Node 24 (see `.nvmrc`) and pnpm 11.

```bash
pnpm install
pnpm dev          # API + Vite; web proxies /api → the API
pnpm verify       # lint, tokens, typecheck, unit tests
pnpm test:e2e     # Playwright (starts API + Vite itself)
```

## Try the failures

1. Open `/ops` in one tab.
2. Flip a simulation switch (for example `collect.decline` or `deposit.rejectBank`).
3. In another tab, create a payout from **New payout**.
4. Watch the timeline and the `/ops` server log / summary. Each switch's expected end state is in [docs/COVERAGE.md](docs/COVERAGE.md) and PLAN §11.

## What happens when…

These are the cases the app is built around. Each row links to its coverage entry.

| #   | Situation                                                     | What the app does                                                                                                                   | Coverage                              |
| --- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| H1  | Double-click on Confirm                                       | One payout. The button locks, and the API dedupes on the `Idempotency-Key`. Same key and a different body is a 409.                 | [H1](docs/COVERAGE.md#must-handle-h)  |
| H2  | Confirm lands with a fraction of a second left on the quote   | The server clock decides. Arrived before `expires_at`: accepted at the quoted rate. After: 410, "Nothing was sent", get a new rate. | [H2](docs/COVERAGE.md#must-handle-h)  |
| H3  | The quote expired or was already used                         | Rejected. One quote makes at most one payout.                                                                                       | [H3](docs/COVERAGE.md#must-handle-h)  |
| H4  | Hop 1 declines                                                | Final state `failed`. Nothing moved, nothing in the ledger.                                                                         | [H4](docs/COVERAGE.md#must-handle-h)  |
| H5  | A provider times out without saying whether it worked         | The leg is `checking`. The worker asks the provider for the status by our reference before deciding. Never a blind retry.           | [H5](docs/COVERAGE.md#must-handle-h)  |
| H6  | Hop 3 refuses the supplier's bank details                     | The stablecoin comes back, the sender gets a full refund including the fee. Final state `refunded`.                                 | [H6](docs/COVERAGE.md#must-handle-h)  |
| H7  | The same status update arrives twice                          | Deduped on the event id. Nothing changes the second time.                                                                           | [H7](docs/COVERAGE.md#must-handle-h)  |
| H8  | A newer status arrives before an older one                    | Applied by sequence per leg. The older one is ignored. A payout never moves backwards.                                              | [H8](docs/COVERAGE.md#must-handle-h)  |
| H9  | The person closes the tab mid-payout and comes back later     | The list and the timeline show the server's status. The client holds nothing that matters.                                          | [H9](docs/COVERAGE.md#must-handle-h)  |
| H10 | The screen said 42,800.00 MXN                                 | 42,800.00 MXN lands. A rate or fee change after the quote is absorbed by the platform and recorded in the ledger.                   | [H10](docs/COVERAGE.md#must-handle-h) |
| H11 | The process crashes between saving a payout and calling hop 1 | The state change and the next step are written in one transaction (outbox). On restart the worker sends what is pending.            | [H11](docs/COVERAGE.md#must-handle-h) |
| H12 | Money                                                         | Integer minor units everywhere. A double-entry ledger per payout that sums to zero per currency. Balances are computed, not stored. | [H12](docs/COVERAGE.md#must-handle-h) |

The full list (should-haves, traps, nice-to-haves) is in [docs/PLAN.md](docs/PLAN.md) §16, with status in [docs/COVERAGE.md](docs/COVERAGE.md).

## Layout

```
apps/api         Fastify + SQLite: quotes, payouts, ledger, outbox worker, webhooks, simulator, /ops API
apps/web         Vite + React: list, new payout, timeline, /ops (simulation, summary, stuck, log, recon, config)
packages/shared  Zod contracts and money rules both sides import
e2e/             Playwright: confirm, timeline, ops, a11y, stream, screenshots
docs/            plan, phase briefs, decisions, process, coverage, design mockup
```

Agent rules: [AGENTS.md](AGENTS.md). Phases: [docs/phases/](docs/phases/README.md).
