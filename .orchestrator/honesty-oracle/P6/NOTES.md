# P6 — Promote conflict console

**Branch:** `proj/honesty-oracle/phase-6-conflict-console`  
**Base:** `proj/honesty-oracle/phase-2-self-check-thin` @ `d0ffdc805cd12b66d866100930cb6338922d663e`  
**MC:** TASK-490 · `MC-Checkout: dsp_mrnrxfuu6eu8lh` · owner Vince  
**Date:** 2026-07-16  
**Worktree:** `C:\Users\vince\.cursor\worktrees\honesty-oracle-p6-4bad37dd`

## What shipped

1. **First-class nav** — Sidebar label `Sync / Conflicts` (still matches e2e
   `hasText: "Sync"`); topbar sync pill title `Sync / Conflicts · Review queue`
   (`data-testid="nav-sync-console"`); command palette aliases for Sync /
   Conflicts, Conflicts, and Review queue → `nav("sync")`.

2. **Fail-closed staleness banner** — `GET /api/sync/freshness` wraps
   `checkRoutingFreshness()` → `evaluateSyncFreshness` over required registers.
   Sync console fetches on mount; until an explicit `{ ok: true }` lands,
   resolutions stay paused. Banner copy: `sync stale — resolutions paused`
   (`data-testid="sync-stale-banner"`). Keep MC / Keep SharePoint / Retry push
   buttons are `disabled` while paused.

3. **Review queue path** — Console continues to read `openConflicts()` from the
   mc-data store (hydrated from `snapshot()` → `repo.openConflicts()`, not seed
   `SP_CONFLICTS` which is `[]`). Test seam `__setOpenConflictsForTests` injects
   a non-seed conflict for resolve coverage.

## Files (owns only)

| Path | Role |
|---|---|
| `src/components/mc/chrome.tsx` | Nav label + topbar discoverability |
| `src/components/mc/command-palette.tsx` | Conflicts / Review queue aliases |
| `src/components/mc/sync-console.tsx` | Banner + disable resolve when stale |
| `src/components/mc/sync-console.freshness.ts` | Fail-closed helpers + banner copy |
| `src/app/api/sync/freshness/route.ts` | Freshness API for the console |
| `src/lib/mc-data/store.ts` | `__setOpenConflictsForTests` seam |
| `tests/sync-console-staleness.test.ts` | Acceptance tests |

Forbidden paths untouched: `vercel.json`, `package.json`, `package-lock.json`,
`.cursor/mcp.json`, `src/lib/sync/engine.ts`.

## Acceptance

```text
npx vitest run tests/sync-console-staleness.test.ts  → 7 passed, exit 0
git diff --check                                     → exit 0
```

## Not done / deferred

- Full e2e conflict→resolve against live Graph (optional; unit path covers
  openConflicts + resolveConflict + freshness helpers).
- Server-side block of `POST /api/sync/conflicts/:id/resolve` when stale
  (UI fail-closed; engine resolve gate left for a later phase if needed).
