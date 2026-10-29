# Module: drafts

## What

Draft Projects (PRD: [`docs/product/PRD-draft-projects.md`](../../product/PRD-draft-projects.md)).
A draft is a reviewable bundle with two parts:

- **The plan:** one project (new, or an existing open `PRJ-*`), its buckets and its tasks, under
  draft keys `P`, `B1`, `T1`. No real `PRJ-*`, `BKT-*` or `TASK-*` id exists before Accept.
- **The research:** summary, context, findings that cite sources by ref, two or more approaches
  with exactly one chosen, the recommendation, risks, open questions, sources and artifacts.

PLX members and their agents review a draft. Its human author accepts it. Nothing in a draft is
live until then, and drafts are DB-only: no SharePoint list.

This module owns the draft and version records, the submit checks, the review rules and Accept. It
does **not** create projects, buckets or tasks itself: Accept calls the `sync` create functions
unchanged, so every guard on those paths still applies.

## Why

People and agents planned new work in research files on one laptop (`RESEARCH.md`,
`DISCOVERY.md`), then created live records one at a time. Nobody reviewed the whole plan, with its
reasons and sources, before it became work. Members also had no way to propose a project:
`project.create` and `bucket.create` are admin-only among people.

## How

Lifecycle: `drafting` → submit → `in_review` → Accept → `accepted`; the author may withdraw an
open draft (`withdrawn`).

1. **Save** (`mc_save_draft`): creates a draft, or replaces the sections sent (title, plan,
   research, visibility, members, reviewers). The author is the agent's operator email and must be
   a person in the PLX directory (`humanEmailFor`), never a service mailbox such as `cos@`. Only
   the writer edits: the same principal acting for the same person, or the
   author signed in. An edit during review returns the draft to `drafting`. The result carries the
   preflight problems, as advice.
2. **Submit** (`mc_submit_draft`): runs the completeness and preflight checks
   (`src/lib/drafts/preflight.ts`) and refuses with every problem (422 `draft_not_ready`).
   Preflight mirrors the create functions: allow-listed repos, an open and visible parent project,
   known owners, names, task buckets and dependencies inside the plan. On a pass it freezes the
   working copy as version N+1 in one transaction. The version's id is the sha256 of its canonical
   content (`draftDigest`), and the `draft_versions` trigger refuses any later change. Likely
   duplicate open tasks (word overlap, shared projects only; a task whose bucket or project the
   Hub does not hold is left out) are raised as non-blocking findings by Mission Control. Every
   research finding must cite a source (`finding_uncited`). Submitting an unchanged draft changes
   nothing.
3. **Review** (`mc_review_draft`): a comment, a finding (blocking or not), an approval or a
   request for changes, each bound to the current version and digest. The reviewer sends the
   version they read; a newer one refuses (409 `draft_version_moved`), and so does a draft whose
   edits are not submitted yet (409 `draft_not_in_review`). A review of an older version
   reads as `stale`. An agent's approval is advisory. A finding stays open across versions until
   its raiser resolves it, or the author, signed in, resolves or dismisses it (a dismissal needs a
   reason of 10 characters or more). An open blocking finding refuses Accept.
**Uploads** (`mc_upload_draft_artifact`, TASK-4130): the writer uploads a diagram, screenshot or
web page for an open draft. The file goes through the same checks as `mc_upload_evidence`
(`artifactProblem`) to the PLX site's `Mission Control` library under `Drafts/DRF-n/`, then joins
`research.artifacts` as a link (`addDraftArtifact`), so an upload during review returns the draft
to `drafting`. A restricted draft refuses (409 `draft_restricted`): the library is shared, and MC
never narrows access. A draft whose plan names the Trading Lab repo (`petralabx/agentic-swarm`, in
its project, a bucket, a task or the existing project it adds to) refuses (503
`evidence_store_unavailable`): Trading Lab files go on its own site. The draft stays locked from
these checks through the SharePoint write and the link (`mutateDraft` takes an async change), so no
save can restrict the draft or name Trading Lab in between; a save waits for the upload. A stored
file's name carries its whole SHA-256, so the same file again adds nothing, even at the 50-link
cap, and no other file passes for it. Uploads are off until a person
sets `PLX_MC_EVIDENCE_STORE_ENABLED=1` (503 `evidence_store_unavailable`). MC never deletes a stored
file; removing the link from the draft leaves the file in the library.

**Review pages** (TASK-4135; decisions in the PRD, "Follow-up: review on a shared page"): a
version under review, published as a private Claude Artifact, collects comments from Petra people
who do not use Mission Control. Mission Control stays the record: nobody edits the plan from the
page, and a page comment never blocks. Off until an operator sets `PLX_MC_DRAFT_PAGES_ENABLED=1`
(503 `draft_pages_off`); a restricted draft is never published (409 `draft_restricted`). The
writer's agent:

1. Renders the version with `mc_render_draft_page` (`src/lib/drafts/page.ts`: one HTML file, every
   value escaped, no script, `data-target` on each plan item and research section). Stdio writes it
   to an absolute `outPath`.
2. Publishes it as a private Claude Artifact and shares it with the reviewers the author chooses.
3. Records the link with `mc_publish_draft_page {draftId, version, url}` (`publishDraftPage`). The
   draft keeps it as a `source: "page"` entry among its reviews; the same link again records nothing.
4. Reads the page's comment threads (Claude Code: `ArtifactComments`) and relays each new comment with
   `mc_review_draft {kind: "comment", version, body, target, relay: {pageUrl, commentId, commenter}}`
   (`relayPageComment`). `version` is the version the page showed when the comment was made;
   `target` is the `data-target` of the part it is anchored to. The review lands on that version as a
   comment by the commenter (`source: "artifact"`, `relayedBy`, `relayedFor`). Only a Petra commenter
   comes back (422 `commenter_not_petra`); a comment relayed twice is recorded once.
5. Republishes the page for each new version and records it again. Comments on an older version
   show as stale.

Restricting a draft after its page is published does not take the page down: the author deletes the
artifact or changes its sharing.

4. **Read** (`mc_get_draft`, `mc_list_drafts`): visibility follows projects. A `restricted` draft
   fails closed to its members and its author, with the same member matching as
   `src/lib/permissions/project-acl.ts`. The principal that wrote it is not a member by itself: a
   principal is a runtime key many people share. Under `PLX_MC_MCP_PRINCIPAL_AUTHZ=enforce` an
   agent sees a restricted draft only when its `sp_*` id is listed in `members`; in shadow mode a
   read that would vanish under enforce logs `authz.shadow_mismatch` (site `drafts.read`). A hidden
   draft reads as not found. Lists filter in the database (status, visibility, author, reviewer,
   search) before their limit of 200, and carry counts, never working copies.

5. **Accept** (`POST /api/drafts/{id}/accept {version}`, session only; `src/lib/drafts/accept.ts`):
   the author, signed in, accepts the version they read. A moved version, unsubmitted edits, an
   open blocking finding, or a preflight problem now (for example a parent project closed during
   review) refuses it. Accept creates the project (unless the plan names an existing one), then the
   buckets, then the tasks in dependency order, through `createProject`, `createBucket` and
   `createTask`. The project's PRD link is the frozen version's link
   (`/?screen=drafts&draftId=DRF-n&version=N`); a bucket's adds its draft key (`#B1`), so two
   buckets with the same name stay apart. The bucket-PRD check passes. Tasks carry
   `draft:DRF-n` and `depends-on:TASK-*` labels and link the draft in their description. A new
   project takes the draft's visibility and members. The draft records each new id in
   `materialized`:
   - a task's id commits inside the transaction that creates it (`createTask`'s `inTransaction`);
   - a project or bucket a crashed Accept made is found again by its PRD link and adopted;
   - a claim (`accepted_at` while still `in_review`) refuses a second Accept, and every edit and
     review (409 `accept_in_progress`), for 10 minutes; a failed Accept clears it. The claim
     checks again for an open blocking finding;
   - once an Accept has claimed the draft, the content cannot change (409 `accept_unfinished`),
     even after it fails: `accepted_by` stays set, as a create may commit before its record. A
     retry finishes the version it started; reviews and withdraw still work;
   - a project the run did not create (recorded, adopted or existing) is checked again against
     the author's access before anything is created in it (404 `unknown_project`), and each
     recorded bucket must still be in that project (404 `unknown_bucket`).

   An older version's page is read-only: no review form, no finding actions and no Accept. A
   closed draft, or one an Accept is running on, offers no finding actions. After Accept the screen
   reloads the shared snapshot before it links the new records.

The Drafts screen (`?screen=drafts`, `src/components/mc/drafts.tsx`) lists drafts and opens one:
the plan tree with preflight badges, the research, reviews, versions with a change summary, and,
for the author, Accept with a confirmation that states what it creates. The Approvals screen lists
drafts waiting for the viewer's review. Session routes: `GET /api/drafts`, `GET
/api/drafts/{id}[?version=N]`, `POST /api/drafts/{id}/review`, `POST /api/drafts/{id}/accept`.

A person also writes drafts on the screen (TASK-4109): New draft (`&draftId=new`) and Edit draft
(`&draftId=DRF-n&edit=1`) open the form in `src/components/mc/draft-editor.tsx`. Its session routes
need `draft.create` and are the author's alone: `POST /api/drafts` (create), `PATCH
/api/drafts/{id}` (save), `POST /api/drafts/{id}/submit` and `POST /api/drafts/{id}/withdraw`.
A save and a submit carry the edit base GET returned (service `draftEditBase`: the working copy's
digest, the visibility, the members and the reviewers); a draft that has moved since refuses with
409 `draft_changed`. A review does not move it, and edits typed after a save keep the base they
were made from. While the form holds unsaved edits it sets the shell's navigation guard
(`src/components/mc/nav-guard.ts`), so an in-app move or Back asks first. Author actions show only
on the working copy's page. The form edits the whole research section, a task's dependencies (the
draft's other tasks, or `TASK-*` ids) and the order of buckets and tasks (TASK-4110). A save drops
rows left empty and names half-filled ones; the server validates.
The form uploads a file for a saved, shared draft (TASK-4131): `POST /api/drafts/{id}/artifacts`
with the edit base, through the same core as `mc_upload_draft_artifact` (`uploadDraftArtifact`). A
draft that has moved refuses before anything is stored; on success the link joins the form and the
form takes the returned base. GET's `viewer.canUpload` offers the control only to the author of an
open, shared draft while the store is on.

Invariants:

- Drafts are on unless `PLX_MC_DRAFTS_ENABLED=0` (`src/lib/drafts/flag.ts`), the kill switch.
  While it is set, nothing reads or writes the drafts tables, and every tool and route answers 404
  `drafts_disabled`.
- Agents never accept. There is no accept tool, and no service principal holds `draft.accept`.
- Every change locks the draft row (`mutateDraft` in `src/lib/drafts/store.ts`) and checks
  visibility again under the lock, so racing reviews all land and a draft restricted meanwhile
  refuses the change. Submit freezes only the content its checks ran on (409 `draft_changed`
  otherwise).
- Events: `draft.created`, `draft.updated`, `draft.submitted`, `draft.reviewed`,
  `draft.finding.resolved`, `draft.finding.dismissed`, `draft.withdrawn`, `draft.accepted` in
  `mc_events`; the created records keep their own audit entries. Each names its draft in
  `payload.draftId`, and the `/api/events` export (`src/lib/compliance/events-acl.ts`) shows it
  only to a principal who can see that draft.

Storage (migration `056_drafts.sql`, rollback `db/rollback/056_drafts_rollback.sql`): `drafts`
(working copy and reviews as jsonb, the house pattern for gates and questions; ids from
`mc_draft_id_seq`) and `draft_versions` (immutable), plus the accept and `materialized` columns
Accept writes.

## Dependencies

- **mcp**: the six tools and `/api/cursor/drafts` routes (`src/lib/mcp/draft-actions.ts`); uploads share the evidence store helpers in `src/lib/mcp/evidence-actions.ts`.
- **permissions**: `draft.create`, `draft.review`, `draft.accept`; the project-ACL helpers.
- **sync**: live repos, projects, buckets and tasks for the checks (`src/lib/sync/repo.ts`); Accept
  calls the create functions in `src/lib/sync/state.ts`.
- **compliance**: `appendEvent` for the audit trail; `artifactProblem` and `sharePointSafeName` for uploads.

Depended on by: the `mcp` module (tools); the `web` module (the Drafts screen and the Approvals
panel).

### Key Files

- `src/lib/drafts/types.ts` — client-safe shapes (`Draft`, `DraftContent`, `DraftReview`, statuses).
- `src/lib/drafts/schema.ts` — zod input validation, `canonicalJson`, `draftDigest`.
- `src/lib/drafts/preflight.ts` — completeness and preflight checks (pure).
- `src/lib/drafts/duplicates.ts` — likely-duplicate scoring (pure).
- `src/lib/drafts/store.ts` — Postgres store with the process-local fallback.
- `src/lib/drafts/service.ts` — the rules: visibility, writer, submit, reviews, findings.
- `src/lib/drafts/flag.ts` — `PLX_MC_DRAFTS_ENABLED` (the kill switch).
- `src/lib/drafts/accept.ts` — Accept: guards, the claim, creation in order, resume and adoption.
- `src/lib/drafts/session.ts` — the signed-in person as a draft actor.
- `src/app/api/drafts/**` — the session routes.
- `src/components/mc/drafts.tsx` — the Drafts screen and the Approvals panel.
- `src/lib/mcp/draft-actions.ts` — the MCP tools, shared with the REST routes.
- `db/migrations/056_drafts.sql` — the tables, sequence and immutability trigger.

## Owner

Vince

## Criticality

Medium. A failure stops proposing and reviewing drafts; live projects, buckets and tasks never
depend on a draft.
