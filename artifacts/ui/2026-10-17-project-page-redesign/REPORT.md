# Project page redesign — review notes (TASK-3174)

## What changed

- The overview strip replaces the 7-cell facts grid. It shows health, owner, started and target. It compares closed % with elapsed % and shows a pace chip.
- Project resource tiles replace the Documents & links list. The five SharePoint registers come from one shared list.
- The Overview lens has an Outstanding / Needs a human / All filter. It also has expand all, collapse all, an 8-row cap and a closed-rows reveal.
- Each initiative header shows a two-line title and the spec link or "+ Add spec".
- The task table tiers by its own width with container queries. Below 600px it shows two-line card rows.

## Verification

1. Run `npm run typecheck`. It exits 0.
2. Run `npx vitest run tests/mc-project-overview.test.ts tests/mc-doc-links.test.ts`. All 31 tests pass.
3. Run the full Playwright suite. 349 tests pass and 5 skip.
4. Run `npm run build`. It exits 0.

## Design deltas

- Fixture tasks are all open, so the closed reveal and "Show all" footers do not appear in these shots.
- The seed target is Oct 01, so the pace chip reads "Target passed". The handoff calls this intended.
- A "No owner" tag marks open tasks without a human accountable owner. The handoff has no such tag.
- Project Plan, Roadmap, Milestone Register and Risk Register tiles have no URL yet. They match the initiative page ("coming soon").
