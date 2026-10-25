# Module: ci-scorecard

## What

The CI scorecard (TASK-3913): each week's CI numbers for the petralabx repos,
graded against the targets of the 2026-10 CI redesign, per repo and for the
fleet, with the trend across weeks. This module owns the rubric (metrics,
targets, grades, score), the stored weekly snapshots, `POST
/api/cursor/ci-scorecard`, `GET /api/ci-scorecard` and the CI scorecard screen.
It does not measure anything itself: agentic-swarm's
`scripts/ci-audit/weekly_metrics.py` does, and the Monday CI metrics task posts
its output (TASK-3866).

## Why

Vince asked on 2026-10-25 for score cards that grade the CI pipeline in a
Mission Control view, so the team can see whether each change helps and improve
the pipeline over time. Before this, the weekly numbers landed as a note on
TASK-3866, with no grade against the targets and no trend.

## How

1. **Snapshot** — `schema.ts`: the zod schema of `weekly_metrics.py --json`
   (window, per-repo sections, read errors). Loose objects keep every field the
   script writes, so a later rubric can grade stored weeks again. The
   point-in-time sections (`open`, `bypass_merges`) are null for a window that
   ended in the past. Kept apart from `index.ts` so the screen's bundle carries
   no zod.
2. **Store** — `store.ts` (server-only): one append-only `mc_events` row per
   snapshot, kind `ci.scorecard.snapshot`, through `appendEvent`. The dedup key
   is the exact window, so a replay is a no-op and a fresh run of the same week
   appends and wins. No migration: `mc_events` already has the unique
   `dedup_key` index. Without `PLX_MC_DATABASE_URL` it falls back to
   process-local memory (the stars and vendor-spend contract).
3. **Rubric** — `index.ts` (client-safe, no runtime imports):
   `REPO_METRICS` and `FLEET_METRICS`, each with its targets by phase, taken
   from the report's success criteria (agentic-swarm
   `docs/ci-redesign-2026-10.md`, section 3.6). Phase 2 keeps every phase 1
   target that it does not tighten. `CURRENT_PHASE` is 1; set it to 2 when
   phase 2 of the org ruleset is imported. A value at or under its target is
   **met**, within 1.5× a non-zero target **near**, otherwise **missed**; a
   target of 0 has no near band. The score counts met as 1 and near as a half
   over the graded metrics (0 to 100), with A from 90, B 80, C 70, D 60.
   `buildScorecard` keeps the latest snapshot of each ISO week (by window end)
   and compares each row with the week before.
4. **API** — `POST /api/cursor/ci-scorecard` (`mc_report_ci_scorecard`, REST
   only, `telemetry.report`): `{ snapshot }`, at most 256 KiB; returns
   `recorded`, `noop`, the window and the week's overall score. `GET
   /api/ci-scorecard` (session `task.read`): `{ phase, latest, history }`;
   `?weeks=1..52` (default 12) bounds the history.
5. **Screen** — `src/components/mc/ci-scorecard/` (`/?screen=ci-scorecard`;
   Reporting in the zoned sidebar, Admin & health in the classic one): the
   overall letter and score, the weekly score trend, one card per repo and one
   for the fleet (value, grade, target, next phase's target, previous week), and
   how grading works.

## Dependencies

- `compliance` (`appendEvent`, `eventsByKinds` on `mc_events`), `secrets`
  (`databaseConfigured`), `mcp` (the cursor route wrapper and
  `requireMcpActor`), `api/route`, `routing` (`requireSessionActor`).
- The web module's chart kit (`src/components/mc/charts`).
- Fed by agentic-swarm's `scripts/ci-audit/weekly_metrics.py`, through the
  Monday CI metrics task.

### Key Files

- `src/lib/ci-scorecard/index.ts` — the rubric, grading and `buildScorecard` (client-safe).
- `src/lib/ci-scorecard/schema.ts` — the snapshot's zod schema.
- `src/lib/ci-scorecard/store.ts` — `recordSnapshot`, `listSnapshots`, memory fallback.
- `src/lib/mcp/ci-scorecard-actions.ts` — `mc_report_ci_scorecard`.
- `src/app/api/cursor/ci-scorecard/route.ts`, `src/app/api/ci-scorecard/route.ts` — the API.
- `src/components/mc/ci-scorecard/` — the screen and its helpers.
- `tests/ci-scorecard.test.ts`, `tests/ci-scorecard-routes.test.ts`,
  `tests/ci-scorecard-ui.test.ts` — rubric, API and screen.

## Owner

Vince Alton

## Criticality

Low — a missing week leaves a gap in the trend, and nothing gates on the
scorecard. A rubric change regrades every stored week, so change targets only
with the report's decision record.
