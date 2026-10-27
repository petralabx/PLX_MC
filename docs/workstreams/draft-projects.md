# Draft Projects

- Slug: `draft-projects` (this file is `docs/workstreams/draft-projects.md`)
- Owner: Vince · agents: Claude Code on the web
- Branches: `claude/brave-heisenberg-7t8mks` (step 1 merged as #487, TASK-4056; step 2, TASK-4059)
- MC tasks: TASK-4056, TASK-4059
- SharePoint handoff: n/a

## Goal

Let PLX members and their agents put a planned project, its buckets and tasks, and the research behind it into Mission Control as a draft. Reviewers check it, and its author accepts it into live work. The spec is [`docs/product/PRD-draft-projects.md`](../product/PRD-draft-projects.md).

## Status

active, as of 2026-10-27. Step 1 (PRD) merged. Step 2 (storage, the five agent tools, capabilities; TASK-4059) is built on `claude/brave-heisenberg-7t8mks` and waits on review and a signed MC merge approval, because it adds migration 056. Step 3 has no MC task yet.

## Done

- TASK-4056: the PRD and this note ([PLX_MC PR 487](https://github.com/petralabx/PLX_MC/pull/487)).
- TASK-4059 (in review): migration `056_drafts.sql`, `src/lib/drafts`, `mc_save_draft`, `mc_submit_draft`, `mc_get_draft`, `mc_list_drafts`, `mc_review_draft` on HTTP MCP, stdio and `/api/cursor/drafts`, capabilities `draft.create`, `draft.review`, `draft.accept`, the module contract `docs/modules/drafts/README.md`.

## Next steps

1. Land step 2: review, the signed MC merge approval of its exact head (Ricardo, Rishi or Stephen; Vince last), then the merge queue.
2. Run DB Migrate (live release) for 056. Production deploys wait on it.
3. Step 3: create its MC task. Build the Drafts screen, Accept (through `createProject`, `createBucket`, `createTask`) and the Approvals rows. Decide the Accept open question first. No migration is needed: 056 has the columns.
4. Turn the feature on: `PLX_MC_DRAFTS_ENABLED=1` on the MC deployment, or make it the default in step 3.

## Decisions and why

- 2026-10-27 The author accepts a draft. Why: the author owns the plan; an agent never accepts. Decided by: Vince.
- 2026-10-27 An unresolved blocking finding refuses Accept, with no minimum number of approvals. Why: it keeps review light. Tighten it if drafts get accepted unread. Decided by: Vince.
- 2026-10-27 Drafts are a convention for agents, not enforced. Why: enforcement would mean removing `project.create` and `bucket.create` from the agent bundle. Decided by: Vince.
- 2026-10-27 Draft visibility works like projects: shared by default, or restricted to members. Decided by: Vince.
- 2026-10-27 Mission Control only, with no VMC dependency. Why: VMC is deprecated. Decided by: Vince.
- 2026-10-27 Drafts live in their own tables, not as a status on `projects`. Why: live surfaces stay unchanged until Accept. Decided by: Claude (TASK-4056).
- 2026-10-27 Migration 056 carries the accept and `materialized` columns too. Why: step 3 then needs no migration and no second signed approval. Decided by: Claude (TASK-4059).
- 2026-10-27 An agent edits only drafts it wrote for the same person, and never dismisses a finding. Why: the operator email is caller-chosen; the principal binds the edit, and dismissal is the author's call in person. Decided by: Claude (TASK-4059).
- 2026-10-27 Everything is off until `PLX_MC_DRAFTS_ENABLED=1`. Why: the flag is the kill switch, and nothing touches the tables while it is off. Decided by: Claude (TASK-4059).

## Open questions

- How Accept closes the gap between a create and its record: a transaction through the create functions, or an idempotency claim per draft key. Ricardo or Stephen reviews the choice in step 3.

## Files / areas touched

- `docs/product/PRD-draft-projects.md`, `docs/product/DATA_MODEL.md`
- `docs/modules/drafts/`, and the drafts rows in `docs/modules/README.md` and `AGENTS.md`; `docs/modules/mcp/README.md`, `docs/modules/permissions/README.md`
- `db/migrations/056_drafts.sql`, `db/rollback/056_drafts_rollback.sql`
- `src/lib/drafts/`, `src/lib/mcp/draft-actions.ts`, `src/app/api/cursor/drafts/`, `src/lib/permissions/`
- `tools/plx-mc-mcp/` (stdio tools)

## How to run the tests

```bash
npx vitest run tests/drafts.test.ts tests/mcp-drafts.test.ts
npx vitest run tests/drafts-postgres.test.ts   # needs Docker (CI) or a local PG16
node scripts/workstream-note.mjs check
bash scripts/preflight.sh --mode pre-commit
```

## Blockers or dependencies on other workstreams

- Step 2 needs a signed MC merge approval (migration). Production then needs DB Migrate for 056.

## Last updated

2026-10-27 by Claude Code (TASK-4059).
