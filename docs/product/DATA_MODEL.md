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

## Project  (`projects` table / SharePoint `Projects` list)
```jsonc
{
  "id": "PRJ-PORTAL-GOLIVE",
  "name": "PLX Portal Go-Live",
  "owner": "vince",                // FK → Person id (accountable human)
  "health": "track",               // track | risk | off  → On track | At risk | Off track
  "target": "Oct 01",             // date
  "started": "2026.06.11",        // date
  "desc": "…",
  "repos": ["portal-web"],
  "sync": { "state": "synced", "ts": "2026.07.22 · 13:25", "sp": "Projects · item 1" },
  "prd": null                      // FK → PRD id, nullable
}
```
- Optional parent above Bucket (P2): operators organize initiatives under a Project; buckets without a parent are valid (`project` unset / `NULL`).
- Persisted in `projects` (`id`, jsonb `data`, `sync_state`, `sp_item_id`) — same pattern as `buckets` (`db/migrations/011_projects.sql`).
- **Sync posture:** two-way mirror with the SharePoint `Projects` list (`SHAREPOINT_INTEGRATION.md §3.2`): `pullProjects` reads routing-relevant fields inbound, while Owner and PRD remain Mission Control push-only (`docs/modules/sync/README.md`). Production site `/sites/plx-mission-control` has the list provisioned (cutover evidence: `artifacts/sync/2026-07-13-prod-site-cutover/`; P2 re-verify: `artifacts/sync/2026-07-22-elegant-architecture-hygiene/`). When the list is missing, pending rows are skipped with an audit note and `sync.sp` reads `Projects · unprovisioned`. Projects push before buckets so Roadmap can resolve the Project lookup column.
- Decision record: `docs/product/PRD-project-entity.md`.

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
  "prd": "PRD-CPV2",               // FK → PRD id
  "project": "PRJ-PORTAL-GOLIVE"   // FK → Project.id, nullable/optional
}
```
- `project` maps to `buckets.project_id` (`REFERENCES projects(id) ON DELETE SET NULL`). Nullable so the column is additive — existing buckets stay valid with `NULL` until backfilled; removing a project never cascades into initiatives or tasks.

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

Task / bucket / project `repos[]` store registry **ids** (`portal-web`), not
GitHub slugs. Checkout/compliance use a separate header namespace:

| Purpose | Portal value |
|---|---|
| `MC_REPO` / `X-MC-Repo` (checkout, compliance) | `petralabx/plx-customer-portal` |
| `task.repos[]` / bucket / project repos (allow-list) | `portal-web` |

## Milestone / Risk
Milestone: `{ id, name, bucket, state(now|upcoming|risk), col(date), sp }`.
Risk: `{ title, bucket, like(High|Medium|Low), impact(High|Medium|Low), owner, status(Open|Mitigating|Closed), mit }`.

**Ledger-derived milestones** (bound buckets only) are ephemeral read-time
projections from quality-ledger artifacts — not SharePoint Milestone Register
rows and never synced entities. Provenance is `sp: "Quality Ledger · <module>"`;
they merge with fixture/register milestones on the initiative page. See
`docs/modules/loop-ledgers/README.md` § Bucket projection.

## Traceability
Trace: `{ bucket, rows[] }` where each row is `{ req, tasks[], prs[], evidence(complete|incomplete), test, merge, status(satisfied|in-review|in-progress|gap) }`.

**Ledger-derived trace rows** (bound buckets without a fixture matrix) are the
same ephemeral projection: one row per ledger artifact, attributed via the bucket
projection API, never pushed to SharePoint registers. Fixture trace (e.g. PRD req
chains) still wins when present for a bucket.

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
`MC_SP` (site + 6 lists w/ columns), `MC_SP_LIST` (keyed), `MC_SP_CONFLICTS`, `MC_SP_ERRORS`. Engine helpers: `MC_syncCounts()`, `MC_pendingTasks()`, `MC_markAllSynced(stamp)`, `MC_applyInbound(stamp)`, `MC_addTask(input)`, `MC_clearUserTasks()`.

## Notifications / Inbox  (`MC_INBOX`)
```jsonc
{ "id":"…", "kind":"approval|conflict|review|mention|assigned",
  "text":"…", "task":"TASK-214", "age":"now", "unread":true }
```
