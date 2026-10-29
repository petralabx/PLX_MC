# Draft Projects

- Slug: `draft-projects` (this file is `docs/workstreams/draft-projects.md`)
- Owner: Vince · agents: Claude Code on the web
- Branches: `claude/brave-heisenberg-7t8mks` (step 1 merged as #487, TASK-4056; step 2 merged as #489, TASK-4059; step 3 merged as #492, TASK-4071; New draft form slice A merged as #497 and #499, TASK-4109; slice B merged as #503, TASK-4110)
- MC tasks: TASK-4056, TASK-4059, TASK-4071, TASK-4109, TASK-4110, TASK-4129 to TASK-4132, TASK-4135
- SharePoint handoff: n/a

## Goal

Let PLX members and their agents put a planned project, its buckets and tasks, and the research behind it into Mission Control as a draft. Reviewers check it, and its author accepts it into live work. The spec is [`docs/product/PRD-draft-projects.md`](../product/PRD-draft-projects.md).

## Status

done, as of 2026-10-29. Steps 1 to 3, the New draft form (slices A and B) and every follow-up (skills, artifact uploads, the governance rule, review pages) are merged and live on https://mc.plxcustomer.io (DB Migrate applied 055 and 056 on 2026-10-27). Review pages stay off until an operator turns them on.

## Done

- TASK-4056: the PRD and this note ([PLX_MC PR 487](https://github.com/petralabx/PLX_MC/pull/487)).
- TASK-4059: migration `056_drafts.sql`, `src/lib/drafts`, `mc_save_draft`, `mc_submit_draft`, `mc_get_draft`, `mc_list_drafts`, `mc_review_draft` on HTTP MCP, stdio and `/api/cursor/drafts`, capabilities `draft.create`, `draft.review`, `draft.accept`, the module contract `docs/modules/drafts/README.md` ([PLX_MC PR 489](https://github.com/petralabx/PLX_MC/pull/489)).
- TASK-4071: the Drafts screen (`src/components/mc/drafts.tsx`), session routes under `/api/drafts`, Accept (`src/lib/drafts/accept.ts`), the Drafts to review panel on Approvals, the Drafts nav item. Drafts are on unless `PLX_MC_DRAFTS_ENABLED=0` ([PLX_MC PR 492](https://github.com/petralabx/PLX_MC/pull/492)). Production checked on 2026-10-27: `/api/drafts` answers with the sign-in envelope, `GET /api/cursor/drafts` with an MC key returns 200, and `?screen=drafts` goes to sign-in.
- TASK-4109, slice A of the New draft form: the form for settings, the plan and core research (`src/components/mc/draft-editor.tsx`), and the session routes to create, save, submit and withdraw ([PLX_MC PR 497](https://github.com/petralabx/PLX_MC/pull/497); review follow-up [PLX_MC PR 499](https://github.com/petralabx/PLX_MC/pull/499)).
- TASK-4110, slice B of the New draft form: risks, open questions and artifacts in the form, the dependency picker, and reordering buckets and tasks ([PLX_MC PR 503](https://github.com/petralabx/PLX_MC/pull/503)).
- TASK-4129: `project-researcher` and `guided-project-discovery` save a plan as a draft ([petralabx/skills PR 48](https://github.com/petralabx/skills/pull/48), release 1.6.15).
- TASK-4130 and TASK-4131: artifact uploads, as the agent tool `mc_upload_draft_artifact` and from the New draft form ([PLX_MC PR 505](https://github.com/petralabx/PLX_MC/pull/505)).
- TASK-4132: the governance-contract rule "Plans go through a draft" and the skills catalog pin to 1.6.15 ([PLX_MC PR 507](https://github.com/petralabx/PLX_MC/pull/507)).
- Production smoke test, 2026-10-29, through the agent API (approved by Vince): DRF-1, "DRF smoke test (Claude)", was created and submitted (version 1). Its upload stored `smoke-test.svg` in the Mission Control library under `Drafts/DRF-1/` and returned it to drafting. The same file again was a duplicate. The review page answered 503 `draft_pages_off`. It was then withdrawn with that reason. Uploads work on production.
- TASK-4135: review pages: `mc_render_draft_page`, `mc_publish_draft_page` and the comment relay on `mc_review_draft`, with the page link and relayed comments on the Drafts screen ([PLX_MC PR 508](https://github.com/petralabx/PLX_MC/pull/508)).

## Next steps

1. A signed-in check of the Drafts screen on production: list, record, review, Accept, and the New draft form. The server side is proven (see Done: the smoke test); the screens need a person.
2. Turn review pages on: an operator sets `PLX_MC_DRAFT_PAGES_ENABLED=1`. The first draft published as a page, and its first relayed comment, are the test. The steps are in `docs/modules/drafts/README.md` ("Review pages").

## Decisions and why

- 2026-10-27 The author accepts a draft. Why: the author owns the plan; an agent never accepts. Decided by: Vince.
- 2026-10-27 An unresolved blocking finding refuses Accept, with no minimum number of approvals. Why: it keeps review light. Tighten it if drafts get accepted unread. Decided by: Vince.
- 2026-10-27 Drafts are a convention for agents, not enforced. Why: enforcement would mean removing `project.create` and `bucket.create` from the agent bundle. Decided by: Vince.
- 2026-10-27 Draft visibility works like projects: shared by default, or restricted to members. Decided by: Vince.
- 2026-10-27 Mission Control only, with no VMC dependency. Why: VMC is deprecated. Decided by: Vince.
- 2026-10-27 Drafts live in their own tables, not as a status on `projects`. Why: live surfaces stay unchanged until Accept. Decided by: Claude (TASK-4056).
- 2026-10-27 Migration 056 carries the accept and `materialized` columns too. Why: step 3 then needs no migration and no second signed approval. Decided by: Claude (TASK-4059).
- 2026-10-27 An agent edits only drafts it wrote for the same person, and never dismisses a finding. Why: the operator email is caller-chosen; the principal binds the edit, and dismissal is the author's call in person. Decided by: Claude (TASK-4059).
- 2026-10-27 Step 2 shipped with drafts off until `PLX_MC_DRAFTS_ENABLED=1`. Why: without the screen and Accept, nobody could finish a draft. Decided by: Claude (TASK-4059).
- 2026-10-27 Step 3 turns drafts on by default; `PLX_MC_DRAFTS_ENABLED=0` is the kill switch. Why: the screen and Accept complete the flow, and an opt-in flag would leave it unused. Decided by: Claude (TASK-4071).
- 2026-10-27 Accept closes the create-to-record gap without changing the create functions: a task's record commits with the task, a project or bucket is adopted by its PRD link on a retry, and a claim refuses a parallel Accept and any edit or review while it runs. Why: changing `createProject` and `createBucket` to take a caller's transaction touches every create path. Decided by: Claude (TASK-4071); Ricardo or Stephen reviews it on the PR.
- 2026-10-27 Review on a shared page is a follow-up, after step 3 is live and in use. Mission Control stays the record: page comments come back one way as non-blocking reviews, and blocking findings and Accept stay in Mission Control. Why: people outside Mission Control can review without a second source of truth. Decided by: Vince (the follow-up); Claude (the design, in the PRD).
- 2026-10-27 Once an Accept has claimed a draft, its content is pinned until an Accept finishes (409 `accept_unfinished`); `accepted_by` stays set after a failure and holds the pin, so no migration is needed. A bucket's PRD link carries its draft key (`#B1`), and a retry checks the project and each recorded bucket's parent again. Why: the sol-6.1 reviews of step 3 found that a retry could pair version 1's records with version 2's content, merge two same-name buckets, or let a removed author keep writing. Decided by: Claude (TASK-4071).
- 2026-10-27 A person writes a draft through their agent in step 3; a "New draft" form is a follow-up. Why: the tools already validate a whole draft, and an editor is a large screen of its own. Decided by: Claude (TASK-4071).
- 2026-10-28 The New draft form ships in two PRs: slice A (session routes, and the form for the settings, the plan and the research submit needs) and slice B (risks, open questions, artifacts, polish). Why: step 3 took three review rounds as one PR, and a person can write and submit a complete draft after slice A. Decided by: Vince.
- 2026-10-28 A form save and submit carry an edit base (the working copy's digest, visibility, members and reviewers) and refuse with 409 `draft_changed` once the draft has moved; a review does not move it. Why: an agent and its person can both write a draft, and each save replaces whole sections. Decided by: Claude (TASK-4109).
- 2026-10-28 The form's Save sits at the end of the form, not in a sticky bar. Why: on a phone a sticky bar sits on the tab bar, and the list of what submit needs can be long. Decided by: Claude (TASK-4109).
- 2026-10-29 Review pages start now, with safe defaults: only Petra people's comments come back, Claude Artifacts only, a page comment never blocks, a restricted draft is never published, and pages are off until an operator sets `PLX_MC_DRAFT_PAGES_ENABLED=1`. Why: it opens review to Petra people outside Mission Control without a second source of truth, and each default can be loosened later. Decided by: Vince (TASK-4135).
- 2026-10-29 A page link and a relayed comment live among a draft's reviews (`source: "page"`, `source: "artifact"`), and a relay names the version its page showed. Why: reviews are jsonb, so there is no migration, and a republished artifact keeps its link across versions. Decided by: Claude (TASK-4135).

## Open questions

- None open. The Accept design is recorded under Decisions, for review on the step 3 PR.

## Files / areas touched

- `docs/product/PRD-draft-projects.md`, `docs/product/DATA_MODEL.md`
- `docs/modules/drafts/`, and the drafts rows in `docs/modules/README.md` and `AGENTS.md`; `docs/modules/mcp/README.md`, `docs/modules/permissions/README.md`
- `db/migrations/056_drafts.sql`, `db/rollback/056_drafts_rollback.sql`
- `src/lib/drafts/`, `src/lib/mcp/draft-actions.ts`, `src/app/api/cursor/drafts/`, `src/lib/permissions/`
- `tools/plx-mc-mcp/` (stdio tools)
- Step 3: `src/app/api/drafts/`, `src/components/mc/drafts.tsx`, `src/styles/mc-drafts.css`, and one line each in `src/components/mc/` `route.ts`, `screens.tsx`, `nav-model.ts`, `nav-icon.tsx`, `approvals-inbox.tsx`. The nav files are shared with the `nav-v2-sidebar` workstream.
- New draft form (TASK-4109, TASK-4110): `src/components/mc/draft-editor.tsx`, `src/app/api/drafts/` (create, save, submit, withdraw), the `edit` route param in `src/components/mc/route.ts`, `draftEditBase` in `src/lib/drafts/service.ts`.

## How to run the tests

```bash
npx vitest run tests/drafts.test.ts tests/mcp-drafts.test.ts tests/drafts-accept.test.ts tests/drafts-ui.test.ts tests/drafts-session-routes.test.ts
node scripts/run-playwright.mjs e2e/ui-drafts.spec.ts --project=chromium
npx vitest run tests/drafts-postgres.test.ts   # needs Docker (CI) or a local PG16
node scripts/workstream-note.mjs check
bash scripts/preflight.sh --mode pre-commit
```

## Blockers or dependencies on other workstreams

- None. Migration 056 is live (DB Migrate, 2026-10-27).

## Last updated

2026-10-29 by Claude Code (TASK-4135): review pages merged (#508), the last follow-up, and the production smoke test passed (DRF-1, withdrawn); the workstream is done.
