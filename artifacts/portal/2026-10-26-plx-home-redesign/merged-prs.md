# Merged pull requests — petralabx/plx-customer-portal → staging

All landed through the staging merge queue with merge commits. File and line counts are GitHub's per-PR
numbers (#3022 from the merge commit). Each PR body carries its review links, test plan and rollback plan.

| PR | Task | What | Files | +/- | Merge commit | Landed (UTC) |
|---|---|---|---|---|---|---|
| [#3018](https://github.com/petralabx/plx-customer-portal/pull/3018) | TASK-3897 | Home lower half: Today on the floor, Sales orders at risk, Recent activity, Jump back in, Go to; OpStrip cleanup; footer; Export moved to /mrp/reports | 37 | +3200 / -788 | `8693b284` | 2026-10-25 18:41 |
| [#3015](https://github.com/petralabx/plx-customer-portal/pull/3015) | TASK-3898 | PO approver Teams DM uses `User.entraObjectId`; DM sends awaited | 3 | +112 / -28 | `6c4eea4a` | 2026-10-26 10:49 |
| [#3016](https://github.com/petralabx/plx-customer-portal/pull/3016) | TASK-3895 | Planner cue strip behind `PLX_HOME_CUES_ENABLED` (default off) | 11 | +1191 / -40 | `29c7369c` | 2026-10-26 10:52 |
| [#3022](https://github.com/petralabx/plx-customer-portal/pull/3022) | TASK-3908 | Footer FileMaker sync time from the ingest watermark, not `fm_row_count_audit` | 4 | +219 / -43 | `d1dc5763` | 2026-10-26 10:58 |
| [#3014](https://github.com/petralabx/plx-customer-portal/pull/3014) | TASK-3900 | Microsoft integration docs drift corrected; stale Teams manifest archived; 4 dead `notify*` helpers removed | 11 | +39 / -138 | `41c66662` | 2026-10-26 11:01 |
| [#3012](https://github.com/petralabx/plx-customer-portal/pull/3012) | TASK-3890 | Staff land on `/mrp` after sign-in; safe deep links win; callback hardening | 5 | +144 / -15 | `a30307f5` | 2026-10-26 11:06 |
| [#3017](https://github.com/petralabx/plx-customer-portal/pull/3017) | TASK-3896 | Multi-source Awaiting you panel; panel-only 60 s refresh; `GET /api/mrp/home/awaiting-you` | 12 | +1380 / -117 | `6c5ecba7` | 2026-10-26 11:26 |

## New or changed surfaces on staging

- `/` signed in → `/mrp` for staff, `/dashboard` for customers and suppliers.
- `/mrp`: Awaiting you panel under the header; KPI band (catalogue counts, "—" on failure) or planner cues when the flag is on;
  floor, sales risk, activity, jump-back, Go to; footer with compliance line and FileMaker sync time.
- `/mrp/reports`: suite Export CSV.
- `/mrp/planning`: `#tank-lane` and `#line-lane` anchors.
- New API: `GET /api/mrp/home/awaiting-you` (staff only, read-only, `no-store`).
- New flag: `PLX_HOME_CUES_ENABLED` (server, request-time, default off).

## Rollback

Each PR reverts independently with no schema or data change. The cue strip also turns off by unsetting the flag.
