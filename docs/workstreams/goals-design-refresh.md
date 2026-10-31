# Goals and project page design refresh

- Slug: `goals-design-refresh` (this file is `docs/workstreams/goals-design-refresh.md`)
- Owner: Vince · operator: CoS (cos@petrasoap.com) · agents: claude/friendly-gates-2br59z
- Branches: `claude/friendly-gates-2br59z`
- MC tasks: TASK-4373, TASK-4385, TASK-4391; decision TASK-4387; project page TASK-4390, TASK-4392, TASK-4393
- SharePoint handoff: n/a

## Goal

Build the 2026-10-31 design canvas for Goals & production and the project page, one PR per slice. The canvas and its amendments note are on claude.ai (private to CoS): the Goals prototype, the project page prototype, and the "What we adopt" board.

## Status

active, as of 2026-10-31. Slices 1 to 3 landed in PLX_MC #543 (merge `bd0ea88`). The project-page work (TASK-4390 rich text, TASK-4392 Due filter, TASK-4393 the wiring e2e fix) is the open PR from `claude/friendly-gates-2br59z`. Vince approved decision 9 (TASK-4387), so slice 4 comes next.

## Done

- Slice 1, TASK-4373: Revenue → How it adds up. The card keeps its headline, split, bar, due so far and needed per day. The equation lines, returns, shipped-not-invoiced, product lines, currencies and data notes moved to the tab, to the cent. It follows `scope=mfg`, the salespeople and the rate. No query, API, schema or colour change.
- Slice 2, TASK-4385: the salesperson list view (search, Clear, picked first, Done, Escape; "Pick all shown" only on a search).
- Slice 3, TASK-4391: a date range for the whole report (`dates=mtd|week|7d|from..to`), narrowed like the salesperson filter. Partial pages show figures without the goal; the forecast and potential revenue stay the whole month's; days that split the month add up to it. The workbook follows the days.
- Slices 1 to 3 landed in PLX_MC #543.

## Next steps

1. Land the project-page PR: TASK-4390, TASK-4392, TASK-4393.
2. Slice 4: tokens v1.7.0 (the vibrant status set and `--p-hand` violet) in the portal's `design-system/tokens.css`, with a validated dark pass. Then mirror it in PLX_MC `src/styles/brand-tokens.css`, turn Goals by-hand figures violet, and move data notes off amber.

## Decisions and why

- 2026-10-31 Goals keeps its tabs (TASK-4094); the breakdown is a tab, not a card drawer. Why: the cards sit in a sticky header capped at 38% of the screen. Decided by: CoS (plan approval).
- 2026-10-31 How it adds up is the default tab; By class moves to `tab=classes`. Why: CoS asked to see this detail under the Revenue card. Decided by: CoS (plan approval).
- 2026-10-31 Slice 1 changes no colours. Data notes keep today's amber. Why: the palette change needs Vince's decision 9. Decided by: CoS (plan approval).
- 2026-10-31 The picker has no plain "Select all": picking every salesperson and "no salesperson" narrows the page to every customer but hides the goal status, so Clear covers it, and "Pick all shown" works on a search. Decided by: claude/friendly-gates-2br59z (slice 2 build).
- 2026-10-31 Date presets resolve on the server against the run's date, so a shared `dates=week` link stays "this week" after the next refresh. The goals stay the whole month's: no pro-rating to a range. Decided by: claude/friendly-gates-2br59z (slice 3 spec).
- 2026-10-31 The project status sections come from the project description, which TASK-4390 renders as structured text; the Status and Dates filters are the existing task filter plus a Due filter (TASK-4392). No new status store or migration. Decided by: claude/friendly-gates-2br59z.
- 2026-10-31 Project resources already sit under the strip in production. Nothing to build. Why: `project-detail.tsx` renders the strip, then `pv-res`. Decided by: claude/friendly-gates-2br59z (code read).
- 2026-10-31 Decision 9: adopt the vibrant status set (each with a shape and a word) and violet for figures entered by hand, as tokens v1.7.0. It replaces the ADR-001 "no saturated alarm hues" rule and the ADR-004 "`--p-hot` is destructive only" rule. Decided by: Vince (TASK-4387).

## Open questions

- None.

## Files / areas touched

- `src/components/mc/goals/` (goal-cards, revenue-breakdown, salespeople, dates, tabs, index)
- `src/lib/reporting/goals/` (class-totals, date-filter, view, rules, the workbook export)
- `src/components/mc/mc-text.tsx`, `src/lib/mc-text/`, and the project, bucket, task and approvals screens that use it
- `src/components/mc/project-overview.tsx` and `task-filter.tsx` (the Due filter)
- `src/styles/mc-goals.css`, `mc-text.css`, `mc-overview.css`
- The Goals, project and approvals tests and Playwright specs

## How to run the tests

```bash
npm run typecheck
npm run lint
npx vitest run tests/reporting-goals-*.test.ts
npx vitest run tests/mc-text.test.ts tests/mc-project-overview.test.ts
node scripts/run-playwright.mjs --project=chromium e2e/goals.spec.ts e2e/goals-nav.spec.ts e2e/goals-returns.spec.ts e2e/goals-pending-shipments.spec.ts e2e/goals-scope.spec.ts e2e/goals-rate.spec.ts e2e/goals-salespeople.spec.ts e2e/goals-dates.spec.ts
node scripts/run-playwright.mjs --project=chromium e2e/mc-text.spec.ts e2e/project-due.spec.ts e2e/ui-project-wiring.spec.ts
```

## Blockers or dependencies on other workstreams

- None. The PLX_MC part of slice 4 follows the portal tokens v1.7.0 PR.

## Last updated

2026-10-31 by claude/friendly-gates-2br59z (CoS session).
