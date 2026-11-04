# Cross-Border Payout

A small web app for paying a supplier abroad. Someone in the finance team of a US business picks a supplier in Mexico, types an amount in pesos or in dollars, gets a price that holds for a minute, confirms it, and watches the payout until the pesos arrive or the dollars come back.

Underneath, the money takes three hops, and the person at the screen never sees them:

1. **Collect**: dollars are pulled from the sender's account.
2. **Transfer**: the dollars become a dollar stablecoin and move on a blockchain.
3. **Deposit**: the stablecoin becomes pesos, paid into the supplier's bank account.

Each hop's provider is simulated, and can be made to fail on purpose: slow, declined, timed out without an answer, or sending duplicate or out-of-order status updates.

> Status: Phase 1 foundation is in. Workspace, money rules, `/health`, tokens and `docker compose up` work. Open [`docs/design/mockup/index.html`](docs/design/mockup/index.html) for the full UI; app screens start in Phase 5.

## The rule everything serves

> A payout finishes once, in one final state. Each hop moves money at most one time. The supplier gets exactly what was quoted, or the sender gets every cent back. When a provider and our ledger disagree, the ledger is right.

## What happens when…

These are the cases the app is built around, written before any code. The full list, with should-haves, traps and nice-to-haves, is in [docs/PLAN.md](docs/PLAN.md).

| #   | Situation                                                     | What the app does                                                                                                                   |
| --- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| H1  | Double-click on Confirm                                       | One payout. The button locks, and the API dedupes on the `Idempotency-Key`. Same key and a different body is a 409.                 |
| H2  | Confirm lands with a fraction of a second left on the quote   | The server clock decides. Arrived before `expires_at`: accepted at the quoted rate. After: 410, "Nothing was sent", get a new rate. |
| H3  | The quote expired or was already used                         | Rejected. One quote makes at most one payout.                                                                                       |
| H4  | Hop 1 declines                                                | Final state `failed`. Nothing moved, nothing in the ledger.                                                                         |
| H5  | A provider times out without saying whether it worked         | The leg is `checking`. The worker asks the provider for the status by our reference before deciding. Never a blind retry.           |
| H6  | Hop 3 refuses the supplier's bank details                     | The stablecoin comes back, the sender gets a full refund including the fee. Final state `refunded`.                                 |
| H7  | The same status update arrives twice                          | Deduped on the event id. Nothing changes the second time.                                                                           |
| H8  | A newer status arrives before an older one                    | Applied by sequence per leg. The older one is ignored. A payout never moves backwards.                                              |
| H9  | The person closes the tab mid-payout and comes back later     | The list and the timeline show the server's status. The client holds nothing that matters.                                          |
| H10 | The screen said 42,800.00 MXN                                 | 42,800.00 MXN lands. A rate or fee change after the quote is absorbed by the platform and recorded in the ledger.                   |
| H11 | The process crashes between saving a payout and calling hop 1 | The state change and the next step are written in one transaction (outbox). On restart the worker sends what is pending.            |
| H12 | Money                                                         | Integer minor units everywhere. A double-entry ledger per payout that sums to zero per currency. Balances are computed, not stored. |

## Planned layout

```
apps/api         Fastify + SQLite: quotes, payouts, ledger, outbox worker, webhooks, simulator, /ops API
apps/web         Vite + React: payout list, new payout, payout timeline, and /ops (server log, summary, simulation), on a two-layer CSS token system (light + dark)
packages/shared  Zod contracts both sides import
docs/            plan, phase briefs, decisions, process, design mockup
```

To build it, start at [AGENTS.md](AGENTS.md), then [docs/phases/](docs/phases/README.md).

One command to run it is part of the plan: `docker compose up`.
