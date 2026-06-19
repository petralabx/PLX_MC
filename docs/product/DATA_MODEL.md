# Data Model

Canonical entity shapes. Field names map to SharePoint columns per
`SHAREPOINT_INTEGRATION.md §3`. Types are descriptive; use your platform's idioms
(DTOs, enums, FK relations). The implementation lives in `src/lib/mc-data/types.ts`
(authoritative) — this doc tracks it. Refreshed for the directory/accountability
(EN-003), repo registry (EN-002/005), collaboration (EN-001), and agent
operational-model (EN-005) increments: the roster is real (no fabricated humans),
`Repo` carries governance metadata (no fabricated `openPRs`/`openTasks`), and the
repo registry is persisted (`mc_repos` / `mc_repo_requests`, migration 008).

---

## Task  (`MC_TASKS`, indexed by `MC_TASK_IDX`)
```jsonc
{
  "id": "TASK-223",                 // string, unique, indexed
  "title": "Product development",
  "description": "",                // long text, optional (editable, EN-001)
  "bucket": "BKT-PROD",             // FK → Initiative.id
  "stage": "planned",               // enum key, see Lifecycle
  "priority": "medium",             // urgent | high | medium | low
  "assignee": "vibes",             // FK → Person/Agent id (executor), nullable
  "coassignees": [],                // FK[]
  "reporter": "vince",             // FK → Person id
  "accountableOwner": "vince",     // FK → human id (EN-003); null until taken; gate past `planned`
  "humanOnly": false,              // EN-003 — when true, agents can't be the executor
  "agentRunApproved": false,       // EN-005 — operator approval of an approve-mode agent run
  "reqs": ["REQ-2"],               // PRD requirement ids
  "repos": ["portal-web"],         // FK[] → Repo registry id (allow-list enforced; editable, EN-005)
  "estimate": "M",                 // S | M | L
  "labels": ["go-live"],
  "prs": [ /* PR refs */ ],
  "due": "Jun 15",                 // date (display strings)
  "sync": { "state": "pending", "ts": "—", "sp": "ToDos · item 223" },
  "subtasks": [],                   // Subtask[] (EN-001: + description/assignee/due/status)
  "activity": [ { "age": "now", "who": "vibes", "what": "…", "kind": "move|sync|comment|…" } ],
  "comments": [ /* Comment[] — app-only discussion thread, EN-001; never mirrored */ ],
  "evidence": { "summary": "…", "items": [ { "label": "…", "done": true } ] }, // optional
  "userCreated": false             // true for app-created tasks (persistence flag)
}
```
- `sync.state ∈ { synced, pending, conflict, error }`.
- New tasks: `stage:"backlog"`, `sync.state:"pending"`, `userCreated:true`, id = `nextTaskId()`.
- Accountability/mode gates (`lib/mc-data/policy.ts`, enforced client + server): a
  task can't advance past `planned` without a human `accountableOwner`; an
  `approve`-mode agent executor can't enter the doing band without
  `agentRunApproved`; a done stage requires a complete evidence bundle.
- `Subtask`: `{ id, t, done, who, description?, assignee?, due?, status? }`.
  `Comment`: `{ id, author, body, ts, mentions[], editedTs? }` (app-only).

## Lifecycle  (`MC_STAGES`, 9 stages → 3 bands)
| # | key | name | band | gate |
|---|---|---|---|---|
| 01 | `backlog` | Backlog | To do | |
| 02 | `specced` | Specced | To do | PRD |
| 03 | `approved` | Approved | To do | |
| 04 | `planned` | Planned | To do | |
| 05 | `progress` | In Progress | In progress | |
| 06 | `qa` | In QA | In progress | Evidence |
| 07 | `review` | In Review | In progress | |
| 08 | `merged` | Merged | Done | |
| 09 | `verified` | Verified | Done | |

Bands (`MC_BANDS`): `todo` "To do" · `doing` "In progress" · `done` "Done". The board's "3‑band" mode groups by band; "full lifecycle" shows all 9.

## Priority  (`MC_PRIORITY`)
`urgent` (hot) · `high` (warn) · `medium` (info) · `low` (muted). Each has a 4‑segment `tick` glyph for compact display.

## Initiative / Bucket  (`MC_BUCKETS`, indexed by `MC_BUCKET_IDX`)
```jsonc
{
  "id": "BKT-CPV2",
  "name": "Customer Portal v2",
  "owner": "maya",                 // FK → Person id
  "health": "risk",                // track | risk | off  → On track | At risk | Off track
  "target": "Jul 18",             // date
  "started": "2026.04.02",        // date
  "desc": "…",
  "repos": ["portal-web","portal-api","design-sys"],
  "sync": { "state": "synced", "ts": "…", "sp": "Roadmap · row 12" },
  "prd": "PRD-CPV2"                // FK → PRD id
}
```

## Person & Agent  (`MC_HUMANS`, `MC_AGENTS`, merged into `MC_ACTORS`)
```jsonc
// Human (the real PLX directory — Greg, Rishi, Ricardo, Stephen, Ross, Vince; EN-003)
{ "id":"vince", "kind":"human", "name":"Vince Alton", "init":"VA",
  "role":"Owner", "dept":"IT", "email":"vince@petrasoap.com", "online":true,
  "invited": false }              // invited:true for email-invited colleagues
// Agent (curated roster + operational model; EN-005)
{ "id":"vibes", "kind":"agent", "name":"Vibes", "init":"VB",
  "model":"Sonnet", "team":"Dev", "mode":"auto", "online":false,
  "capabilities":["code","refactor","tests"], "defaultRepos":["portal-web","agentic-swarm"] }
```
- Agent `mode ∈ { auto "Autonomous", approve "Needs-approval" }` (`MODE`) — **enforced**
  (`policy.ts`), not a display-only label: an `approve`-mode executor needs operator
  approval before the doing band.
- `Agent.online` is honest (no heartbeat → `false`); live presence is **derived**
  from in-flight assignment (`agentIsActive` / `liveAgentCount`). `defaultRepos` is
  **advisory** (the task-level allow-list governs; no hard binding in v1).
- Directory helpers: `directory()`, `isPetraEmail(email)`, `invitePerson(email)`,
  `personByEmail(email)`, `domainOf(email)`. Domains: `petralabx.com`, `petrasoap.com`.

## Repo  (`REPOS` seed → persisted `mc_repos`; EN-002/005)
```jsonc
// Registry entry (= the allow-list). Honest metadata only — no fabricated counts;
// open-PR/task counts are DERIVED from task membership (repos-view).
{ "id":"portal-web", "name":"plx-customer-portal", "lang":"TypeScript · Next.js",
  "def":"master", "owner":"taylorvalton", "visibility":"private",
  "scope":"Customer portal web application — the go-live codebase." }
```
- The registry is the **allow-list**: only registry ids may attach to a bucket/task
  (humans and agents alike), enforced client + server against the **persisted**
  registry (`mc_repos`) — not the static fixture.
- `visibility ∈ { public, private }`. The three canonical repos are `portal-web`
  (plx-customer-portal), `agentic-swarm`, and `plx-mc`.

### RepoRequest  (self-service request → approve; persisted `mc_repo_requests`)
```jsonc
{ "id":"RR-new-tool", "name":"new-tool", "owner":"taylorvalton",
  "scope":"…", "requestedBy":"greg", "requestedTs":"2026.06.19 · 12:00",
  "status":"pending",              // pending | approved | rejected
  "verified":true,                 // GitHub-org validation outcome (never fabricated)
  "visibility":"public", "def":"main", "lang":"TypeScript",
  "decidedBy":"vince", "decidedTs":"…" }
```
- A request joins the registry only via an **approver** (Owner/Admin) approval that
  **re-validates** against the GitHub org. Endpoints: `POST /api/repos`,
  `POST /api/repos/{id}/approve|reject`.

## Milestone / Risk
Milestone: `{ name, bucket, state(Upcoming|Active|At risk|Met), col(date), sp }`.
Risk: `{ title, bucket, like(High|Medium|Low), impact(High|Medium|Low), owner, status(Open|Mitigating|Closed), mit }`.

## File / Folder  (`MC_FILES`, flat list w/ `parent` pointers)
```jsonc
// Folder
{ "id":"fo-cpv2", "name":"Customer Portal v2", "kind":"folder", "parent":null, "bucket":"BKT-CPV2" }
// File
{ "id":"fi-prd-cpv2", "name":"PRD-CPV2 — Customer Portal v2.docx", "kind":"doc",
  "parent":"fo-cpv2-prd", "bucket":"BKT-CPV2", "docType":"PRD",
  "modified":"2026.06.08 · 14:20", "modifiedBy":"scribe", "size":"48 KB",
  "sync": { "state":"synced", "ts":"2026.06.08 · 14:21" } }
```
- `kind ∈ { folder, doc, pdf, sheet, img, zip, md }` (drives the type chip).
- `docType ∈ { PRD, Evidence, Deed, Report, Spec, Export }`.
- Helpers: `MC_filesIn(parentId)`, `MC_fileById(id)`.

## Sync schema objects  (see SHAREPOINT_INTEGRATION.md)
`MC_SP` (site + 5 lists w/ columns), `MC_SP_LIST` (keyed), `MC_SP_CONFLICTS`, `MC_SP_ERRORS`. Engine helpers: `MC_syncCounts()`, `MC_pendingTasks()`, `MC_markAllSynced(stamp)`, `MC_applyInbound(stamp)`, `MC_addTask(input)`, `MC_clearUserTasks()`.

## Notifications / Inbox  (`MC_INBOX`)
```jsonc
{ "id":"…", "kind":"approval|conflict|review|mention|assigned",
  "text":"…", "task":"TASK-214", "age":"now", "unread":true }
```
