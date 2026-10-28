# Goals shipped, not yet invoiced

- Slug: `goals-shipped-not-invoiced` (this file is `docs/workstreams/goals-shipped-not-invoiced.md`)
- Owner: Vince · agents: grok/grok-bot, claude/claude-vince-c, cursor/grok-4.7
- Branches: `feat/goals-shipped-not-invoiced`
- MC tasks: TASK-3992
- SharePoint handoff: n/a

## Goal

Until go-live, add this month's posted Sage shipments whose header numinvoice is 0 to the Goals Revenue card as an estimate. A counted hand entry that names the same shipment number is left out, so those goods sit on the card once.

## Status

active, as of 2026-10-28. [PLX_MC PR 463](https://github.com/petralabx/PLX_MC/pull/463) is open. Ricardo Savelli checked the UAT Sage copy on 2026-10-28: pending is `numinvoice` 0, and C and MISC item lines stay in the estimate. `origin/main` (PR 495, the business-line split) is merged into this branch. The estimate stays in the headline and counts as Distribution when the shipment has no item lines. The merge commit needs its own signed merge approval. Migration 052 is not applied. The read grant is not run.

## Done

- TASK-3992 on [PLX_MC PR 463](https://github.com/petralabx/PLX_MC/pull/463): the estimate, migration 052 and its guarded rollback, the Pending shipments sheet, the card equations, and the hand-entry exclusion when the reference is the Sage shipment number.
- Returns (TASK-3987) landed in [PLX_MC PR 459](https://github.com/petralabx/PLX_MC/pull/459) on 2026-10-26. This branch was rebased onto that work by merges of `main`.

## Next steps

1. A person signs the merge gate for the head that merges the business-line split with this estimate. Vince, Ricardo, Rishi or Stephen can approve it. Earlier gates cover earlier heads only.
2. CIP merges the PR. Do not apply migration 052 or the read grant from an agent session.
3. A DBA runs the grant script. It grants `oe_shipment_header.numinvoice` and does not grant `oe_invoice_header`.

## Decisions and why

- 2026-10-26 The estimate is interim and turns off with `GOALS_PENDING_SHIPMENTS=off`. Why: Sage posts a shipment before AR posts the invoice, and the addition should be easy to remove at go-live. Decided by: Vince (accountable owner of TASK-3992).
- 2026-10-27 The 052 rollback refuses unless `plx.code_reverted` is set and the newest good refresh has no pending summary. Why: dropping the tables under live code makes every API return `503 schema_behind`. The flag is not a substitute. Decided by: claude/claude-vince-c on the PR 463 review.
- 2026-10-28 A counted hand entry whose reference is the Sage shipment number is left out of the estimate. An entry that names the order number, a customer PO, or is blank stays beside it. Why: matching the order would also drop every other shipment of that order, and a customer-and-value match can drop a different shipment. Decided by: cursor/grok-4.7.
- 2026-10-28 An agent does not sign the merge approval. Why: the PR includes migration 052 and revenue figures, so a person signs the exact head. Decided by: the operator instruction for this session.
- 2026-10-28 A shipment is pending when `trim(numinvoice) = '0'`. Why: UAT's `oe_invoice_header` has no `shinumber`, so the NOT EXISTS join can never match. `numinvoice` 0 was 103 shipments, April through August 2026. Decided by: Ricardo Savelli, from a read-only check of the UAT Sage copy.
- 2026-10-28 The estimate keeps item codes C and MISC, and still drops line type 2 and zero-quantity lines. Why: those codes are real type-1 lines (screening fees, filling fees, pumps, bottles, artwork). The open-order forecast and the invoiced Revenue card stay as they are. Decided by: Ricardo Savelli, same check.
- 2026-10-28 Table names, the shipment columns as text, `shidate` as YYYYMMDD, currency CAD or USD, and `shidisc` as an amount are confirmed. There is no void column. The void test stays `true`. Header `complete` = 1 on the uninvoiced rows. Decided by: Ricardo Savelli, same check.
- 2026-10-28 The estimate stays inside the Revenue headline after the business-line split lands. A stored shipment total has no item code, so it counts as Distribution. Item amounts, when a row has them, use the finished-good and 3PL rules. Manufacturing, Distribution and Services add to the headline to the cent. Why: migration 052 stores a line count and an amount, not item lines, so classifying those rows would need a new schema. Decided by: cursor/grok-4.7 while merging `origin/main` (PR 495) into this branch.

## Open questions

- Who runs `docs/modules/reporting-goals/readonly-grants-shipments-pending.sql`? Who: a DBA. Until then the card says the estimate needs access. The script now grants `numinvoice` and does not grant the invoice header.

## Files / areas touched

- `db/migrations/052_reporting_goals_pending_shipments.sql`, `db/rollback/052_reporting_goals_pending_shipments_rollback.sql`, `src/lib/db/migration-manifest.json`
- `src/lib/reporting/goals/` (pending shipments, business line, view, refresh, store, excel export)
- `src/components/mc/goals/goal-cards.tsx`
- `docs/modules/reporting-goals/README.md`, `docs/modules/reporting-goals/readonly-grants-shipments-pending.sql`
- `tests/reporting-goals-pending-shipments.test.ts`, `e2e/goals-pending-shipments.spec.ts`

## How to run the tests

```bash
npx vitest run tests/reporting-goals-pending-shipments.test.ts tests/reporting-goals-business-line.test.ts
./scripts/preflight.sh --mode pre-commit
node scripts/workstream-note.mjs check
```

Postgres harness tests need Docker. This host has none, so those tests fail with `spawnSync docker ENOENT`.

## Blockers or dependencies on other workstreams

- None. PR 459 (returns) is merged. This PR waits on a person's signed merge approval, then CIP.

## Last updated

2026-10-28 by cursor/grok-4.7. Merged the business-line split. The estimate stays in the headline and counts as Distribution when the shipment has no item lines.
