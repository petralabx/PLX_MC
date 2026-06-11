# Demo data purge — fixtures + staging mirror

- **Date:** 2026-06-11 (ET)
- **Request:** operator — keep only the PLX Portal go-live plan; purge all
  prototype/demo buckets and tasks.

## Fixture purge (src/lib/mc-data/data.ts)

Removed: 5 demo buckets, 13 demo tasks, milestones M-1…M-5, risks
RISK-1/2/4/7, the seeded conflicts/errors (cf-140, cf-risk1, er-risk4), the
demo PRD/TRACE/AGENT_FEED/INBOX/FILES content. Kept: platform fixtures
(stages, priorities, people, agents, repos, cycles) and everything from the
go-live plan. `CURRENT_USER` is now `vince` (the operator) and the topbar
avatar follows it. The document library is a folder skeleton (8 workstreams +
Shared) with no fabricated files; register counts are honest plan-only
numbers (all pending, nothing synced — no sweep against production has run).

Code that hardcoded demo ids was made data-driven: bucket/task detail
fallbacks, the store's audit seed, and the `applyInbound` TASK-188 demo
simulation was pruned outright (the engine's real inbound delta replaced it
in PR #10). Empty states added for the agent feed and traceability matrix.

## Staging mirror purge (plx_mc database)

Scoped `WHERE id = ANY(...)` deletes (never unscoped; audit log retained as
history):

```
tasks: 14 rows deleted        (13 demo + TASK-220 evidence task)
risks: 4 rows deleted
files: 21 rows deleted
conflicts: 3 rows deleted     (cf-140, cf-risk1, resolved TASK-219 test row)
push errors: 1 rows deleted   (er-risk4)
```

Post-purge mirror, verified via `/api/state` after the seed guard re-ran:

```
tasks=15 risks=3 files=9 conflicts=0 errors=0
task ids: TASK-221 … TASK-235
counts: todos {pending:15} · risks {pending:3} · documents {synced:9}
```

Browser verification: sidebar shows only the 8 workstream buckets; topbar
pill "28 pending"; inbox greets Vince with the single seed notification and
his five next-due plan tasks (screenshot captured during the session).

## Notes

- Items previously pushed to the **dev** SharePoint site
  (`/sites/plx-mission-control-dev`) were not deleted — the engine never
  deletes SharePoint items (TOOLS.md guardrail) and the dev site is a
  sandbox; the production site starts clean.
- Folder entities carry no sync ref and seed as `synced` (9 documents) —
  display-only until the documents-library sync increment lands.
- `delta_links` cursors retained; inbound deltas for now-unknown SP items are
  skipped by design.
