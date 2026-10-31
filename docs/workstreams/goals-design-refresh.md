# Goals and project page design refresh

- Slug: `goals-design-refresh` (this file is `docs/workstreams/goals-design-refresh.md`)
- Owner: Vince · operator: CoS (cos@petrasoap.com) · agents: claude/friendly-gates-2br59z
- Branches: `claude/friendly-gates-2br59z`
- MC tasks: TASK-4373
- SharePoint handoff: n/a

## Goal

Build the 2026-10-31 design canvas for Goals & production and the project page, one PR per slice. The canvas and its amendments note are on claude.ai (private to CoS): the Goals prototype, the project page prototype, and the "What we adopt" board.

## Status

active, as of 2026-10-31. Slice 1 (TASK-4373) is built on `claude/friendly-gates-2br59z`: the Revenue card links to a new default tab, Revenue → How it adds up.

## Done

- Slice 1, TASK-4373: Revenue → How it adds up. The card keeps its headline, split, bar, due so far and needed per day. The equation lines, returns, shipped-not-invoiced, product lines, currencies and data notes moved to the tab, to the cent. It follows `scope=mfg`, the salespeople and the rate. No query, API, schema or colour change.

## Next steps

1. Land slice 1, then restart the branch from `main` for slice 2.
2. Slice 2: the salesperson list-view picker in `src/components/mc/goals/salespeople.tsx` (search, Select all, Clear, picked on top, customer counts). Same `sales=` parameter.
3. Slice 3: a date range for the whole report. Write a one-page spec first: how Line 1, truckloads and the forecast read inside a range. Narrow the run the way `filterRunBySalespeople` does.
4. Slice 4: the vibrant status colours and the violet by-hand colour. It waits on Vince's decision 9. It ships as tokens v1.7.0 in PLX_MC and the portal.
5. Slice 5: project status sections with Status and Dates filters. It needs a spec for where project status lives and who writes it.

## Decisions and why

- 2026-10-31 Goals keeps its tabs (TASK-4094); the breakdown is a tab, not a card drawer. Why: the cards sit in a sticky header capped at 38% of the screen. Decided by: CoS (plan approval).
- 2026-10-31 How it adds up is the default tab; By class moves to `tab=classes`. Why: CoS asked to see this detail under the Revenue card. Decided by: CoS (plan approval).
- 2026-10-31 Slice 1 changes no colours. Data notes keep today's amber. Why: the palette change needs Vince's decision 9. Decided by: CoS (plan approval).
- 2026-10-31 Project resources already sit under the strip in production. Nothing to build. Why: `project-detail.tsx` renders the strip, then `pv-res`. Decided by: claude/friendly-gates-2br59z (code read).

## Open questions

- Decision 9, the status palette and by-hand violet: Vince.
- Where project status lives (a field, a document, or MC events) and who writes it: Vince or CoS.

## Files / areas touched

- `src/components/mc/goals/` (goal-cards, revenue-breakdown, tabs, index)
- `src/styles/mc-goals.css`
- Goals vitest files and the goals Playwright specs

## How to run the tests

```bash
npm run typecheck
npm run lint
npx vitest run tests/reporting-goals-*.test.ts
node scripts/run-playwright.mjs --project=chromium e2e/goals.spec.ts e2e/goals-nav.spec.ts e2e/goals-returns.spec.ts e2e/goals-pending-shipments.spec.ts e2e/goals-scope.spec.ts e2e/goals-rate.spec.ts
```

## Blockers or dependencies on other workstreams

- None for slice 1. Slice 4 waits on Vince's decision 9.

## Last updated

2026-10-31 by claude/friendly-gates-2br59z (CoS session).
