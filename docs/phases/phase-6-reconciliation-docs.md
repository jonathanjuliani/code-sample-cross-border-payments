# Phase 6: Reconciliation pass, run steps and the evidence docs

**Goal**: someone who has never seen the repo can clone it, run one command, force every failure from `/ops`, and find, for every requirement, whether it's handled and how to check it.

**Read first**: PLAN §16 (every H, S, P, T and N id), §18 (done means). README. The COVERAGE layout in step 4 below.

**Start state**: Phase 5 gate green.

## Do, in this order

1. **Fresh-clone run**: in a temp directory, `git clone` the repo, `docker compose up --build`, open `http://localhost:8801` and `http://localhost:8801/ops`. Go through every switch in PLAN §11 by hand from `/ops`, one payout each, and check on `/ops` that it ended in one final state with a balanced ledger. Note anything that didn't match.
2. **Fix** what step 1 found, each with a test.
3. **README**: replace the "Status: design and plan only" note with:
   - "Run it" (`docker compose up`, the two URLs, `WEB_PORT` override),
   - "Develop" (`pnpm install`, `pnpm dev`, `pnpm verify`, `pnpm test:e2e`),
   - "Try the failures" (open `/ops`, pick a switch, make a payout in another tab),
   - the H table kept, each row linking to its COVERAGE row,
   - the layout section updated to what was built.
4. **`docs/COVERAGE.md`**: one table per group (H, S, P, T, N). Columns: `ID`, `Situation`, `Status`, `How it's handled`, `Evidence` (test file › test name), `How to see it` (the `/ops` switch or the steps). Status values: Handled, Partial, Not handled: by choice, Not handled: later, Unverified. Header says the date, Node version and the commands the statuses come from. Every status comes from a run in this phase, not from reading code. Use `grep -rn "H1:" apps packages e2e` (and so on for each id) to collect evidence.
5. **`docs/DECISIONS.md`**: review every "Proposed" entry; accept, change or supersede each. Add an entry for each "Skipped, and why" item in PLAN §16 (auth, recipient editing, compliance, hold-and-fix), so what was left out is on record with its reason.
6. **`docs/PROCESS.md`**: Phase 6 entry with the fresh-clone run.
7. **Done means**: tick PLAN §18's checklist only for items proven in this phase, with the evidence beside each.

## Gate

```bash
pnpm verify
pnpm test:e2e
```

Both green, the fresh-clone run done with every switch, COVERAGE complete with no id from PLAN §16 missing, and PLAN §18 fully ticked.

## Out of scope

New features. Anything found that isn't a bug goes to Phase 7 or to DECISIONS as skipped.
