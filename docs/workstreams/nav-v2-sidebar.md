# Nav v2 sidebar

- Slug: `nav-v2-sidebar` (this file is `docs/workstreams/nav-v2-sidebar.md`)
- Owner: Vince · agents: Claude Code on the web
- Branches: `claude/nav-v2-sidebar-2` (TASK-3956); `claude/nav-v2-sidebar` (merged, PR 468)
- MC tasks: TASK-3954, TASK-3955, TASK-3956, TASK-3957, TASK-3958, TASK-3959, TASK-3960, TASK-3961, TASK-3996
- SharePoint handoff: n/a

## Goal

Ship the v2 sidebar Vince approved on 2026-10-26 in both apps before the default flip
(TASK-3857): every active project A to Z, 10 stars (no tasks), an adjustable and collapsible
width, one row grid, figures for counts, and one keyboard tree.

## Status

active, as of 2026-10-26. The contract (TASK-3954) and the sidebar (TASK-3955, TASK-3996)
merged. TASK-3956 is built on `claude/nav-v2-sidebar-2`: Starred holds 10 screens, reports,
projects and initiatives (migration 053), each with its kind's icon and g digit, a star on every
sidebar row, Shift S, moving by Alt ↑ ↓ or the grip, closed, archived and deleted marks, and
Star this page and Edit starred in ⌘K. The migration needs a signed MC merge approval.

## Done

- TASK-3954: the contract, portal ADR-011's v2 amendment
  ([portal PR 3027](https://github.com/petralabx/plx-customer-portal/pull/3027), merged 2026-10-26).
- TASK-3955 and TASK-3996: the v2 sidebar, and Projects opens the project Dashboard
  ([PLX_MC PR 468](https://github.com/petralabx/PLX_MC/pull/468), merged 2026-10-26).

## Next steps

1. Land TASK-3956's PR after its signed MC merge approval; then DB Migrate on UAT runs 053.
2. TASK-3957: amend portal ADR-011 first (Width, the size table, and Starred 2: no tasks), then
   the width, 232 to 400px, snap to the rail, `[` to collapse.
3. TASK-3958: the `?` shortcuts sheet with its single-key off switch, and the page path.
4. TASK-3959 and TASK-3960: the portal's tokens (`--p-shell-sidebar-min: 232px`) and the MRP
   sidebar on the same grid.
5. TASK-3961: the tour, shown once at the flip.

## Decisions and why

- 2026-10-26 The ADR-011 amendment is the contract; the MC Sidebar v2 canvas draws it
  approximately. Why: tokens and the ADR outrank a drawing. Decided by: Vince.
- 2026-10-26 Open-task counts show only from live data. Why: cached or demo tasks would make
  them up, the rule `useNavCounts` already follows. Decided by: Claude (TASK-3955).
- 2026-10-26 Off track has its own colour in the count column: a square and figure in
  `--p-hot-text`, the brand's off-track colour (as on the health pills), apart from at-risk's
  amber. The row's name says "off track". Why: the amendment names at-risk only, and an
  off-track project must not look at-risk or fine. The brand has no red. Decided by: Vince.
- 2026-10-26 The Projects row opens the project Dashboard, and the Projects list page goes
  (TASK-3996). Reporting keeps its Dashboard row. Why: Vince does not want the list page.
  Decided by: Vince.
- 2026-10-26 Starred holds projects, initiatives, reports and screens, not tasks. Why: Vince
  stars what he navigates by; tasks come and go. ADR-011's Starred 2 still names tasks, so
  TASK-3957's amendment drops them. Decided by: Vince.
- 2026-10-26 The narrowest width is 232px, not 200px, so a label keeps about 92px; 400px
  widest, 248px by default, snap to the rail below 160px. Why: at 200px most project names
  truncate to a few letters. Decided by: Claude (Vince deferred to Claude).
- 2026-10-26 A deleted record's star shows as deleted, with Remove, only once the data is live;
  until then it does not show. Why: seed or cached records would make real ones look deleted.
  Decided by: Claude (TASK-3956).

## Open questions

- None.

## Files / areas touched

- `src/components/mc/chrome.tsx`, `nav-model.ts`, `count-badge.tsx`, `use-layer.ts`,
  `shell.tsx`, `work-views.tsx`, `filter-bar.tsx`, `projects-view.tsx`, `use-stars.ts`,
  `star-toggle.tsx`, `command-palette.tsx`, `more-sheet.tsx`
- `src/lib/mc-data/store.ts` (`closedNavProjects`); `src/lib/stars/`, `src/app/api/stars/route.ts`
- `db/migrations/053_nav_stars_cap_10.sql`, `db/rollback/053_nav_stars_cap_10_rollback.sql`
- `src/styles/mc-shell.css` (the zoned sidebar section)
- `tests/mc-nav-model.test.ts`, `tests/mc-sidebar.test.ts`, `tests/mc-stars.test.ts`,
  `tests/stars-routes.test.ts`, `tests/stars-postgres.test.ts`, `e2e/ui-shell-responsive.spec.ts`,
  `e2e/stars.spec.ts`

## How to run the tests

```bash
npm run typecheck && npm run lint
npx vitest run tests/mc-nav-model.test.ts tests/mc-sidebar.test.ts tests/mc-stars.test.ts tests/stars-routes.test.ts
npx playwright test e2e/ui-shell-responsive.spec.ts e2e/stars.spec.ts --project=chromium
```

## Blockers or dependencies on other workstreams

- TASK-3956's PR touches a migration, so it lands only with a signed MC merge approval.
- PLX_MC PR 463 holds migration 052; 053 is this workstream's. Neither depends on the other.

## Last updated

2026-10-26 by Claude Code (TASK-3956).
