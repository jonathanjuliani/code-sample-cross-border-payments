# Phases

One brief per phase. Each is written so someone (a person or an agent) who has read [AGENTS.md](../../AGENTS.md) and [PLAN.md](../PLAN.md) can pick it up cold, do it, and prove it's done. Do them in order: each one assumes the previous gate passed.

| Phase | Brief                                          | Ends with                                                                 |
| ----- | ---------------------------------------------- | ------------------------------------------------------------------------- |
| 0     | done: PLAN, mockup, DECISIONS v1, AGENTS       | The invariant and H1 to H12 written before code                           |
| 1     | done: [Foundation](phase-1-foundation.md)      | `docker compose up` answers `/health`; money and token checks green       |
| 2     | done: [Quotes and payouts](phase-2-quotes-payouts.md) | H1, H2, H3; illegal transitions refused                            |
| 3     | done: [Ledger, outbox, webhooks](phase-3-ledger-outbox-webhooks.md) | H7, H8, H11, H12; every journal sums to zero             |
| 4     | done: [Simulator and ops API](phase-4-simulator-ops-api.md) | Every §11 switch ends in a final state with a balanced ledger |
| 5     | done: [Client and /ops page](phase-5-client-ops-page.md) | Playwright flows and axe green in both themes                      |
| 6     | done: [Reconciliation and docs](phase-6-reconciliation-docs.md) | Fresh clone, one command, every switch tried by hand         |
| 7     | done: [Nice-to-haves](phase-7-nice-to-haves.md) | Each N item with a test (N1–N7; N4 via P4). N7 removed for now ([D31](../DECISIONS.md#d31-screenshot-tests-removed-until-rebaselined))                               |

There is no Phase 8. Further work is maintenance or a new DECISIONS entry that reopens scope.

## How to work a phase

1. Read the brief end to end, then the PLAN sections it lists. Open the mockup if the phase touches the UI.
2. Check the start state the brief describes. If the previous gate isn't green, fix that first.
3. Build in the order the brief gives. Write each test with the code it covers, not at the end.
4. Run the gate commands. Read the output, don't assume it.
5. Add the phase's entry to [PROCESS.md](../PROCESS.md): what was built, anything found that the plan didn't say, what was thrown away, and the gate output summary (test counts, commands run).
6. Any call the plan didn't make goes into [DECISIONS.md](../DECISIONS.md) as "Proposed".
7. Commit. One phase never leaves `pnpm verify` red.

## Rules for every brief

- A test name says the situation, not the function: `confirming twice with the same key creates one payout`, not `createPayout works`.
- Each H, S, P and T id a phase covers is named in at least one test title (`H1:`, `P3:`), so `grep` finds the evidence for [COVERAGE](../PLAN.md#16-requirements) later.
- Don't build ahead. If a later phase owns something, leave a seam (an interface, a no-op) and stop.
- If a brief and PLAN disagree, stop and fix the docs in the same change; the brief is wrong more often than the plan.
