# Module: drafts

## What

Draft Projects (PRD: [`docs/product/PRD-draft-projects.md`](../../product/PRD-draft-projects.md)).
A draft is a reviewable bundle with two parts:

- **The plan:** one project (new, or an existing open `PRJ-*`), its buckets and its tasks, under
  draft keys `P`, `B1`, `T1`. No real `PRJ-*`, `BKT-*` or `TASK-*` id exists before Accept.
- **The research:** summary, context, findings that cite sources by ref, two or more approaches
  with exactly one chosen, the recommendation, risks, open questions, sources and artifacts.

PLX members and their agents review a draft. Its human author accepts it (step 3). Nothing in a
draft is live, and drafts are DB-only: no SharePoint list.

This module owns the draft and version records, the submit checks, and the review rules. It does
**not** create projects, buckets or tasks itself: Accept (step 3) calls the `sync` create
functions unchanged, so every guard on those paths still applies.

## Why

People and agents planned new work in research files on one laptop (`RESEARCH.md`,
`DISCOVERY.md`), then created live records one at a time. Nobody reviewed the whole plan, with its
reasons and sources, before it became work. Members also had no way to propose a project:
`project.create` and `bucket.create` are admin-only among people.

## How

Lifecycle: `drafting` → submit → `in_review` → Accept (step 3) → `accepted`; the author may
withdraw an open draft (`withdrawn`).

1. **Save** (`mc_save_draft`): creates a draft, or replaces the sections sent (title, plan,
   research, visibility, members, reviewers). The author is the agent's operator email and must be
   a Petra person. Only the writer edits: the same principal acting for the same person, or the
   author signed in. An edit during review returns the draft to `drafting`. The result carries the
   preflight problems, as advice.
2. **Submit** (`mc_submit_draft`): runs the completeness and preflight checks
   (`src/lib/drafts/preflight.ts`) and refuses with every problem (422 `draft_not_ready`).
   Preflight mirrors the create functions: allow-listed repos, an open and visible parent project,
   known owners, names, task buckets and dependencies inside the plan. On a pass it freezes the
   working copy as version N+1 in one transaction. The version's id is the sha256 of its canonical
   content (`draftDigest`), and the `draft_versions` trigger refuses any later change. Likely
   duplicate open tasks (word overlap, shared projects only) are raised as non-blocking findings
   by Mission Control. Submitting an unchanged draft changes nothing.
3. **Review** (`mc_review_draft`): a comment, a finding (blocking or not), an approval or a
   request for changes, each bound to the current version and digest. A review of an older version
   reads as `stale`. An agent's approval is advisory. A finding stays open across versions until
   its raiser resolves it, or the author, signed in, resolves or dismisses it (a dismissal needs a
   reason of 10 characters or more). An open blocking finding refuses Accept.
4. **Read** (`mc_get_draft`, `mc_list_drafts`): visibility follows projects. A `restricted` draft
   fails closed to its members and its author, with the same member matching as
   `src/lib/permissions/project-acl.ts`. The principal that wrote it is not a member by itself: a
   principal is a runtime key many people share. Under `PLX_MC_MCP_PRINCIPAL_AUTHZ=enforce` an
   agent sees a restricted draft only when its `sp_*` id is listed in `members`; in shadow mode a
   read that would vanish under enforce logs `authz.shadow_mismatch` (site `drafts.read`). A hidden
   draft reads as not found. Lists filter in the database (status, visibility, author, reviewer,
   search) before their limit of 200, and carry counts, never working copies.

Invariants:

- Everything is off until `PLX_MC_DRAFTS_ENABLED=1` (`src/lib/drafts/flag.ts`), which is also the
  kill switch. While off, nothing reads or writes the drafts tables, and every tool answers 404
  `drafts_disabled`.
- Agents never accept. There is no accept tool, and no service principal holds `draft.accept`.
- Every change locks the draft row (`mutateDraft` in `src/lib/drafts/store.ts`), so racing
  reviews all land. Submit freezes only the content its checks ran on (409 `draft_changed`
  otherwise).
- Events: `draft.created`, `draft.updated`, `draft.submitted`, `draft.reviewed`,
  `draft.finding.resolved`, `draft.finding.dismissed`, `draft.withdrawn` in `mc_events`.

Storage (migration `056_drafts.sql`, rollback `db/rollback/056_drafts_rollback.sql`): `drafts`
(working copy and reviews as jsonb, the house pattern for gates and questions; ids from
`mc_draft_id_seq`) and `draft_versions` (immutable). The accept and `materialized` columns are for
step 3, so step 3 needs no migration.

## Dependencies

- **mcp**: the five tools and `/api/cursor/drafts` routes (`src/lib/mcp/draft-actions.ts`).
- **permissions**: `draft.create`, `draft.review`, `draft.accept`; the project-ACL helpers.
- **sync**: live repos, projects, buckets and tasks for the checks (`src/lib/sync/repo.ts`);
  Accept (step 3) will call the create functions in `src/lib/sync/state.ts`.
- **compliance**: `appendEvent` for the audit trail.

Depended on by: the `mcp` module (tools); the Drafts screen and Accept in step 3.

### Key Files

- `src/lib/drafts/types.ts` — client-safe shapes (`Draft`, `DraftContent`, `DraftReview`, statuses).
- `src/lib/drafts/schema.ts` — zod input validation, `canonicalJson`, `draftDigest`.
- `src/lib/drafts/preflight.ts` — completeness and preflight checks (pure).
- `src/lib/drafts/duplicates.ts` — likely-duplicate scoring (pure).
- `src/lib/drafts/store.ts` — Postgres store with the process-local fallback.
- `src/lib/drafts/service.ts` — the rules: visibility, writer, submit, reviews, findings.
- `src/lib/drafts/flag.ts` — `PLX_MC_DRAFTS_ENABLED`.
- `src/lib/mcp/draft-actions.ts` — the MCP tools, shared with the REST routes.
- `db/migrations/056_drafts.sql` — the tables, sequence and immutability trigger.

## Owner

Vince

## Criticality

Medium. A failure stops proposing and reviewing drafts; live projects, buckets and tasks never
depend on a draft.
