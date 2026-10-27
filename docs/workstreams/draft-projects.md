# Draft Projects

- Slug: `draft-projects` (this file is `docs/workstreams/draft-projects.md`)
- Owner: Vince · agents: Claude Code on the web
- Branches: `claude/brave-heisenberg-7t8mks` (step 1, TASK-4056)
- MC tasks: TASK-4056
- SharePoint handoff: n/a

## Goal

Let PLX members and their agents put a planned project, its buckets and tasks, and the research behind it into Mission Control as a draft. Reviewers check it, and its author accepts it into live work. The spec is [`docs/product/PRD-draft-projects.md`](../product/PRD-draft-projects.md).

## Status

active, as of 2026-10-27. Step 1, the PRD and this note, is in review on `claude/brave-heisenberg-7t8mks` (TASK-4056). Steps 2 and 3 have no MC task yet.

## Done

- None yet. Step 1 is open.

## Next steps

1. Land step 1 (TASK-4056).
2. Create the step 2 task in `BKT-MISSION-CONTROL-OPS`: migration, `src/lib/drafts`, the five MCP tools, REST routes, capabilities and `docs/modules/drafts/README.md`.
3. Before step 2 takes a migration number, check open PRs. #484 and #486 hold 054 and 055 today.
4. Step 3: the Drafts screen, Accept and Approvals rows. First decide the Accept open question in the PRD.

## Decisions and why

- 2026-10-27 The author accepts a draft. Why: the author owns the plan; an agent never accepts. Decided by: Vince.
- 2026-10-27 An unresolved blocking finding refuses Accept, with no minimum number of approvals. Why: it keeps review light. Tighten it if drafts get accepted unread. Decided by: Vince.
- 2026-10-27 Drafts are a convention for agents, not enforced. Why: enforcement would mean removing `project.create` and `bucket.create` from the agent bundle. Decided by: Vince.
- 2026-10-27 Draft visibility works like projects: shared by default, or restricted to members. Decided by: Vince.
- 2026-10-27 Mission Control only, with no VMC dependency. Why: VMC is deprecated. Decided by: Vince.
- 2026-10-27 Drafts live in their own tables, not as a status on `projects`. Why: live surfaces stay unchanged until Accept. Decided by: Claude (TASK-4056).
- 2026-10-27 The module contract lands with the step 2 code, not in step 1. Why: a contract must not describe a module that does not exist yet. Decided by: Claude (TASK-4056).

## Open questions

- How Accept closes the gap between a create and its record: a transaction through the create functions, or an idempotency claim per draft key. Ricardo or Stephen reviews the choice in step 3.

## Files / areas touched

- `docs/product/PRD-draft-projects.md`
- `docs/workstreams/draft-projects.md`, and its row in `docs/workstreams/README.md`

## How to run the tests

```bash
node scripts/workstream-note.mjs check
bash scripts/preflight.sh --mode pre-commit
```

## Blockers or dependencies on other workstreams

- Step 2 edits `src/lib/permissions/grants.ts`. PLX_MC PR #484 (TASK-4015) changes MCP principals and grants there. Build step 2 on top of #484 once it lands.

## Last updated

2026-10-27 by Claude Code (TASK-4056).
