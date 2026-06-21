# Data Model

Canonical entity shapes, taken from `prototype/mc-data.js`. Field names map to SharePoint columns per `SHAREPOINT_INTEGRATION.md §3`. Types are descriptive; use your platform's idioms (DTOs, enums, FK relations).

---

## Task  (`MC_TASKS`, indexed by `MC_TASK_IDX`)
```jsonc
{
  "id": "TASK-214",                 // string, unique, indexed
  "title": "Inline deed signing on the workbench",
  "description": "",                // long text, optional
  "bucket": "BKT-CPV2",             // FK → Initiative.id
  "stage": "qa",                    // enum key, see Lifecycle
  "priority": "high",               // urgent | high | medium | low
  "assignee": "vibes",             // FK → Person/Agent id, nullable
  "coassignees": [],                // FK[]
  "reporter": "maya",              // FK → Person id
  "reqs": ["REQ-2"],               // PRD requirement ids
  "repos": ["portal-web","portal-api"], // FK[] → Repo key
  "targetEnv": "staging",          // staging | production (optional; default staging)
  "estimate": "M",                 // S | M | L
  "labels": ["frontend"],
  "prs": [ /* PR refs */ ],
  "due": "Jun 16",                 // date (prototype uses display strings)
  "sync": { "state": "synced", "ts": "2026.06.09 · 09:09", "sp": "ToDos · item 214" },
  "subtasks": [],
  "activity": [ { "age": "now", "who": "vibes", "what": "…", "kind": "move|sync|comment|…" } ],
  "evidence": { "summary": "…", "items": [ { "label": "…", "done": true } ] }, // optional
  "userCreated": false             // true for modal-created tasks (prototype persistence flag)
}
```
- `sync.state ∈ { synced, pending, conflict, error }`.
- New tasks (modal): `stage:"backlog"`, `sync.state:"pending"`, `userCreated:true`, id = `MC_nextTaskId()`.
- `repos` is an editable target (multi-select, pushed via the Repos column). Mutability is lifecycle-gated: freely editable while planning (`backlog`→`planned`) or while unset; once work is in flight (`progress`→`verified`) an existing target locks behind an explicit **Retarget** action that requires a reason (recorded to the activity trail + audit log). Policy lives in `repoEditMode` (`src/components/mc/record-logic.ts`).
- `targetEnv` is the deployment target (`staging` default / `production`), pushed via the **Target Environment** Choice column. Always editable — unlike `repos`, promoting staging→production is normal lifecycle progression, not a retarget.

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
// Human
{ "id":"maya", "kind":"human", "name":"Maya Aldosari", "init":"MA",
  "role":"Admin", "dept":"Engineering", "email":"maya.aldosari@petralabx.com", "online":true,
  "invited": false }              // invited:true for email-invited colleagues
// Agent
{ "id":"vibes", "kind":"agent", "name":"Vibes", "init":"VB",
  "model":"Sonnet", "team":"Dev", "mode":"auto", "online":true }
```
- Agent `mode ∈ { auto "Autonomous", approve "Needs-approval" }` (`MC_MODE`).
- Directory helpers: `MC_directory()`, `MC_isPetraEmail(email)`, `MC_invitePerson(email)`, `MC_personByEmail(email)`, `MC_domainOf(email)`. Domains: `petralabx.com`, `petrasoap.com`.

## Repo  (`MC_REPOS`)
```jsonc
{ "id":"portal-web", "name":"plx-customer-portal",
  "lang":"TypeScript · Next.js", "openPRs":4, "openTasks":9, "def":"main" }
```

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
