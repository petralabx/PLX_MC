# Goals shipped, not yet invoiced

- Slug: `goals-shipped-not-invoiced` (this file is `docs/workstreams/goals-shipped-not-invoiced.md`)
- Owner: Vince · agents: grok/grok-bot, claude/claude-vince-c, cursor/grok-4.7
- Branches: `feat/goals-shipped-not-invoiced`
- MC tasks: TASK-3992
- SharePoint handoff: n/a

## Goal

Until go-live, add this month's posted Sage shipments that no posted invoice names yet to the Goals Revenue card as an estimate. A counted hand entry that names the same shipment number is left out, so those goods sit on the card once.

## Status

active, as of 2026-10-28. [PLX_MC PR 463](https://github.com/petralabx/PLX_MC/pull/463) is open. Product work last landed at `25db82da`, with unsigned merge gate `apg_4a339c2c8e9056c7`. This note moves the head, so that gate does not cover the new commit. Migration 052 is not applied. The read grant is not run.

## Done

- TASK-3992 on [PLX_MC PR 463](https://github.com/petralabx/PLX_MC/pull/463): the estimate, migration 052 and its guarded rollback, the Pending shipments sheet, the card equations, and the hand-entry exclusion when the reference is the Sage shipment number.
- Returns (TASK-3987) landed in [PLX_MC PR 459](https://github.com/petralabx/PLX_MC/pull/459) on 2026-10-26. This branch was rebased onto that work by merges of `main`.

## Next steps

1. Raise a new unsigned merge gate for the head that includes this note, then a person signs it. Vince, Ricardo, Rishi or Stephen can approve it. Gate `apg_4a339c2c8e9056c7` and question `q_a0a12df3af42a279` cover `25db82da` only.
2. CIP merges the PR. Do not apply migration 052 or the read grant from an agent session.
3. Confirm the Sage shipment table and column names, and the void flag, before the card's numbers are trusted.

## Decisions and why

- 2026-10-26 The estimate is interim and turns off with `GOALS_PENDING_SHIPMENTS=off`. Why: Sage posts a shipment before AR posts the invoice, and the addition should be easy to remove at go-live. Decided by: Vince (accountable owner of TASK-3992).
- 2026-10-27 The 052 rollback refuses unless `plx.code_reverted` is set and the newest good refresh has no pending summary. Why: dropping the tables under live code makes every API return `503 schema_behind`. The flag is not a substitute. Decided by: claude/claude-vince-c on the PR 463 review.
- 2026-10-28 A counted hand entry whose reference is the Sage shipment number is left out of the estimate. An entry that names the order number, a customer PO, or is blank stays beside it. Why: matching the order would also drop every other shipment of that order, and a customer-and-value match can drop a different shipment. Decided by: cursor/grok-4.7.
- 2026-10-28 An agent does not sign the merge approval. Why: the PR includes migration 052 and revenue figures, so a person signs the exact head. Decided by: the operator instruction for this session.

## Open questions

- Are `sage.oe_shipment_header` and `sage.oe_shipment_detail` the replica names, and are `shsourcurr` and `shidisc` the currency and discount columns? Who: the replica owner.
- Which column marks a voided or deleted shipment? The query uses `true` until that is confirmed. Who: the replica owner.
- Who runs `docs/modules/reporting-goals/readonly-grants-shipments-pending.sql`? Who: a DBA. Until then the card says the estimate needs access.

## Files / areas touched

- `db/migrations/052_reporting_goals_pending_shipments.sql`, `db/rollback/052_reporting_goals_pending_shipments_rollback.sql`, `src/lib/db/migration-manifest.json`
- `src/lib/reporting/goals/` (pending shipments, view, refresh, store, excel export)
- `src/components/mc/goals/goal-cards.tsx`
- `docs/modules/reporting-goals/README.md`, `docs/modules/reporting-goals/readonly-grants-shipments-pending.sql`
- `tests/reporting-goals-pending-shipments.test.ts`, `e2e/goals-pending-shipments.spec.ts`

## How to run the tests

```bash
npx vitest run tests/reporting-goals-pending-shipments.test.ts
./scripts/preflight.sh --mode pre-commit
node scripts/workstream-note.mjs check
```

Postgres harness tests need Docker. This host has none, so those tests fail with `spawnSync docker ENOENT`.

## Blockers or dependencies on other workstreams

- None. PR 459 (returns) is merged. This PR waits on a person's signed merge approval, then CIP.

## Last updated

2026-10-28 by cursor/grok-4.7. Opened the note after several sessions on the one open PR.
