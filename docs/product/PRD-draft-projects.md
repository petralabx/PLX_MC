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

A source is internal (a repo path, an MC id, a SharePoint document) or external (a web page). Step 2 accepts artifacts as links, inline markdown and inline Mermaid. File uploads wait for a follow-up, because `mc_upload_evidence` needs a task and a live checkout (`src/lib/mcp/evidence-actions.ts`).

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

The author names reviewers. Each named reviewer sees a draft-review row on the Approvals screen, like a question. Agents read drafts with `mc_list_drafts` and `mc_get_draft`.

## Accept

Accept creates the plan in order: the project (unless it exists), then the buckets, then the tasks. It calls `createProject`, `createBucket` and `createTask` in `src/lib/sync/state.ts` unchanged. Every guard on those paths still applies: the repo allow-list, archive and close checks, the audit log and the SharePoint mirror queue. Accept also checks the project ACL on an existing parent project, as the MCP create actions do (`src/lib/permissions/project-acl-guard.ts`).

Those calls do not share one transaction. So Accept writes each new id into `materialized` before the next create starts. A retry after a failure skips every key that already has an id. Step 3 closes the gap between a create and its record (see Open questions).

On the created records:

- The project's and each bucket's `prd` is the frozen version's link, `https://mc.plxcustomer.io/?screen=drafts&draftId=DRF-n&version=N`. `src/lib/compliance/bucket-prd.ts` counts any http(s) link, so tasks in those buckets pass the PRD check.
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

A draft an agent writes names the agent's person as author. That is the operator email on its MCP call, and it must resolve to a known Petra person. The agent cannot accept for that person: Accept needs that person's own signed-in session.

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
  - Research, Reviews and Versions tabs, with a diff between versions;
  - an Accept button, for the author only. Its confirmation states the counts, such as "Creates 1 project, 3 buckets and 14 tasks".
- "New draft" sits beside "New project" in the shell's create actions.
- The Approvals screen gets draft-review rows for named reviewers.

## Convention for agents (decision 3)

A rule goes into `config/governance-contract.yaml`: a plan that adds a project, or two or more buckets, goes through a draft. The generators carry the rule into `AGENTS.md` and `CLAUDE.md`. `project-researcher` and `guided-project-discovery` end by saving a draft. Those skill changes ship through `petralabx/skills` and the catalog pin.

Nothing blocks a direct create.

## Steps

| Step | Task | What ships | State |
|---|---|---|---|
| 1 | TASK-4056 | This PRD and the workstream note | Merged (#487) |
| 2 | TASK-4059 | Migration `056_drafts.sql` (054 and 055 were taken), `src/lib/drafts`, the five tools, REST routes, capabilities, `docs/modules/drafts/README.md` and the `DATA_MODEL.md` entry. 056 also adds the columns Accept needs, so step 3 has no migration | In review |
| 3 | Not created | Drafts screen, Accept, Approvals rows | Not started |
| Follow-up | Not created | Artifact uploads under `Drafts/DRF-n/` in the `Mission Control` library, the governance-contract rule, skill updates | Not started |

Step 2 touches a migration, so it lands only with a signed MC merge approval of its exact head.

## Out of scope

- Accept by an agent, or any automatic Accept.
- Moving existing tasks or buckets into a draft's plan.
- A SharePoint list for drafts.
- Blocking direct creates by agents.
- Any VMC surface or data.

## Rollback

- **Step 1:** revert the PR. It changes docs only.
- **Step 2:** the migration is additive, and its rollback script drops only what 056 added: the two tables, their id sequence and the trigger function. Revert and deploy the code, and 056's manifest entry, before running it: every API route checks the database against the manifest. To stop drafts without a rollback, turn `PLX_MC_DRAFTS_ENABLED` off, which is the kill switch.
- **Step 3:** revert the PR, or set the flag off. Records that Accept already created are ordinary records. Archive them with the existing archive action.

## Open questions

- **Accept and a crash between a create and its record.** Step 3 picks one of two fixes. The create functions can accept the caller's transaction; today `createTask` only runs extra caller work inside its own transaction (`options.inTransaction`), and `createProject` and `createBucket` have no transaction option. Or an idempotency claim per draft key can reuse the `mc_events` claim pattern in `src/lib/mcp/task-create-idempotency.ts`. Ricardo or Stephen reviews the choice.
