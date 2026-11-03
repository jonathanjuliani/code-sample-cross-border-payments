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
