# SharePoint Integration — Two‑Way Sync Contract

This is the backbone of the build. Mission Control is a lens over a **single SharePoint Online site** that is the canonical **system of record**. Sync is **two‑way**, conflicts are **resolved manually by a human**, and every reconciliation is written to an **audit log**.

The prototype encodes this entire schema in `prototype/mc-data.js → window.MC_SP` (plus `MC_SP_CONFLICTS`, `MC_SP_ERRORS`, `MC_FILES`, and the sync‑engine helpers). This doc restates it as an implementable spec. Where the prototype and this doc differ, **this doc wins**.

---

## 1. Site

| | |
|---|---|
| Display name | **PLX Mission Control** |
| Host | `petrasoap.sharepoint.com` |
| Server‑relative path | `/sites/plx-mission-control` |
| Timezone | **UTC** (store/compare in UTC; render in the viewer's tz) |
| Cadence | **every 5 min** (delta poll) **+ on change** (Graph change webhook) |

Provision with PnP PowerShell or the Graph API: create the site, then the lists/libraries, then columns (exact internal names + choice values below), then default views. Index the `*ID` columns.

---

## 2. Entities ↔ Lists (the 5 registers)

| MC entity | SharePoint object | Kind | Default direction |
|---|---|---|---|
| **Task** | `ToDos` | List | two‑way |
| **Initiative** (+ Gantt) | `Roadmap` | List | two‑way |
| **Milestone** | `Milestone Register` | List | two‑way |
| **Risk** | `Risk Register` | List | two‑way |
| **File / folder** | `Project Documents` | Document library | two‑way |

Per‑field direction overrides the list default. Direction semantics:

- **two‑way `↔`** — edits flow both ways; simultaneous edits to the same field go to the **review queue**.
- **push `→`** — Mission Control is authoritative; write to SharePoint, never read back.
- **pull `←`** — SharePoint is authoritative; read into MC, never write.

---

## 3. Column specifications

> Column `Name` = the SharePoint display name (set a stable internal name too). `MC field` = the property on the MC entity (see DATA_MODEL.md). Choice columns must be created with **exactly** the listed values.

### 3.1 `ToDos` — Task  (two‑way, ~15 items)
| SharePoint column | Type | MC field | Dir | Notes |
|---|---|---|---|---|
| Title | Single line of text | `title` | ↔ | required |
| Task ID | Single line of text | `id` | ← | **required, indexed, unique key** |
| Status | Choice | `stage` | ↔ | Backlog → Verified, **9 values** (see §4) |
| Assigned To | Person | `assignee` | ↔ | mirrors owner; drives notification |
| Reporter | Person | `reporter` | → | |
| Priority | Choice | `priority` | ↔ | Urgent / High / Medium / Low |
| Due Date | Date and time | `due` | ↔ | |
| Initiative | Lookup → Roadmap | `bucket` | ↔ | |
| PRD Requirements | Multi line of text | `reqs` | → | requirement IDs, newline‑joined |
| Estimate | Choice | `estimate` | → | S / M / L |
| Repos | Multi line of text | `repos` | → | repo keys, newline‑joined |
| Target Environment | Choice | `targetEnv` | → | Staging / Production (default Staging) |
| Evidence Complete | Yes/No | `evidence` | → | derived: all evidence items done |
| Description | Multi line of text | `description` | ↔ | |

### 3.2 `Roadmap` — Initiative + Gantt  (two‑way, 5 items)
| SharePoint column | Type | MC field | Dir | Notes |
|---|---|---|---|---|
| Title | Single line of text | `name` | ↔ | required |
| Initiative ID | Single line of text | `id` | ← | required, unique |
| Owner | Person | `owner` | ↔ | |
| Health | Choice | `health` | ↔ | On track / At risk / Off track |
| Start Date | Date and time | `started` | ↔ | **Gantt bar start** |
| Target Date | Date and time | `target` | ↔ | **Gantt bar end** |
| % Complete | Number | `progress` | → | 0–100 |
| PRD Link | Hyperlink | `prd` | → | |

### 3.3 `Milestone Register` — Milestone  (two‑way, 5 items)
| SharePoint column | Type | MC field | Dir | Notes |
|---|---|---|---|---|
| Title | Single line of text | `name` | ↔ | required |
| Initiative | Lookup → Roadmap | `bucket` | ↔ | |
| State | Choice | `state` | ↔ | Upcoming / Active / At risk / Met |
| Due Date | Date and time | `col` | ↔ | timeline column position |
| Register Ref | Single line of text | `sp` | ← | |

### 3.4 `Risk Register` — Risk  (two‑way, 4 items)
| SharePoint column | Type | MC field | Dir | Notes |
|---|---|---|---|---|
| Title | Single line of text | `title` | ↔ | required |
| Initiative | Lookup → Roadmap | `bucket` | ↔ | |
| Likelihood | Choice | `like` | ↔ | **High / Med / Low** (see §5.2 error) |
| Impact | Choice | `impact` | ↔ | High / Medium / Low |
| Owner | Person | `owner` | ↔ | |
| Status | Choice | `status` | ↔ | Open / Mitigating / Closed |
| Mitigation | Multi line of text | `mit` | ↔ | |

### 3.5 `Project Documents` — File  (document library, two‑way, ~12 items)
**Folder structure:** `/{Initiative}/PRD`, `/{Initiative}/Evidence`, `/{Initiative}/Deeds`, `/{Initiative}/Reports`, plus a top‑level `/Shared`.

| SharePoint column | Type | MC field | Dir | Notes |
|---|---|---|---|---|
| Name | File | `name` | ↔ | required |
| Initiative | Lookup → Roadmap | `bucket` | → | folder metadata |
| Document Type | Choice | `docType` | ↔ | PRD / Evidence / Deed / Report / Spec / Export |
| Modified | Date and time | `modified` | ↔ | |
| Modified By | Person | `modifiedBy` | ← | |

---

## 4. Enumerations

- **Task Status (9, ordered):** Backlog → Spec → In Progress → In Review → In QA → Changes Requested → Merged → Verified, plus a Blocked flag. (Confirm the exact 9 against `MC_STAGES` in `mc-data.js` and lock the choice set before provisioning.)
- **Priority:** Urgent / High / Medium / Low.
- **Initiative Health:** On track / At risk / Off track.
- **Milestone State:** Upcoming / Active / At risk / Met.
- **Risk Likelihood/Impact:** High / Medium / Low (note the Likelihood column's stored choices are `High / Med / Low` — see §5.2).
- **Risk Status:** Open / Mitigating / Closed.
- **Document Type:** PRD / Evidence / Deed / Report / Spec / Export.

---

## 5. Conflict & error model

Resolution is **manual** — a human always picks the winning value, and the choice is written to the audit log. There is no automatic last‑write‑wins.

### 5.1 Conflicts (two‑sided)
Raised when the same field was edited on **both** sides since the last successful sync. Each conflict carries: `{ id, list, entity, entityId, field, mcVal, spVal, detected, by, note }`. The UI surfaces them in the **review queue** (Sync console) and inline on the entity (Task detail's `TaskRecord`). Actions: **Keep Mission Control** or **Keep SharePoint**. On resolve: write the chosen value to the loser, clear the conflict, decrement the list's conflict count, mark the item synced, append an audit row.

Seed examples in the prototype:
- `TASK-140 · Status` — MC "In Progress · due Jun 18" vs SharePoint "Blocked · due Jun 20" (edited in SharePoint by Dana).
- `RISK-1 · Likelihood` — MC "Medium" vs SharePoint "High" (compliance raised it).

### 5.2 Push errors (one‑sided, value invalid)
Raised when an outbound write is rejected by SharePoint (e.g. a Choice value that isn't in the column's set). Carries `{ id, list, entity, entityId, field, value, reason }`. UI offers **Edit value / Retry push**. Seed example: `RISK-4 · Likelihood = "Medium"` rejected because the column expects `High / Med / Low`. **Implementation note:** normalize MC's `Medium` → SharePoint's `Med` in the mapping layer for the Likelihood column, or align the column's choices — this is exactly the class of bug the error queue exists to surface.

### 5.3 Audit log
Every reconciliation appends `{ ts, actor, body, state }` where `state ∈ {synced, pending, conflict, error}`. Persist server‑side; the Sync console renders the most recent first.

---

## 6. Sync engine → Microsoft Graph

The prototype fakes the sweep (`MC_markAllSynced`, `MC_applyInbound`). Replace with:

**Outbound (push):** on MC mutation, map changed fields per §3 direction and `PATCH` the list item / driveItem. Newly created MC entities (e.g. a task from the modal) are `pending` until the first successful write, then `synced`.

**Inbound (pull):** use **Graph delta queries** to detect SharePoint‑side changes:
- Lists: `GET /sites/{site-id}/lists/{list-id}/items/delta`
- Library: `GET /sites/{site-id}/drives/{drive-id}/root/delta`
Persist the `deltaLink` per list/library between sweeps. Map pulled fields into MC entities; if a field also changed locally → raise a conflict (§5.1) instead of overwriting.

**Real‑time:** register **change notifications (webhooks)** so edits surface without waiting for the 5‑min poll:
- `POST /subscriptions` with `resource: /sites/{site-id}/lists/{list-id}`, a `notificationUrl`, and `expirationDateTime`; renew before expiry. On notification, run a scoped delta for that list.

**Counts:** after every sweep recompute per‑list `{ synced, pending, conflict, error }`; the UI's topbar pill, sidebar badge, register cards, and console summary all derive from these (`MC_syncCounts()` in the prototype).

**Suggested API surface** (replaces the `window.MC_*` mutations):
| Prototype helper | Endpoint (suggested) |
|---|---|
| `MC_addTask(input)` | `POST /api/tasks` → creates ToDos item, returns task w/ `sync.state: pending` |
| reassign in `TaskRecord` | `PATCH /api/tasks/{id}` → updates Assigned To, triggers notification |
| `MC_markAllSynced` | `POST /api/sync/sweep` → run outbound+inbound, returns new counts + audit rows |
| conflict resolve | `POST /api/sync/conflicts/{id}/resolve { winner: "mc" | "sp" }` |
| push error retry | `POST /api/sync/errors/{id}/retry` |
| `MC_applyInbound` | (no endpoint — this is what the real inbound delta does) |

---

## 7. Identity, directory & tasking

**Directory:** taskable people are any users at `@petralabx.com` (the lab/engineering arm) or `@petrasoap.com` (the soap business). Resolve via Graph:
```
GET /users?$filter=endsWith(mail,'@petralabx.com') or endsWith(mail,'@petrasoap.com')&$count=true
```
(`ConsistencyLevel: eventual` header required for `endsWith`.) Cache; surface in the **PeoplePicker** typeahead alongside agents.

**Invite by email:** typing a **valid Petra email not yet in the directory** offers "Invite {email}". Implement as a guest/B2B invite *or* a pending‑assignment record, per your IT policy. The prototype's `MC_isPetraEmail` regex is the validation rule: `^[^@\s]+@(petralabx|petrasoap)\.com$` (case‑insensitive).

**Block external:** any non‑Petra domain is rejected in the picker with a clear message ("… can't be tasked — only @petralabx.com and @petrasoap.com colleagues"). Enforce the same rule server‑side.

**On assignment (human):**
1. Mirror the assignee to the entity's **Assigned To** Person column (two‑way).
2. Dispatch a **notification** via Teams + email (Graph: `POST /teams/.../chatMessage` or an Adaptive Card, and/or `POST /users/{id}/sendMail`).
3. UI shows the `NotifyTrail` indicator ("mirrored to SharePoint · notified via Teams + email") and writes an activity‑log entry.

**Placeholder data:** the names in `MC_HUMANS` / `MC_DIRECTORY_EXTRA` are invented placeholders — replace with the live Microsoft 365 directory at build time.

---

## 8. Provisioning quick‑reference

1. Create site `/sites/plx-mission-control`.
2. Create 4 lists (`ToDos`, `Roadmap`, `Milestone Register`, `Risk Register`) + 1 library (`Project Documents`).
3. Add columns exactly per §3 (display + internal names, types, choice sets). Index `Task ID`, `Initiative ID`.
4. Create the library folder tree per §3.5.
5. Set up the sync service: app registration (Graph app perms: `Sites.ReadWrite.All`, `User.Read.All`, `Mail.Send`, `ChannelMessage.Send` as needed), delta queries, webhooks, the mapping layer (§3 directions + the Likelihood normalization §5.2), conflict queue, and audit log.
6. Wire the front‑end data layer + real‑time invalidation (README §8).
