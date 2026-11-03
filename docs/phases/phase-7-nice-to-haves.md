# Phase 7: Nice-to-haves

**Goal**: add the N items in order, each fully done (code, test, COVERAGE row, docs) before the next starts. The items are independent, so the repo is complete after any one of them.

**Read first**: PLAN §16 "Nice to have". COVERAGE. DECISIONS.

**Start state**: Phase 6 gate green. Every H, S and P1 to P3 row in COVERAGE says Handled.

## Each item

| ID | Build | Test it with | Notes |
| -- | ----- | ------------ | ----- |
| N1 | `GET /payouts/:id/stream` as server-sent events; the payout screen and `/ops` switch to it and fall back to polling on error | e2e: timeline updates with polling disabled; falls back when the stream closes | Polling stays as the fallback path, tested. |
| N2 | HMAC-SHA256 over `timestamp.body` in a `Signature` header; reject outside a 5-minute window or on a bad signature; the simulator signs | API: bad signature 401, stale timestamp 401, replayed event still deduped | Secret from an env var, shown masked on `/ops/config`. |
| N3 | `/ops` inspector actions: "Re-run status query" (queues `status.query` for a `checking` leg) and "Flag for review" (a `flagged_at` column, a Stuck-panel badge) | API tests for both; e2e that the button queues one query | Neither action moves money or changes payout state. |
| N4 | The reorg switch, if Phase 4 left it partial | the P4 scenario test | |
| N5 | A read-only "network reference" lookup for one real public testnet transfer by hash, shown in support details | a unit test with a recorded response; no network in CI | Off by default behind an env var. No keys. |
| N6 | A second chain provider behind `Provider`, selected by config | the scenario suite run against both | Nothing in `payouts/` or `ledger/` changes. That's the point; the diff should show it. |
| N7 | Playwright screenshot tests per screen, light and dark | `toHaveScreenshot` with a fixed clock and fixed data | Snapshots committed; update only on purpose. |

## For every item

1. Branch or commit series of its own.
2. Code and test together.
3. COVERAGE row moved to Handled with evidence.
4. PROCESS entry, one paragraph.
5. `pnpm verify` and `pnpm test:e2e` green.

## Gate

Per item: its test green and its COVERAGE row updated. There's no gate for the phase as a whole.
