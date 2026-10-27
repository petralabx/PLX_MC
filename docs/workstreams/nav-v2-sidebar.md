# Nav v2 sidebar

- Slug: `nav-v2-sidebar` (this file is `docs/workstreams/nav-v2-sidebar.md`)
- Owner: Vince · agents: Claude Code on the web
- Branches: `claude/nav-v2-sidebar-4` (TASK-3958); `claude/nav-v2-sidebar-3` (merged, PR 478);
  `claude/nav-v2-sidebar-2` (merged, PR 472); `claude/nav-v2-sidebar` (merged, PR 468)
- MC tasks: TASK-3954, TASK-4010, TASK-3955, TASK-3956, TASK-3957, TASK-3958, TASK-3959, TASK-3960, TASK-3961, TASK-3996
- SharePoint handoff: n/a

## Goal

Ship the v2 sidebar Vince approved on 2026-10-26 in both apps before the default flip
(TASK-3857): every active project A to Z, 10 stars (no tasks), an adjustable and collapsible
width, one row grid, figures for counts, and one keyboard tree.

## Status

active, as of 2026-10-27. The contract (TASK-3954, revised by TASK-4010), the sidebar (TASK-3955,
TASK-3996), Starred (TASK-3956) and the width (TASK-3957) merged; DB Migrate on UAT must run 053
before the live release. TASK-3958 is built on `claude/nav-v2-sidebar-4`: the page path in the top
bar (Plan / project / initiative, each a menu of its siblings) and the `?` shortcuts sheet with
its single-key switch.

## Done

- TASK-3954: the contract, portal ADR-011's v2 amendment
  ([portal PR 3027](https://github.com/petralabx/plx-customer-portal/pull/3027), merged 2026-10-26).
- TASK-3955 and TASK-3996: the v2 sidebar, and Projects opens the project Dashboard
  ([PLX_MC PR 468](https://github.com/petralabx/PLX_MC/pull/468), merged 2026-10-26).
- TASK-3956: Starred holds 10, g 1 to g 0, row stars, Shift S, moves, migration 053
  ([PLX_MC PR 472](https://github.com/petralabx/PLX_MC/pull/472), merged 2026-10-26).
- TASK-4010: ADR-011 revised: 232px narrowest, no task stars, off-track colour
  ([portal PR 3050](https://github.com/petralabx/plx-customer-portal/pull/3050), merged 2026-10-27).
- TASK-3957: the width, 232 to 400px, the splitter, the rail, `[`, MC ADR-006
  ([PLX_MC PR 478](https://github.com/petralabx/PLX_MC/pull/478), merged 2026-10-27).

## Next steps

1. Run DB Migrate on UAT for 053 (TASK-3956), then the live release.
2. Land TASK-3958's PR.
3. TASK-3959 and TASK-3960: the portal's tokens (`--p-shell-sidebar-min: 232px`) and the MRP
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
- 2026-10-27 Mission Control paints the width before first paint with a `<head>` script, not a
  cookie the server reads (MC ADR-006). Why: `/` is a static page; a cookie would make every
  visit render on the server to fix one CSS width. MRP keeps the cookie. Decided by: Claude
  (TASK-3957).
- 2026-10-27 The splitter is a tab stop of its own, after the sidebar and before the page.
  Why: ADR-011 Width 4 makes it a focusable window splitter, and that is where it sits.
  Decided by: Claude (TASK-3957).
- 2026-10-27 The page path sits in the top bar (ADR-011 zone 2), from 1025px, on project,
  initiative and task pages only. Why: the task asks for those pages; below 1025px the top bar
  has no room, and the sidebar is a rail or drawer there. Decided by: Claude (TASK-3958).
- 2026-10-27 The Help and shortcuts row opens the `?` sheet, which links on to the Help page.
  The single-key switch is kept per browser (`mc.keys.single`), not on the server. Why: the task
  asks the row to open the sheet, so a person can always turn the keys back on (ADR-011 Keys 8);
  a server copy would need a migration for one boolean. Decided by: Claude (TASK-3958).
- 2026-10-26 A deleted record's star shows as deleted, with Remove, only once the data is live;
  until then it does not show. Why: seed or cached records would make real ones look deleted.
  Decided by: Claude (TASK-3956).

## Open questions

- None.

## Files / areas touched

- `src/components/mc/chrome.tsx`, `nav-model.ts`, `count-badge.tsx`, `use-layer.ts`,
  `shell.tsx`, `work-views.tsx`, `filter-bar.tsx`, `projects-view.tsx`, `use-stars.ts`,
  `star-toggle.tsx`, `command-palette.tsx`, `more-sheet.tsx`, `top-bar.tsx`, `use-flyout.ts`,
  `side-boot.ts`, `side-width.ts`, `side-resize.tsx`, `shortcuts.ts`, `shortcuts-sheet.tsx`;
  `src/app/layout.tsx` (the boot script)
- `src/lib/mc-data/store.ts` (`closedNavProjects`); `src/lib/stars/`, `src/app/api/stars/route.ts`
- `db/migrations/053_nav_stars_cap_10.sql`, `db/rollback/053_nav_stars_cap_10_rollback.sql`
- `src/styles/mc-shell.css` (the zoned sidebar section)
- `tests/mc-nav-model.test.ts`, `tests/mc-sidebar.test.ts`, `tests/mc-stars.test.ts`,
  `tests/stars-routes.test.ts`, `tests/stars-postgres.test.ts`, `tests/mc-side-width.test.ts`,
  `tests/mc-shortcuts-path.test.ts`, `e2e/ui-shell-responsive.spec.ts`, `e2e/stars.spec.ts`,
  `e2e/side-width.spec.ts`, `e2e/shortcuts-path.spec.ts`

## How to run the tests

```bash
npm run typecheck && npm run lint
npx vitest run tests/mc-nav-model.test.ts tests/mc-sidebar.test.ts tests/mc-stars.test.ts tests/stars-routes.test.ts tests/mc-side-width.test.ts tests/mc-shortcuts-path.test.ts
npx playwright test e2e/ui-shell-responsive.spec.ts e2e/stars.spec.ts e2e/side-width.spec.ts e2e/shortcuts-path.spec.ts --project=chromium
```

## Blockers or dependencies on other workstreams

- TASK-3956's PR touches a migration, so it lands only with a signed MC merge approval.
- PLX_MC PR 463 holds migration 052; 053 is this workstream's. Neither depends on the other.

## Last updated

2026-10-27 by Claude Code (TASK-3958).
