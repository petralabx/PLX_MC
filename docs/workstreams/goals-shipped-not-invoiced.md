# Goals shipped, not yet invoiced

- Slug: `goals-shipped-not-invoiced` (this file is `docs/workstreams/goals-shipped-not-invoiced.md`)
- Owner: Vince · agents: grok/grok-bot, claude/claude-vince-c, cursor/grok-4.7
- Branches: `feat/goals-shipped-not-invoiced`
- MC tasks: TASK-3992
- SharePoint handoff: n/a

## Goal

Until go-live, add this month's posted Sage shipments whose header numinvoice is 0 to the Goals Revenue card as an estimate. A counted hand entry that names the same shipment number is left out, so those goods sit on the card once.

## Status

active, as of 2026-10-28. [PLX_MC PR 463](https://github.com/petralabx/PLX_MC/pull/463) is open and mergeable with `main`. Merge commit `400a71fc` brings the business-line split onto this branch. The estimate stays in the Revenue headline. A stored shipment total counts as Distribution. Compliance on `400a71fc` blocked with `head_sha_mismatch` before unsigned gate `apg_98f26b4f70be5de6` existed. That gate covers `400a71fc` only. The signature has to cover the head that contains this note. Migration 052 is not applied. The read grant is not run.

## Done

- TASK-3992 on [PLX_MC PR 463](https://github.com/petralabx/PLX_MC/pull/463): the estimate, migration 052 and its guarded rollback, the Pending shipments sheet, the card equations, and the hand-entry exclusion when the reference is the Sage shipment number.
- Returns (TASK-3987) landed in [PLX_MC PR 459](https://github.com/petralabx/PLX_MC/pull/459) on 2026-10-26. This branch picked that up by merges of `main`.
- `origin/main` (PR 495, business-line split) is merged into this branch at `400a71fc`. The estimate stays in the headline. A stored shipment total counts as Distribution. Item amounts use the finished-good and 3PL rules. The three lines add to the headline to the cent. Goals tests: 32 passed. Pre-commit preflight passed.

## Next steps

1. Ricardo Savelli signs the merge gate for the head that contains this note. Vince, Rishi or Stephen can approve it if he cannot. `apg_98f26b4f70be5de6` covers `400a71fc` only. Ricardo already signed `apg_65b0994a5bd9e40f` for the pre-merge head.
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
- `tests/reporting-goals-pending-shipments.test.ts`, `tests/reporting-goals-business-line.test.ts`, `e2e/goals-pending-shipments.spec.ts`

## How to run the tests

```bash
npx vitest run tests/reporting-goals-pending-shipments.test.ts tests/reporting-goals-business-line.test.ts
./scripts/preflight.sh --mode pre-commit
node scripts/workstream-note.mjs check
```

Postgres harness tests need Docker. This host has none, so those tests fail with `spawnSync docker ENOENT`.

## Blockers or dependencies on other workstreams

- None on another workstream. PR 459 (returns) is merged. PR 495 (business-line split) is merged into this branch. This PR waits on a signed merge approval of the head that contains this note, then CIP.

## Last updated

2026-10-28 by cursor/grok-4.7. Recorded merge `400a71fc`, the compliance block on that head, and unsigned gate `apg_98f26b4f70be5de6`. The signature has to cover the head that contains this note.
