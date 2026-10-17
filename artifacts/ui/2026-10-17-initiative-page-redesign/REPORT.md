# Initiative page redesign — review notes (TASK-3175)

## What changed

- The header kicker shows the initiative id, the parent project link and the spec link.
- The spec link opens the spec file in a new tab. "+ Add spec" or the pencil opens the PRD link field.
- The standalone "/ Spec" block is gone.
- The shared overview strip replaces the facts grid. It has 3×2 facts: health, owner, project, started and target.
- The tasks block uses the shared task filter and the shared tiered task table.
- The body splits into two columns at 1100px of main-content width. Below that, the aside stacks under the tasks.
- The aside lists documents and links with source tags, including each GitHub repo. Milestones, risks and traceability follow.

## Verification

1. Run `npm run typecheck`. It exits 0.
2. Run `npx vitest run tests/mc-initiative-page.test.ts`. All 7 tests pass.
3. Open `/?screen=bucket&bucketId=BKT-WMS` at 1440, 1920, 820 and 390px wide.
4. Check that the page has no horizontal scroll at each width.

## Design deltas

- Fixture tasks are all open, so the closed reveal and "Show all" footers do not appear in these shots.
- The seed target is Jun 15, so the pace chip reads "Target passed". The handoff calls this intended.
- Milestones have no "Done" state in the data model, so only Active, At risk and Upcoming pills appear.
- The "Register →" links are left out. The SharePoint registers have no URL yet.
