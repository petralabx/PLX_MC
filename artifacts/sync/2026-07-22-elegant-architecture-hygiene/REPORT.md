# Elegant architecture closeout — P2 task reconciliation

**Date:** 2026-07-22
**MC-Checkout:** `dsp_mrw48l96qlgj7g` (TASK-328 project checkout)
**Phase reconciliation checkout:** `dsp_mrw4agrkm11qib` (TASK-328)
**Accountable owner:** Vince
**Branch:** `proj/elegant-architecture-closeout/phase-2-task-reconciliation`

## Verdict

| Track | Status |
|---|---|
| TASK-495 stage conflict (Verified vs Merged) | **Resolved keep=MC** — SP Status is Merged and the conflict stayed absent after an authenticated reload |
| TASK-328 Projects/Roadmap mirror | **Verified operational** — ready to close at parent integration |
| TASK-497 / TASK-498 / TASK-328 owners | **Vince** on all three (governed API) |
| Production self-check | **Green** — `dataSource=live`, `freshness.ok`, `boringGateMet=true` |

## TASK-495 — stage conflict attribution and resolution

### Before

| Surface | Stage / Status | Timestamp / actor |
|---|---|---|
| MC | `merged` | compliance-projection on PR #150/#151 merge (2026-07-20) |
| SharePoint ToDos item 275 | `Verified` | lastModified `2026-07-20T15:45:04Z` (Graph app) |
| MC sync pill | `conflict` (`spVal=verified`, `wsVal=merged`) | through 2026-07-22T13:27Z |

### Decision

Default **keep MC `merged`**: PRs [#150](https://github.com/petralabx/PLX_MC/pull/150) and [#151](https://github.com/petralabx/PLX_MC/pull/151) are objectively merged; compliance-projection promotion is authoritative. No newer attributable human comment or SP edit after merge argues for `Verified` over `merged` (vince@ merge comment at 15:40Z precedes SP Verified stamp at 15:45Z).

### Mutations (production)

1. `mc_report_progress` — reaffirmed MC stage `merged` with P2 attribution note.
2. Microsoft Graph — `PATCH` ToDos item **275** `Status: Merged` (keep-MC outcome on SharePoint SoR).

Post-mutation MC sync initially read `pending` because the MCP service principal could not call the session-gated conflict endpoint. At 2026-07-22 13:54 EDT, the authenticated operator selected **Keep Mission Control**, reloaded TASK-495, and confirmed the conflict card remained absent with lifecycle stage `Merged`. This verifies the canonical conflict row resolution persisted beyond the optimistic client update.

SharePoint reference: [ToDos item 275](https://petrasoap.sharepoint.com/sites/plx-mission-control/Lists/ToDos/275_.000)

## TASK-328 — Projects/Roadmap mirror evidence

### Inbound freshness (pre-TASK-497 production self-check, 2026-07-22T13:28Z)

| Register | lastCompleteInboundAt | ageMs | ok |
|---|---|---:|---|
| projects | 2026-07-22T13:25:40.464Z | ~122s | true |
| roadmap | 2026-07-22T13:25:40.671Z | ~123s | true |
| todos | 2026-07-22T13:25:40.832Z | ~122s | true |

Cron mode was authoritative in this pre-deployment capture (`syncMode=cron`; the retired `syncEnabled=false` field represented only the in-app scheduler). TASK-497 renames that field to `inAppSchedulerEnabled`.

### Outbound / SharePoint references

| Entity | MC sync (snapshot) | SharePoint |
|---|---|---|
| `PRJ-PORTAL-GOLIVE` | two-way routing fields; SP item present | Projects list item **1** — ProjectID `PRJ-PORTAL-GOLIVE` |
| `BKT-MISSION-CONTROL-OPS` | `synced` → Roadmap | Roadmap item **9** — InitiativeID `BKT-MISSION-CONTROL-OPS` |
| `BKT-MISSION-CONTROL-OPS` sample | `sync.state=synced`, `sync.sp=Roadmap` | Roadmap item **9** |

Production lists confirmed via Graph: `Projects`, `Roadmap`, `ToDos` on `/sites/plx-mission-control` (site id in `state.json`).

### Audit / operate evidence

- Initial provision + mirror: `artifacts/sync/2026-07-13-prod-site-cutover/REPORT.md` (provision APPLY/VERIFY exit 0; post-cutover sweep `pushed=27`).
- Ongoing operate: production cron sweep stamp `2026.07.22 · 13:25`; self-check `boringTickStreak=556`, `boringGateMet=true`.

### Closure readiness

All TASK-328 done-when conditions met:

1. The captured project and bucket samples are **synced** on production MC (project mirrored to Projects item 1; bucket mirrored to Roadmap item 9).
2. Audit / operate trail confirms mirror ran (cutover sweep + continuous cron freshness).

TASK-328 MC sync pill after P2 reads **`synced`** (ToDos item 108).
Its MC workflow stage remains **`progress`** pending parent integration completion; the operational evidence is sufficient and TASK-328 is ready for the parent to close.

## Owner verification

| Task | accountableOwner |
|---|---|
| TASK-497 | vince · `MC-Checkout: dsp_mrw48laebfms71` |
| TASK-498 | vince · `MC-Checkout: dsp_mrw48lgrlubyiy` |
| TASK-328 | vince · `MC-Checkout: dsp_mrw48l96qlgj7g` |

No API blocker — `accountableOwner` field populated on all three via governed MCP search.

## Docs

- `docs/product/DATA_MODEL.md` — removed stale “Projects list not yet provisioned” claim; points at prod cutover + this bundle.

## Rollback

- TASK-495: do not restore SP item 275 to `Verified` unless audit proves MC `merged` was wrong. If the conflict reappears, inspect the resolution audit before taking another action.
- TASK-328: if closed by the parent, reopen if prod site lists are removed or project/bucket sync regressions appear; supersede this bundle with a new dated folder.
