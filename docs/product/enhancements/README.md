# Mission Control — Enhancements & Fixes Spec

> **Living document.** This is the shared backlog of feature enhancements and
> bug fixes for PLX Mission Control. Vince drops screenshots + a one‑line note;
> we align on the high‑level requirement; the agent writes it up here as a
> structured entry. Once items are captured and aligned, they roll up into a
> concrete implementation plan (see [§ Implementation Plan](#implementation-plan)).

---

## How this doc works

1. **Capture** — Vince adds a screenshot to `screenshots/` and describes the
   issue or desired change in one or two sentences.
2. **Align** — We discuss until the *high‑level requirement* is clear and agreed.
3. **Write** — The agent adds an entry to the [Backlog](#backlog) with:
   status, area, the screenshot, observed vs. desired behavior, and notes.
4. **Plan** — When enough items are aligned, we formalize them into the
   [Implementation Plan](#implementation-plan): ordered, scoped, with verification.

**Screenshots:** save to `docs/product/enhancements/screenshots/` using the
convention `NN-short-slug.png` (e.g. `01-sync-pill-overflow.png`). Reference
them from the entry. Keep slugs lowercase kebab‑case.

**Status values:** `Triage` (captured, not yet discussed) → `Aligned`
(requirement agreed) → `Planned` (in the implementation plan) → `In Progress`
→ `Done` → `Wontfix` / `Deferred`.

**Type values:** `Fix` (something is broken) · `Enhancement` (improve existing)
· `Feature` (net‑new).

---

## Backlog

> Newest entries at the top. Each entry has a stable `EN‑NNN` id. Don't reuse
> ids even after an item is Done or Wontfix.

<!-- ENTRY TEMPLATE — copy this block for each new item
### EN‑NNN — <short title>

| | |
|---|---|
| **Status** | Triage |
| **Type** | Fix / Enhancement / Feature |
| **Area** | <screen / module, e.g. Sync console, Inbox, Board> |
| **Screenshot** | `screenshots/NN-slug.png` |
| **Priority** | P0 / P1 / P2 / P3 (set during alignment) |

**Observed / current behavior**
<what happens today, or what's missing>

**Desired behavior / requirement**
<the agreed high‑level requirement>

**Notes / open questions**
<edge cases, dependencies, decisions still needed>

---
-->

### EN‑004 — Meeting → Mission Control bridge (Teams capture to governed tasks)

| | |
|---|---|
| **Status** | Aligned |
| **Type** | Feature |
| **Area** | New capability — meeting intake; touches `sync` module, Inbox/triage, task creation, SharePoint mirror |
| **Screenshot** | _none (open-ended architecture ask)_ |
| **Priority** | TBD (set during planning) |

**The ask (operator)**

Team meetings (usually MS Teams) generate tasks/notes/action items by hand. Make
this automated and tied into Mission Control. What's the first-class path —
voice-transcribing LLM, MS Teams / Loop integration — and how do we bridge the
human gap between meetings and action items while keeping the governance,
organization, and project-plan rigor that Mission Control provides?

**Agent's recommendation — native Microsoft Graph, post-meeting ingestion**

The first-class path is **Microsoft Graph**, not a third-party transcriber or a
real-time media bot. Microsoft already owns identity, recording consent,
compliance, and (with Copilot) action-item extraction — so we ingest its
artifacts rather than rebuild them. Two tiers by licensing:

- **Tier A — raw transcript (no Copilot license):**
  `GET /users/{id}/onlineMeetings/{id}/transcripts/{id}/content` returns a `.vtt`
  transcript. We run our own extraction LLM to pull action items. (Transcript
  APIs are no longer metered as of Aug 2025.)
- **Tier B — native Meeting AI Insights (needs M365 Copilot license):**
  `GET /copilot/users/{id}/onlineMeetings/{id}/aiInsights` returns structured
  `actionItems` (`title`, `text`, `ownerDisplayName`), meeting notes, and
  `@mention` events with timestamps — no AI infra to maintain.

**Proposed flow (bridges the human gap with governance):**

1. **Trigger** — subscribe to Graph change notifications for meeting
   transcripts; fire when a meeting ends (insights can lag up to ~4h).
2. **Capture** — pull AI-insight action items (Tier B) or transcript + extract
   (Tier A).
3. **Draft** — a Scribe-style agent normalizes each item into a **proposed
   task**: suggested title, owner (resolved against the EN‑003 real directory via
   `@mention`/displayName), candidate bucket, due date — with the transcript
   snippet + timestamp attached as **evidence**.
4. **Human confirm (the governance bridge)** — proposed items land in a
   **Meeting Intake / triage queue**, *not* the live board. A human (the EN‑003
   accountable owner) reviews, edits, assigns, links to bucket/PRD, then
   **promotes** to a governed Task. Nothing auto-enters the plan unconfirmed
   (Truth Before Action).
5. **Mirror + trace** — on promotion, create the Task, mirror to SharePoint, and
   keep the meeting source as a traceability artifact.

**On Loop:** Loop's programmatic surface is immature for action-item extraction
(.loop/.fluid files live in SharePoint/OneDrive but there's no rich API). Use
Teams meeting artifacts as the first-class source for v1; revisit Loop later as a
collaborative-notes surface if desired.

**Why not the alternatives (for the record):**

- *Real-time media bot* (Graph cloud communications): heavier infra + consent
  complexity, marginal benefit over post-meeting recap.
- *Third-party voice LLM* (e.g. Whisper/external): pushes meeting data outside
  the M365 tenant — a data-boundary/governance problem. Only a fallback if Teams
  transcription is unavailable.

**Aligned decisions**

- **Source (both tiers):** use native **Meeting AI Insights** when users are
  M365 Copilot-licensed; **fall back to raw transcript + our own extraction**
  when not. One pipeline, two capture adapters.
- **Human-in-the-loop:** meeting-derived items land in a **Meeting Intake /
  triage queue** and require a human to **promote** them into governed tasks —
  never auto-entered into the plan.
- **Data boundary:** any self-run extraction stays **in-tenant (Azure OpenAI)**;
  meeting transcripts never leave M365/Azure (no external LLM for transcripts).
- **Scope (v1):** **opt-in** — only specific/recurring team meetings we
  designate feed the bridge, not every transcribed meeting in the tenant.
- **Loop:** **deferred** — Teams meeting artifacts only for v1; revisit Loop as a
  collaborative-notes surface later.

**Open for planning stage**

- Capability declaration per External Integrations governance (owner, scope,
  auth source, default state = off, kill switch, health check, audit boundary).
- How meetings opt in (calendar tag, channel, or an explicit register).
- Confirm M365 Copilot licensing status for the 6 users (determines how often
  Tier B vs Tier A runs).
- Owner-resolution rules from `ownerDisplayName`/mentions → EN‑003 directory.

---

### EN‑003 — Real directory, assignment policy & accountability governance

| | |
|---|---|
| **Status** | Aligned |
| **Type** | Fix + Feature |
| **Area** | Directory/assignment (`src/lib/mc-data/data.ts` `HUMANS`/`AGENTS`/`DIRECTORY_EXTRA`, `src/components/mc/people-picker.tsx`, `new-task-modal.tsx`, `task-detail.tsx`, `bucket-detail.tsx`) |
| **Screenshot** | `screenshots/02-assign-dropdown-fake-directory.png` |
| **Priority** | TBD (set during planning) |

**Real people (per operator):** Greg, Rishi, Ricardo, Stephen, Ross, Vince.

**Observed / current behavior**

1. **Entire directory is fabricated.** `HUMANS` (Maya, Tariq, Lena, Evan, Noor),
   `DIRECTORY_EXTRA` (Priya, Felix, Dana, Sam, Inès, Omar, Grace, Rubén), and
   `AGENTS` (Vibes, Atlas, Sentry, Scribe) are all placeholder identities; only
   `vince` is real (and itself a placeholder identity). The assign dropdown
   surfaces these fake people (screenshot).
2. **"Core team" grouping is hardcoded** to the fake ids in `people-picker.tsx`
   (`CORE_TEAM_IDS`).
3. **Agent gating partially exists but is unused.** `PeoplePicker` accepts
   `allowAgents` (default `true`) — there is no per-task policy to mark a task
   human-only and enforce it across the picker, reassignment, and agent pickup.
4. **No enforced accountability.** Tasks/buckets can sit unassigned (the
   screenshot task is "Assigned To · Unassigned"); nothing requires a human to
   be accountable, and ownership changes aren't governed.
5. **No completion governance gate.** Nothing requires a PRD / evidence before a
   task or bucket is considered complete (the agent evidence gate exists in
   `task-detail.tsx` but isn't a universal completion contract).

**Desired behavior / requirement**

1. **Real directory** — replace the fake roster with the actual people (Greg,
   Rishi, Ricardo, Stephen, Ross, Vince) with correct emails, domains, and roles.
2. **Assignment policy at creation** — a human authoring a task can assign **any
   person or any agent**, or mark the task **human-only** to disallow agents
   (reuse the existing `allowAgents` capability, surfaced as a per-task policy).
3. **Strict accountability** — every task *and* bucket is accountable to a real
   person who takes and executes it; enforced (no orphan work past a defined
   stage), with ownership/hand-off logged and mirrored.
4. **Completion governance** — completing a task/bucket requires governance
   artifacts (e.g. PRD present, evidence/acceptance met) before it can be marked
   done. Ties into EN‑001 (description/PRD surface).

**Agent's thoughts / recommendations** *(for discussion)*

- **A human is always accountable, even when an agent executes.** Recommend an
  explicit **accountable owner (human)** distinct from the **executor** (human
  or agent). Agents can do the work, but a named human is on the hook —
  consistent with the governance doctrine (Ownership & Precision).
- **Reuse, don't rebuild:** the `allowAgents` flag already exists; extend it into
  a per-task `humanOnly` policy enforced in every assignment surface.
- **Resolve identities from the source of truth:** pull real emails/roles from
  the Microsoft 365 directory via Graph (credentials available) rather than
  hand-typing, so the directory stays truthful.
- **Make "done" a contract:** a task isn't complete without its evidence; a
  bucket isn't complete without a PRD and all requirements satisfied (the
  Traceability matrix already models GAP vs satisfied — enforce it as a gate).

**Aligned decisions**

- **Directory:** replace the fake roster with **exactly 6 humans** — Greg,
  Rishi, Ricardo, Stephen, Ross, Vince; delete all fabricated human entries and
  the hardcoded `CORE_TEAM_IDS`.
- **Identity source:** resolve each person's **email, domain, and role from the
  Microsoft 365 directory via Graph** (credentials available) so the directory
  is truthful — no hand-typed identities.
- **Agents:** keep an agent roster; agents are **assignable by default**, with a
  per-task **human-only opt-out** (extend the existing `allowAgents` flag into a
  task policy enforced across picker / reassign / agent pickup).
- **Accountability (split model):** every task and bucket has a **human
  accountable owner** distinct from the **executor** (human or agent). A human is
  always accountable; agents may execute but never hold final accountability.
  Enforce: no task/bucket advances past a defined stage without a human owner;
  ownership hand-offs are logged and mirrored.
- **Completion gate:** **Task** complete requires evidence/acceptance met;
  **Bucket** complete requires a PRD present + **all requirements satisfied**
  (no GAP rows in Traceability) + tests pass.

**Open for planning stage**

- Exact Graph lookup + mapping of the 6 identities (emails/roles/domains) and
  how invited-but-unprovisioned people (e.g. Greg, Stephen) are handled.
- Where `accountable owner` vs `executor` live in the data model and SharePoint
  columns.
- Which stage is the hard gate for "must have a human owner".

---

### EN‑002 — Repo registry, seeding, self-service & governance

| | |
|---|---|
| **Status** | Aligned |
| **Type** | Fix + Feature |
| **Area** | Repos (`src/lib/mc-data/data.ts` `REPOS`, `src/components/mc/repos-view.tsx`, `new-task-modal.tsx`, `task-detail.tsx`, `bucket-detail.tsx`) |
| **Screenshot** | _none (code investigation)_ |
| **Priority** | TBD (set during planning) |

**Canonical repos (per operator):** the only repos PLX MC should track right now are
[`plx-customer-portal`](https://github.com/taylorvalton/plx-customer-portal),
[`agentic-swarm`](https://github.com/taylorvalton/agentic-swarm), and
[`PLX_MC`](https://github.com/taylorvalton/PLX_MC).

**Observed / current behavior (root-cause investigation)**

1. **Stale registry.** `REPOS` (`data.ts` lines 106–112) holds five repos:
   `plx-customer-portal` (matches) plus four demo leftovers
   (`plx-portal-api`, `plx-mrp-core`, `plx-design-system`, `plx-infra`) with
   **fabricated** PR/task counts. `agentic-swarm` and `PLX_MC` are **missing
   entirely**.
2. **Buckets/tasks seeded without repos.** Nearly every bucket is `repos: []`
   (only `BKT-DAPI`→`portal-api`, `BKT-INFRA`→`infra`) and nearly every task is
   `repos: []` (only `TASK-222`, `TASK-235`). So opening a bucket/task (e.g.
   `TASK-223`) shows Repos = "—". **This confirms the operator's hypothesis:
   the items were initiated without repos attached.**
3. **Picker sources the wrong list.** New Task modal `repoOptions` = bucket
   repos if any, else `Object.keys(REPOS)`; Repos screen lists the whole
   registry. So the chooser/list surface the placeholder repos.
4. **No self-service, no editing.** `REPOS` is a hardcoded constant — there is
   no UI to register a repo; task detail renders repos read-only.
5. **No governance layer.** No allow-list, ownership, validation, or hygiene
   enforcement tying repo usage (human or agent) to the org's standards.

**Desired behavior / requirement**

1. **Correct the registry** to the three canonical repos; remove the demo
   placeholders; replace fabricated counts with real or honestly-empty values.
2. **Seed/backfill** repo associations on existing buckets and tasks so the work
   already in flight points at the right codebase(s).
3. **Self-service repo registration (future-proof):** let collaborators add
   their own repos through the UI, governed (not free-for-all).
4. **Repo governance + hygiene for humans *and* agents:** an allow-list with
   required metadata (owner, default branch, visibility, scope), enforced at
   registration; agents bound to the same allow-list; new-repo registration
   follows the repo's External Integrations declaration (owner, scope, auth
   source, default state, kill switch, health check) per the governance
   contract.

**Aligned decisions**

- **Registry:** reduce to exactly the **3 canonical repos**
  (`plx-customer-portal`, `agentic-swarm`, `PLX_MC`); delete the 4 demo
  placeholders; replace fabricated PR/task counts with real or honestly-empty
  values.
- **Backfill:** **curated mapping per workstream** (proposed below) — backfill
  existing buckets/tasks rather than auto-attaching everything.
- **Attach level:** **both** bucket and task level (matches the data model).
- **Self-service:** **request → approve** — any collaborator can request a new
  repo; an owner/admin approves before it joins the registry.
- **Governance (strict):** allow-list + required metadata (owner, default
  branch, visibility, scope), **agents bound to the same allow-list**, and new
  repos **validated against the GitHub org via API**. Registration follows the
  External Integrations declaration in the governance contract.

**Backfill mapping (confirmed by operator 2026-06-17)**

All current buckets are PLX Portal go-live workstreams, so **every bucket and
its tasks attach `plx-customer-portal`**. `agentic-swarm` and `PLX_MC` remain in
the registry but are **not attached** to any current bucket/task — they attach
when relevant work appears.

| Bucket | Repo(s) |
|---|---|
| BKT-WMS · WMS Integration | `plx-customer-portal` |
| BKT-DAPI · Decoupling API | `plx-customer-portal` (was `portal-api`) |
| BKT-PROD · Product Development | `plx-customer-portal` |
| BKT-FIN · Finance | `plx-customer-portal` |
| BKT-QMS · QMS | `plx-customer-portal` |
| BKT-SHOP · Shopify → Business Central | `plx-customer-portal` |
| BKT-INFRA · Backend Infra | `plx-customer-portal` (was `infra`) |
| BKT-UAT · UAT | `plx-customer-portal` |

Tasks inherit their bucket's repo(s) unless overridden.

---

### EN‑001 — Collaborative task & sub-task workspace (description + comments)

| | |
|---|---|
| **Status** | Aligned |
| **Type** | Enhancement |
| **Area** | Task detail (`mc-task.jsx` / production task page) **and** Bucket/Initiative detail (`mc-bucket.jsx`) |
| **Screenshot** | `screenshots/01-task-subtasks-no-description-comments.png` |
| **Priority** | TBD (set during planning) |

**Observed / current behavior**

On a task (screenshot: `TASK-223 · Product Development`), the work item is not a
usable collaboration surface:

- **Description** — read-only. The field renders a fallback string and cannot be
  edited in-app (`mc-task.jsx` `/ Description` block, lines 213–218).
- **Sub-tasks** — a flat checklist only: `id · title · done · one avatar`
  (lines 220–234). No per-sub-task description, due date, assignee control, or
  any discussion. (The live app already supports add + check; depth is still
  missing.)
- **Activity** — system-generated only (logged from actions like reassign /
  evidence toggle). There is **no comment composer**, so colleagues and agents
  cannot post free-form notes or have a threaded back-and-forth on the task.
- **Bucket detail** (`mc-bucket.jsx`) has PRD / ToDos / docs / milestones /
  risks but **no discussion thread** at the initiative level either.

**Desired behavior / requirement**

Make the task (and the bucket) a robust, multi-user collaboration workspace so
people and agents can actually work a problem together:

1. **Editable rich description** on the task — inline edit, persisted, mirrored
   to the system of record.
2. **Comments / discussion thread** — free-form notes where humans *and* agents
   can go back and forth: author + avatar, timestamp, `@mention` of colleagues
   and agents, edit/delete own comments. Multi-user.
3. **More robust sub-tasks** — each sub-task gains its own description, assignee
   (human or agent), status, and due date; create / edit / reorder / complete;
   optionally its own short comment thread; ability to promote a sub-task to a
   full task.
4. **Multi-user & traceable** — concurrent users, notifications on mention /
   assignment (Teams + email, consistent with existing assignee flow), and
   two-way mirror to SharePoint as system of record.

**Aligned decisions**

- **Scope:** both — a discussion thread on the **task** *and* a separate
  discussion thread at the **bucket/initiative** level.
- **Comments + Activity:** one **unified timeline** — human/agent comments
  interleaved with system-generated events, newest-first, with clear visual
  distinction between a comment and a system event.
- **Sub-task depth (medium):** each sub-task gains **description, assignee
  (human or agent), due date, and status**, plus create / edit / reorder /
  complete and **promote-to-task**. No per-sub-task comment thread in v1.
- **@mentions:** mentioning a colleague or agent fires the **same Teams + email
  notification + SharePoint mirror path** used by assignment today.
- **SharePoint mirroring:** v1 mirrors **description + sub-task fields** to the
  ToDos list; **comments stay app-only** (no comment column added yet).

**Open for planning stage**

- Priority/sequencing vs. other backlog items.
- Concrete data-model additions (comment entity, sub-task fields) and where they
  live in the production store + SharePoint columns.
- Real-time/concurrency approach for multi-user threads.

---

## Implementation Plan

> Populated once the backlog is aligned. Groups entries into ordered,
> independently shippable workstreams with scope, approach, and verification.
> Each plan item links back to the `EN‑NNN` entries it resolves.

Formalized 2026-06-17 for EN‑001…EN‑004. Each workstream is **one branch / one
PR** (branch hygiene), gated by `./scripts/preflight.sh` and the standard TS
contracts (shared route wrapper, Zod on mutations, `{ data } | { error }`
envelope, `--p-*` tokens). SOPs + module READMEs + SharePoint/VMC roadmap are
updated in the same PR per the repo rules.

### Sequencing & dependencies

```
WS-1 (EN-003)  ──►  WS-2 (EN-002)  ┐
  foundation        repos          ├──►  WS-4 (EN-004)
               └►  WS-3 (EN-001)   ┘     meeting bridge
                    collaboration
```

**WS-1 is the foundation** — the directory/identity + accountability model is
what the sync layer has been deferring (`mapping.ts`: person columns "NOT mapped
yet… deferred directory/notification increment"), and what every other
workstream resolves people through. WS-2 and WS-3 can run in parallel after WS-1.
WS-4 lands last (depends on the directory, triage promotion, and repo linkage).

### WS‑1 — Directory, accountability & assignment policy  · resolves **EN‑003** · P0

| | |
|---|---|
| **Data model** | `types.ts`: add `accountableOwner: string` (always human) distinct from `assignee` (executor, human/agent); add `humanOnly?: boolean` to `Task`; add the three to `TaskFieldPatch` (store.ts) + server `PatchTaskInput` (state.ts). |
| **Directory** | `data.ts`: replace `HUMANS`/`DIRECTORY_EXTRA` with the 6 real people (Greg, Rishi, Ricardo, Stephen, Ross, Vince) resolved from M365 Graph; remove all fakes. Add a `scripts/` Graph resolver to fetch email/role/domain (uses existing Graph creds). Trim `AGENTS` to the real roster. |
| **Picker** | `people-picker.tsx` + `store.ts directory()`: delete hardcoded `CORE_TEAM_IDS`/`core` array; group by role/online; honor a per-task `humanOnly` → `allowAgents={false}` (reuse the existing prop). |
| **Authoring/enforce** | `new-task-modal.tsx`: accountable-owner picker (human-only) + executor picker + human-only toggle. `task-detail.tsx`/`bucket-detail.tsx`: surface owner vs executor; block advancing past a gate stage without a human owner. |
| **Completion gate** | Generalize the agent evidence gate into a universal "done contract": task done ⇒ evidence/acceptance met; bucket done ⇒ PRD present + zero Traceability GAP rows + tests pass. |
| **SharePoint** | Implement the deferred person columns (Assigned To, Accountable Owner, Reporter) in `mapping.ts` + `config/sharepoint-schema.json` + `SP_LISTS`, now that identities are real. |
| **Verify** | Unit: `directory()` ordering, human-only enforcement, owner-required gate, completion contract. Integration: person-column mirror round-trip. `preflight --mode pre-push`. |

### WS‑2 — Repo registry, seeding, self-service & governance · resolves **EN‑002** · P1

| | |
|---|---|
| **Registry** | `data.ts REPOS`: reduce to the 3 canonical repos with honest metadata (no fabricated counts); remove the 4 placeholders. |
| **Seeding** | Backfill `bucket.repos = ["portal-web"]` for all 8 buckets and inherit on their tasks (per the confirmed mapping). `repos-view.tsx` + modal `repoOptions` self-correct once the registry is right. |
| **Self-service** | `request → approve` flow: a repo-request entity + approval action restricted to owner/admin roles (from WS‑1). Repo metadata: owner, visibility, scope, default branch. |
| **Governance** | Allow-list enforced everywhere repos are chosen; **agents bound to the same allow-list**. Validate new repos against the GitHub org via API (`GITHUB_TOKEN`) at registration. Declare per External Integrations contract. |
| **Verify** | Unit: registry shape, backfill correctness, request/approve transitions, allow-list rejection. GitHub validation mocked in tests. `preflight`. |

### WS‑3 — Collaborative task & sub-task workspace · resolves **EN‑001** · P1

| | |
|---|---|
| **Data model** | `types.ts`: new `Comment` (`id`, `author`, `body`, `ts`, `mentions[]`, `editedTs?`) + `comments: Comment[]` on `Task` and `Bucket`; enrich `Subtask` with `description?`, `assignee` (augment `who`), `due?`, `status?`. |
| **Description** | Make description editable: add `description` to `TaskFieldPatch` + inline editor in `task-detail.tsx` (mapping already mirrors `Description`). |
| **Unified timeline** | Merge system activity + human/agent comments into one newest-first stream with a comment composer; `@mention` resolves against the WS‑1 directory; edit/delete own comments. Reuse the component on `bucket-detail.tsx`. |
| **Sub-tasks (medium)** | Per-subtask description/assignee/due/status, reorder/complete, **promote-to-task** (reuse `addTask`). Extend `addSubtask`/`toggleSubtask` already in `store.ts`. |
| **Notifications** | `@mention` fires the existing assignment notify path (Teams + email + mirror). |
| **SharePoint** | Mirror description + sub-task fields; **comments app-only** (app DB), per decision. |
| **Verify** | Unit: comment CRUD, mention→notification, subtask promotion, description patch+mirror. `preflight`. |

### WS‑4 — Meeting → Mission Control bridge · resolves **EN‑004** · P2

| | |
|---|---|
| **New module** | `src/lib/meeting-intake/` (+ `docs/modules/meeting-intake/README.md`). Off by default; kill switch + health check; declared per External Integrations contract. |
| **Capture** | Graph adapters: Tier B `aiInsights` (Copilot-licensed) and Tier A transcript `.vtt` + in-tenant (Azure OpenAI) extraction. Change-notification subscription on meeting end. Opt-in meeting register. |
| **Draft → triage** | Scribe agent normalizes action items into **proposed tasks** in a Meeting Intake triage UI (reuse Inbox patterns), owner resolved via WS‑1 (`ownerDisplayName`/mentions), transcript snippet attached as evidence. |
| **Promote** | Human confirm → `addTask` (governed), repo linkage via WS‑2, mirror to SharePoint, keep meeting source as traceability artifact. |
| **Verify** | Adapter unit tests on fixture payloads; extraction eval; promotion creates a governed task; integration disabled-by-default assertion. `preflight`. |

### Risks / dependencies to confirm before build

- **M365 Copilot licensing** for the 6 users (decides Tier A vs B default in WS‑4).
- **Server-side parity:** each WS that adds a Task field must update `state.ts`
  `PatchTaskInput`, the `/api/tasks` Zod schemas, and the sync engine together
  (no client-only fields).
- **Concurrency** for multi-user comment threads (WS‑3) — optimistic + refresh,
  matching the existing `patchTaskFields` reconcile/rollback pattern.
- **Identity provisioning:** invited-but-unprovisioned people (e.g. Greg,
  Stephen) handling in WS‑1.

### Follow-on increment — SharePoint sync + durability (2026‑06‑18)

The four items WS‑1…WS‑3 explicitly deferred are now resolved, in two PRs:

| # | Deferred item (was) | Resolution | PR |
|---|---|---|---|
| 1 | EN‑003 person columns (Assigned To / Accountable Owner / Reporter) "deferred to the directory increment" — `mapping.ts` never emitted them | Mirrored via `<Column>LookupId` (site User Information List id, cached resolver in `graph.ts`); `assignee` two‑way, owner/reporter push‑only; UIL‑miss / agent persons skipped + audited (app‑only cannot `ensureUser`). Teams/email notification **delivery** stays deferred (in‑app + audit only). | PR‑A `feat/enh-sharepoint-sync` |
| 2 | EN‑002 repo registry + requests in‑memory only; no SharePoint list | `repos` / `repo_requests` persisted in the `plx_mc` DB (migration `005`) + hydrated by the store so approvals survive reload; push‑only "Repo Registry" SharePoint list (declared in `config/integrations.yaml`). | PR‑A `feat/enh-sharepoint-sync` |
| 3 | EN‑001 sub‑task fields → SharePoint mirror | Push‑only `Subtasks` ToDos column (`serializeSubtasks`); MC owns the structured array (never read back). | PR‑A `feat/enh-sharepoint-sync` |
| 4 | EN‑001 bucket‑comment durability (store‑only, lost on reload) | Bucket comments persisted (migration `006`, `PATCH /api/buckets/{id}/comments`) + hydrated; app‑only (never pushed to SharePoint). | PR‑B `feat/bucket-comment-durability` |

Still deferred (honestly): Teams/email notification delivery, Graph change
webhooks, the Initiative lookup column, and Project Documents (driveItem) sync.

### EN‑005 — Flexible buckets (create/edit initiatives) · 2026‑06‑18

Buckets/initiatives were a static `BUCKETS` fixture consumed directly by ~12
files with no create path. EN‑005 makes them first‑class and dynamic.

| | |
|---|---|
| **Persistence** | `buckets` table (migration `007`, full Bucket in `data` jsonb, idempotently seeded from the fixture via `ensureBucketsSeeded`); `snapshot()` returns buckets; the store hydrates them. |
| **Create / edit** | `POST /api/buckets` + `PATCH /api/buckets/{id}` (shared wrapper + zod); store `addBucket` / `updateBucket` are optimistic with reconcile‑on‑success / rollback+notice‑on‑failure; attached repos clamped to the persisted registry. |
| **Dynamic consumers** | `allBuckets()` / `bucketById()` are the single source of truth; every fixture consumer (sidebar, command palette, board/list/timeline + helpers, task/bucket detail, new‑task modal, files, traceability, meeting intake) reads them reactively. Pure helpers (insights, board helpers) take an injected `buckets` param (default = fixture) to stay deterministic. |
| **UI** | "New initiative" modal mounted in the shell, triggered from a sidebar "+ New initiative" affordance and the command palette. |
| **Verify** | Store create/edit reconcile+rollback + allow‑list tests, dynamic‑column helper test, create‑flow E2E; `typecheck` + 363 unit + `build` + `preflight --mode pre-push`; independent auditor ACCEPT. | PR `feat/enh-buckets-flexible` |
| **Deferred (honestly)** | The buckets ↔ Roadmap SharePoint two‑way mirror + the Initiative lookup on ToDos (the engine does not mirror the Roadmap list yet) — buckets are app‑persistent for now, like the repo registry shipped DB‑first. Bucket DELETE/archive is also out of v1. |
