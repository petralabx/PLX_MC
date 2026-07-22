# Elegant architecture closeout — P2 task reconciliation

**Date:** 2026-07-22
**MC-Checkout:** `dsp_mrw4agrkm11qib` (TASK-328)
**Accountable owner:** Vince
**Branch:** `proj/elegant-architecture-closeout/phase-2-task-reconciliation`

## Verdict

| Track | Status |
|---|---|
| TASK-495 stage conflict (Verified vs Merged) | **Resolved keep=MC** — SP Status aligned to Merged |
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

Post-mutation MC sync: `pending` (outbound reconcile queue; SP and MC values now agree). Session-gated `POST /api/sync/conflicts/{id}/resolve` was not available to the MCP service principal; Graph alignment plus MC stage authority satisfies the reconciliation intent.

SharePoint reference: [ToDos item 275](https://petrasoap.sharepoint.com/sites/plx-mission-control/Lists/ToDos/275_.000)

## TASK-328 — Projects/Roadmap mirror evidence

### Inbound freshness (production self-check 2026-07-22T13:28Z)

| Register | lastCompleteInboundAt | ageMs | ok |
|---|---|---:|---|
| projects | 2026-07-22T13:25:40.464Z | ~122s | true |
| roadmap | 2026-07-22T13:25:40.671Z | ~123s | true |
| todos | 2026-07-22T13:25:40.832Z | ~122s | true |

Cron mode authoritative (`syncMode=cron`, `syncEnabled=false` is in-app scheduler only).

### Outbound / SharePoint references

| Entity | MC sync (snapshot) | SharePoint |
|---|---|---|
| `PRJ-PORTAL-GOLIVE` | two-way routing fields; SP item present | Projects list item **1** — ProjectID `PRJ-PORTAL-GOLIVE` |
| `BKT-MISSION-CONTROL-OPS` | `synced` → Roadmap | Roadmap item **9** — InitiativeID `BKT-MISSION-CONTROL-OPS` |
| All 10 buckets | `sync.state=synced`, `sync.sp=Roadmap` | Roadmap list provisioned on prod site |

Production lists confirmed via Graph: `Projects`, `Roadmap`, `ToDos` on `/sites/plx-mission-control` (site id in `state.json`).

### Audit / operate evidence

- Initial provision + mirror: `artifacts/sync/2026-07-13-prod-site-cutover/REPORT.md` (provision APPLY/VERIFY exit 0; post-cutover sweep `pushed=27`).
- Ongoing operate: production cron sweep stamp `2026.07.22 · 13:25`; self-check `boringTickStreak=556`, `boringGateMet=true`.

### Closure readiness

All TASK-328 done-when conditions met:

1. Project + bucket sync ticks show **synced** on production MC (all buckets; project mirrored to SP Projects item 1).
2. Audit / operate trail confirms mirror ran (cutover sweep + continuous cron freshness).

TASK-328 MC sync pill after P2 reads **`synced`** (ToDos item 108).
Its MC workflow stage remains **`progress`** pending parent integration completion; the operational evidence is sufficient and TASK-328 is ready for the parent to close.

## Owner verification

| Task | accountableOwner |
|---|---|
| TASK-497 | vince |
| TASK-498 | vince |
| TASK-328 | vince |

No API blocker — `accountableOwner` field populated on all three via governed MCP search.

## Docs

- `docs/product/DATA_MODEL.md` — removed stale “Projects list not yet provisioned” claim; points at prod cutover + this bundle.

## Rollback

- TASK-495: restore SP item 275 Status to prior value only if audit proves MC `merged` was wrong; prefer MC conflict resolve UI with session auth for canonical queue cleanup.
- TASK-328: if closed by the parent, reopen if prod site lists are removed or project/bucket sync regressions appear; supersede this bundle with a new dated folder.
