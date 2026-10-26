# Nav v2 sidebar

- Slug: `nav-v2-sidebar` (this file is `docs/workstreams/nav-v2-sidebar.md`)
- Owner: Vince · agents: Claude Code on the web
- Branches: `claude/exciting-keller-c1t6o5`
- MC tasks: TASK-3954, TASK-3955, TASK-3956, TASK-3957, TASK-3958, TASK-3959, TASK-3960, TASK-3961
- SharePoint handoff: n/a

## Goal

Ship the v2 sidebar Vince approved on 2026-10-26 in both apps before the default flip
(TASK-3857): every active project A to Z, 10 stars of any kind, an adjustable and collapsible
width, one row grid, figures for counts, and one keyboard tree.

## Status

active, as of 2026-10-26. The contract (TASK-3954) merged. TASK-3955 is built on this branch:
the zoned sidebar's row grid, every active project A to Z, the Projects filter, the Closed row,
one + on Projects, open-task counts, figures in the count column and the keyboard tree.

## Done

- TASK-3954: the contract, portal ADR-011's v2 amendment
  ([portal PR 3027](https://github.com/petralabx/plx-customer-portal/pull/3027), merged 2026-10-26).

## Next steps

1. Land TASK-3955's PR.
2. TASK-3956: Starred holds 10 of any kind, tasks included, g 1 to g 0 (migration 051).
3. TASK-3957: the width, 200 to 400px, snap to the rail, `[` to collapse.
4. TASK-3958: the `?` shortcuts sheet with its single-key off switch, and the page path.
5. TASK-3959 and TASK-3960: the portal's tokens and the MRP sidebar on the same grid.
6. TASK-3961: the tour, shown once at the flip.

## Decisions and why

- 2026-10-26 The ADR-011 amendment is the contract; the MC Sidebar v2 canvas draws it
  approximately. Why: tokens and the ADR outrank a drawing. Decided by: Vince.
- 2026-10-26 Open-task counts show only from live data. Why: cached or demo tasks would make
  them up, the rule `useNavCounts` already follows. Decided by: Claude (TASK-3955).
- 2026-10-26 Off-track projects and initiatives get the same warn square as at-risk ones, and
  their row's name says "off track". Why: the amendment names at-risk only, and dropping the
  health tick must not hide an off-track project. Decided by: Claude (TASK-3955).

## Open questions

- Should the narrowest width be 232px instead of 200px, so the label keeps about 92px?
  Vince decides before TASK-3957.

## Files / areas touched

- `src/components/mc/chrome.tsx`, `nav-model.ts`, `count-badge.tsx`, `use-layer.ts`,
  `shell.tsx`, `work-views.tsx`, `filter-bar.tsx`, `projects-view.tsx`
- `src/lib/mc-data/store.ts` (`closedNavProjects`)
- `src/styles/mc-shell.css` (the zoned sidebar section)
- `tests/mc-nav-model.test.ts`, `tests/mc-sidebar.test.ts`, `e2e/ui-shell-responsive.spec.ts`

## How to run the tests

```bash
npm run typecheck && npm run lint
npx vitest run tests/mc-nav-model.test.ts tests/mc-sidebar.test.ts
npx playwright test e2e/ui-shell-responsive.spec.ts -g "zoned sidebar" --project=chromium
```

## Blockers or dependencies on other workstreams

- None. TASK-3956 to TASK-3961 follow TASK-3955 in order.

## Last updated

2026-10-26 by Claude Code (TASK-3955).
