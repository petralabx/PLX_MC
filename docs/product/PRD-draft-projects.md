# PRD — Draft Projects

- **Owner (accountable human):** Vince
- **Bucket:** `BKT-MISSION-CONTROL-OPS`
- **Workstream:** [`docs/workstreams/draft-projects.md`](../workstreams/draft-projects.md)
- **Risk tier:** Step 1 is docs only. Step 2 is high: it adds a migration and new capabilities.

## Problem

People and agents plan new work in research files on one laptop. `project-researcher` writes `RESEARCH.md` and `guided-project-discovery` writes `DISCOVERY.md` under `.orchestrator/` and `.discovery/`. Nobody else can review those files.

The plan then reaches Mission Control one item at a time. `mc_create_project`, `mc_create_bucket` and `mc_create_task` each create a live record at once and queue the SharePoint mirror. There is no point where PLX members and their agents review the whole plan, with its reasons and sources, before it becomes work.

Example: one agent session created `PRJ-COS-COMPANION` and four buckets straight from a local `DISCOVERY.md` (portal `.discovery/cos-companion/DISCOVERY.md`).

Members also cannot create a project or a bucket today. Among people, only the admin and owner roles hold `project.create` and `bucket.create` (`src/lib/permissions/grants.ts`). A member has no way to propose one.

## What a Draft is

A Draft is a reviewable bundle with two parts:

- **The plan:** one project (new, or an existing `PRJ-*`), its buckets and its tasks.
- **The research:** summary, reasoning, the approaches considered, the chosen approach, risks, open questions, sources and artifacts.

Nothing in a draft is live. When its author accepts it, MC creates the project, buckets and tasks through the same create functions that the UI and agents use today.

## Decisions (Vince, 2026-10-27)

1. The author accepts. Only the draft's human author, signed in, can accept it. An agent never accepts.
2. An unresolved blocking finding on the current version refuses Accept. There is no minimum number of approvals.
3. Drafts are a convention for agents. Nothing changes in what agents may create directly.
4. Visibility follows projects: `shared` by default, or `restricted` to named members.
5. Mission Control only. Drafts do not read from, write to or depend on VMC.

## Storage

Drafts get two new tables: `drafts` (the working copy) and `draft_versions` (frozen versions). A draft is not a project with a draft status. The `projects` table feeds the SharePoint mirror, navigation, counts, pickers, the project ACL and compliance. A draft status there would need an exclusion in every reader, as `035_container_archive.sql` shows for archive. Separate tables leave every live surface unchanged until Accept.

Drafts are DB-only, like approval gates and questions. They have no SharePoint list. After Accept, the project and bucket PRD links point at the frozen version, so the record keeps the reasoning.

A frozen version is immutable. Its id is the sha256 digest of its normalized content, the rule `guided-project-discovery` uses for review candidates.

## Shape

```jsonc
{
  "id": "DRF-12",
  "status": "in_review",              // drafting | in_review | accepted | withdrawn
  "version": 3,
  "digest": "sha256:…",               // of the current frozen version
  "author": "vince@petrasoap.com",    // always a human
  "createdBy": "sp_mcp_claude_code",  // principal or session that wrote it
  "visibility": "shared",             // shared | restricted
  "members": [],                      // restricted only
  "reviewers": ["ricardo", "stephen"],
  "plan": {
    "project": { "key": "P", "existing": null, "name": "…", "owner": "vince", "repos": ["plx-mc"], "desc": "…" },
    "buckets": [{ "key": "B1", "name": "…", "owner": "…", "repos": ["plx-mc"], "desc": "…" }],
    "tasks": [{
      "key": "T1", "bucket": "B1", "title": "…", "description": "…",
      "priority": "high", "kind": "code", "repos": ["plx-mc"],
      "accountableOwner": "vince", "dependsOn": ["T0", "TASK-3953"]
    }]
  },
  "research": {
    "summary": "…",
    "context": "…",
    "findings": [{ "text": "…", "sources": ["[1]"] }],
    "approaches": [{ "name": "…", "pros": [], "cons": [], "risk": "low", "effort": "M", "chosen": true }],
    "recommendation": "…",
    "risks": [{ "text": "…", "likelihood": "medium", "impact": "high", "mitigation": "…" }],
    "openQuestions": [],
    "sources": [{ "ref": "[1]", "title": "…", "url": "…", "kind": "internal", "excerpt": "…", "accessed": "2026-10-27" }],
    "artifacts": [{ "kind": "diagram", "name": "…", "url": "…", "inline": null }]
  },
  "materialized": { "P": "PRJ-…", "B1": "BKT-…", "T1": "TASK-4102" }
}
```

### Plan keys

Plan items use draft keys: `P` for the project, `B1` for a bucket, `T1` for a task. No real `PRJ-*`, `BKT-*` or `TASK-*` id exists before Accept. A real id before Accept would be phantom work that an agent could check out and stamp on a PR. After Accept, `materialized` keeps each mapping on the draft for good.

A task may name existing ids in `dependsOn`. A draft may set `plan.project.existing` to add buckets to an open project. A draft does not move existing tasks or buckets.

### Research

The research sections follow `project-researcher`'s `RESEARCH.md`. A draft needs at least two approaches, with exactly one chosen. Each finding cites its sources by `ref`.

A source is internal (a repo path, an MC id, a SharePoint document) or external (a web page). Step 2 accepts artifacts as links, inline markdown and inline Mermaid. `mc_upload_evidence` needs a task and a live checkout (`src/lib/mcp/evidence-actions.ts`), so a draft has its own upload tool, `mc_upload_draft_artifact` (TASK-4130; see Follow-up: artifact uploads).

## Lifecycle

| Status | Who acts | What happens |
|---|---|---|
| `drafting` | A member, or an agent for its person | Edit the working copy. Nothing is live. |
| Submit → `in_review` | The author or the agent that wrote it | MC freezes the next version and runs preflight. |
| `in_review` | Anyone who can see the draft | Reviews attach to the current version's digest. |
| Accept → `accepted` | The author only | MC creates the plan and records each new id. |
| Withdraw → `withdrawn` | The author only | MC keeps the draft and its versions. |

An edit during review returns the draft to `drafting`. The next submit freezes version N+1. Approvals given on version N show as stale.

### Preflight

Submit and Accept run the same checks the create functions enforce:

- Every repo is in the MC allow-list (`requireRegistryRepos`).
- An existing parent project exists, is open and is not archived.
- Every owner and accountable owner is a known Petra person.
- Every project, bucket and task has a name or title.

A failed check refuses the submit or the Accept. Accept runs preflight again because live state can change during review.

Submit also searches open tasks for each draft task's title. MC adds each likely duplicate to the draft as a non-blocking finding, so reviewers see it.

## Reviews

Anyone who can see a draft can review it: a member or an agent. A review is one of:

- a comment;
- a finding, marked blocking or non-blocking;
- an approval;
- a request for changes.

Each review names the version digest it was given on. An agent's approval shows as advisory.

A finding stays open across versions until someone closes it:

- The person who raised it, or the author, marks it resolved.
- The author dismisses it with a written reason. The reason stays on the draft.

An open blocking finding refuses Accept (decision 2).

The author names reviewers. Each named reviewer sees the draft in a Drafts to review panel on the Approvals screen until they review its current version. Agents read drafts with `mc_list_drafts` and `mc_get_draft`.

## Accept

Accept creates the plan in order: the project (unless it exists), then the buckets, then the tasks. It calls `createProject`, `createBucket` and `createTask` in `src/lib/sync/state.ts` unchanged. Every guard on those paths still applies: the repo allow-list, archive and close checks, the audit log and the SharePoint mirror queue. Accept also checks the project ACL on an existing parent project, as the MCP create actions do (`src/lib/permissions/project-acl-guard.ts`).

Those calls do not share one transaction. Accept writes each new id into `materialized` before the next create starts, and a retry skips every key that already has an id. Step 3 closes the gap between a create and its record this way:

- A task's id is written inside the transaction that creates it (`createTask`'s `options.inTransaction`), so a task never exists without its record.
- The project carries the frozen version's link as its PRD link. Each bucket carries that link plus its draft key (`#B1`), so two buckets with the same name stay apart. A retry finds a record that a crashed Accept made by that link, and adopts it instead of creating a second one.
- Accept takes a claim on the draft first (`accepted_at`, while it is still `in_review`). The claim checks again for an open blocking finding. The claim refuses a second Accept, and every edit and review, while one runs. A failed Accept clears its claim. A crashed one goes stale after 10 minutes, and the next Accept takes over.
- Once an Accept has claimed the draft, its content cannot change (409 `accept_unfinished`), even when that Accept fails. A create can commit before its record, so a retry must read the same version's link. `accepted_by` stays set after a failure and keeps the pin. A retry then always finishes the version it started. Reviews still land, and the author can withdraw the draft.
- On a retry, Accept checks the author's access to the project again before it creates anything in it. It also checks that each recorded bucket is still in that project. An author removed from a restricted project cannot continue, and no task goes into a bucket that moved.

On the created records:

- The project's `prd` is the frozen version's link, `https://mc.plxcustomer.io/?screen=drafts&draftId=DRF-n&version=N`. Each bucket's `prd` adds its draft key, for example `…&version=N#B1`. `src/lib/compliance/bucket-prd.ts` counts any http(s) link, so tasks in those buckets pass the PRD check.
- Each task carries the label `draft:DRF-n`, and its description links the draft.
- A task's accountable owner comes from the plan. With none set, it is the author.
- A new project takes the draft's visibility and members.
- MC writes a `draft.accepted` event and one event per created record to `mc_events`.

The author is a person in a signed-in session. So the creator-approval gate (TASK-3530) does not apply to the created tasks. One reviewed draft replaces a separate approval per task.

## Permissions

New capabilities in `src/lib/permissions/grants.ts`:

| Capability | Member role | MCP agent bundle | Rule |
|---|---|---|---|
| `draft.create` | yes | yes | Create, edit, submit and withdraw a draft one authors or wrote. |
| `draft.review` | yes | yes | Review a draft one can see. |
| `draft.accept` | yes | no | Only when the session is the draft's author. |

The restricted principals get none of these: `sp_mcp_portal`, `sp_mcp_workbench`, `sp_mcp_infra`, `sp_mcp_cip_auto_undraft` and `sp_mcp_workbench_intake`. Step 2 does not add the draft tools to their lists in `src/lib/mcp/tool-allowlist.ts`.

A member who accepts their own draft creates a project and buckets. Members cannot do that directly today. This is the intended effect: draft review stands in for the admin-only create. Vince was told this with decision 1 and approved going ahead on 2026-10-27.

A draft an agent writes names the agent's person as author. That is the operator email on its MCP call, and it must resolve to a person in the PLX directory, never a service mailbox such as `cos@`. The agent cannot accept for that person: Accept needs that person's own signed-in session.

A restricted draft fails closed to its members and its author for list, read and review. It uses the same member matching as `src/lib/permissions/project-acl.ts`. The principal that wrote it is not a member by itself, because many people share one runtime key; under enforce, list the agent's `sp_*` id as a member.

## Agent tools

| Tool | Purpose |
|---|---|
| `mc_save_draft` | Create a draft, or update its working copy. Returns the id, the status and the preflight result. |
| `mc_submit_draft` | Freeze the working copy as the next version and start review. |
| `mc_get_draft` | Read a draft, or one version of it. |
| `mc_list_drafts` | List the drafts one can see, by status, query or "needs my review". |
| `mc_review_draft` | Post a comment, finding, approval or request for changes on the current version. |

There is no accept tool. REST routes under `/api/cursor/drafts` mirror the tools.

## Screen

- `?screen=drafts` lists drafts, with filters for mine, needs my review and status.
- `?screen=drafts&draftId=DRF-n` opens the record. It shows:
  - the plan tree with preflight badges, such as "repo not in the allow-list" or "possible duplicate of TASK-…";
  - Research, Reviews and Versions sections, with a diff between versions;
  - an Accept button, for the author only. Its confirmation states the counts, such as "Creates 1 project, 3 buckets and 14 tasks".
- A person writes a draft through their agent (`mc_save_draft`), or on the screen with the New draft form (see Follow-up: New draft form).
- The Approvals screen shows a Drafts to review panel for named reviewers.

## Convention for agents (decision 3)

A rule in `config/governance-contract.yaml` ("Plans go through a draft", TASK-4132) says that a plan that adds a project, or two or more buckets, goes through a draft. The generators carry the rule into `AGENTS.md` and `CLAUDE.md`, and the MCP server instructions and the `mc_create_project` and `mc_create_bucket` descriptions say the same. `project-researcher` and `guided-project-discovery` end by saving a draft (TASK-4129, `petralabx/skills` v1.6.15); the catalog pin in `config/skills-catalog.json` moved to that release.

Nothing blocks a direct create.

## Follow-up: New draft form (Vince, 2026-10-28)

A person writes a draft on the Drafts screen, without an agent. It ships in two slices.

Slice A (TASK-4109):

- **New draft** on the list opens `?screen=drafts&draftId=new`. **Edit draft** on a draft the person authors opens `&draftId=DRF-n&edit=1`.
- The form edits the title, who sees the draft (shared or restricted, and its members), the reviewers, the plan (a new or an existing project, buckets and tasks), and the research that submit needs: summary, context, approaches, recommendation, sources and findings.
- Slice A left risks, open questions and artifacts out of the form; a save sent them back unchanged. Slice B adds them.
- Session routes, each for the author only (`draft.create`):
  - `POST /api/drafts` creates a draft. The signed-in person is its author.
  - `PATCH /api/drafts/{id}` saves the sections it sends.
  - `POST /api/drafts/{id}/submit` submits the working copy.
  - `POST /api/drafts/{id}/withdraw` withdraws the draft, with a reason of 10 characters or more.
- A save and a submit carry the **edit base** the form was read with: a digest of the working copy, the visibility, the members and the reviewers. A draft that has moved since (an agent's save, another tab) refuses with 409 `draft_changed`, and the form keeps the person's edits. A review does not move the base.
- Before submit, the draft's record and the form list what the completeness and preflight checks still need. Submit waits for saved edits, and only the working copy's page offers it, never a frozen version's.
- Unsaved edits ask before the person leaves: an in-app move or Back asks first, and closing the tab warns. The form locks while Create, Submit or Withdraw runs. Edits typed after a save keep the edit base they were made from, and a save's read-back never undoes a later save.

Slice B (TASK-4110):

- The form edits the rest of the research: risks (likelihood, impact, mitigation), open questions (one per line) and artifacts. An artifact is a link (http or https) or inline markdown or Mermaid, never both.
- A task's dependencies are a picker: the draft's other tasks as checkboxes, and existing `TASK-*` ids as text.
- Buckets and tasks move up and down. Their keys stay; the order is the plan's order.
- A save drops rows left empty and names the rows that are half filled, such as a risk with a mitigation and no text.

## Follow-up: artifact uploads (TASK-4130)

An agent uploads a file for a draft it wrote with `mc_upload_draft_artifact`:

- The kinds are diagram (svg, png), screenshot (png, jpeg, webp) and web page (html), 3 MiB or less. The checks are the ones `mc_upload_evidence` runs.
- MC stores the file in the PLX site's `Mission Control` library under `Drafts/DRF-n/`, and adds it to the draft's research artifacts as a link.
- Only the draft's writer uploads, to an open draft. An upload during review returns the draft to drafting, as any edit does.
- A restricted draft refuses: everyone with access to the shared library could open the file, and MC never narrows access.
- A draft for Trading Lab (its plan names `petralabx/agentic-swarm`) refuses too: Trading Lab files go on its own SharePoint site, never the PLX site.
- Uploads are off until a person sets `PLX_MC_EVIDENCE_STORE_ENABLED=1`, the switch evidence uploads use.
- The New draft form uploads too (TASK-4131). For a saved, shared draft whose author is signed in, the Artifacts section offers **Upload a file**. `POST /api/drafts/{id}/artifacts` sends the file with the edit base the form read, so a draft that has moved refuses before anything is stored. The link joins the form at once, and the form takes the new base. `GET /api/drafts/{id}` says whether uploads are on (`viewer.canUpload`). The upload waits for a save on its way, and for unsaved edits to be saved, since they could make the draft restricted or Trading Lab's. Submit and Withdraw wait for an upload on its way.

## Follow-up: review on a shared page (Vince, 2026-10-27)

Colleagues, commentators and editors can review a draft on a page outside Mission Control: a Claude Artifact, or a Cursor Canvas if it exposes its comments. Their comments come back to the draft as reviews. This brings people into the review who do not work in Mission Control.

Mission Control stays the system of record. The page is a view; it never holds the draft.

- **One frozen version per page.** "Publish for review" renders a submitted version as a page and records the page's link on the draft. When the author submits a new version, the page is published again for it. Comments on an older version show as stale, as reviews on an older version already do.
- **Comments flow one way, into Mission Control.** Each comment on the page becomes a draft review on the version it was given on. It goes through the existing review path (`reviewDraft`), so every review rule still applies. A comment anchored to part of the page keeps that part's draft key (P, B1, T3) or research section as the review's `target`.
- **Nobody edits the plan from the page.** A change still goes through the author, or their agent, and a new version. Two-way editing would make two sources of truth.
- **Blocking stays in Mission Control.** A comment from the page lands as a non-blocking comment. Only a PLX member, in Mission Control, raises a blocking finding or approves. Decisions 1 and 2 do not change: the author accepts, and an open blocking finding refuses Accept.
- **Who said it.** A relayed review records `source: "artifact"` (or `"canvas"`), the commenter as the page reports them, and the agent that relayed it. A commenter Mission Control does not know shows as external.
- **Visibility.** A page publishes the draft's content outside Mission Control's access rules. Shared drafts may be published. A restricted draft goes only to its members. The page starts private, and the author chooses whom to share it with.

What it needs:

- A "Publish for review" action, by the author or their agent, on a submitted draft.
- A relay that turns each new page comment into a review. For Claude Artifacts, an agent watches the artifact's comment threads and calls `mc_review_draft`.
- `"artifact"` and `"canvas"` as review sources, plus fields for the commenter and the relaying agent. Reviews are jsonb on `drafts`, so this needs no migration.
- The external-integration declaration before it merges: owner, scope, auth source, default state (off), kill switch, health check, fallback and data boundary.

Not decided yet:

- Whether people outside Petra may comment at all, or only Petra people who do not use Mission Control.
- Whether Cursor Canvas exposes comments that an outside service can read. Check this before promising Canvas.
- Whether a page comment can ever raise a blocking finding, for example after a PLX member confirms it in Mission Control.

## Steps

| Step | Task | What ships | State |
|---|---|---|---|
| 1 | TASK-4056 | This PRD and the workstream note | Merged (#487) |
| 2 | TASK-4059 | Migration `056_drafts.sql` (054 and 055 were taken), `src/lib/drafts`, the five tools, REST routes, capabilities, `docs/modules/drafts/README.md` and the `DATA_MODEL.md` entry. 056 also adds the columns Accept needs, so step 3 has no migration | Merged (#489) |
| 3 | TASK-4071 | Drafts screen, session routes under `/api/drafts`, Accept, the Drafts to review panel on Approvals, a Drafts nav item. Drafts turn on by default; `PLX_MC_DRAFTS_ENABLED=0` is the kill switch | Merged (#492) |
| Follow-up A | TASK-4109 | New draft form, slice A: session routes to create, save, submit and withdraw; the form for the settings, the plan and the research submit needs (see Follow-up: New draft form) | Merged (#497, #499) |
| Follow-up B | TASK-4110 | New draft form, slice B: risks, open questions and artifacts in the form; a dependency picker; reordering | Merged (#503) |
| Follow-up C | TASK-4130 | Artifact uploads: `mc_upload_draft_artifact` stores a draft's file under `Drafts/DRF-n/` in the `Mission Control` library (see Follow-up: artifact uploads) | Merged (#505) |
| Follow-up D | TASK-4129 | Skill updates: `project-researcher` and `guided-project-discovery` end by saving a draft (`petralabx/skills` 1.6.15) | Merged (petralabx/skills#48) |
| Follow-up E | TASK-4131 | Uploads from the New draft form (`POST /api/drafts/{id}/artifacts`) | Merged (#505) |
| Follow-up F | TASK-4132 | The governance-contract rule and the skills catalog pin | Merged (#507) |
| Follow-up | Not created | Review on a shared page: "Publish for review" and the comment relay, Claude Artifacts first (see Follow-up: review on a shared page). After step 3 is live and in use | Not started |

Step 2 touches a migration, so it lands only with a signed MC merge approval of its exact head.

## Out of scope

- Accept by an agent, or any automatic Accept.
- Moving existing tasks or buckets into a draft's plan.
- A SharePoint list for drafts.
- Blocking direct creates by agents.
- Any VMC surface or data.

## Rollback

- **Step 1:** revert the PR. It changes docs only.
- **Step 2:** the migration is additive, and its rollback script drops only what 056 added: the two tables, their id sequence and the trigger function. Revert and deploy the code, and 056's manifest entry, before running it: every API route checks the database against the manifest. To stop drafts without a rollback, set `PLX_MC_DRAFTS_ENABLED=0`, the kill switch.
- **Step 3:** revert the PR, or set `PLX_MC_DRAFTS_ENABLED=0`. Records that Accept already created are ordinary records. Archive them with the existing archive action.

## Open questions

- **Accept and a crash between a create and its record.** Resolved in step 3 (see Accept): the task's record commits with the task, a project or bucket is adopted by its PRD link, and a claim refuses a parallel Accept. The create functions stay unchanged. Ricardo or Stephen reviews the choice on the step 3 PR.
