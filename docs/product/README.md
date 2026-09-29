# Handoff: Petra Lab‑X Mission Control

> Agent‑operated work hub for Petra Lab‑X, with a **two‑way SharePoint mirror** as the system of record and **colleague tasking** across the `@petralabx.com` / `@petrasoap.com` directory.

This bundle is a developer handoff package. It documents a working HTML prototype precisely enough that an engineer who was **not** in the design conversation can rebuild it end‑to‑end in a production stack.

---

## 1. Read these in order

| Doc | What's in it |
|---|---|
| **README.md** (this file) | Product overview, architecture, every screen, interactions, state, how to run the prototype. |
| **screenshots/SCREENS.md** | **Annotated screenshots of all 16 screens** — numbered callouts keyed to a legend. The visual companion to §6 below. |
| **SHAREPOINT_INTEGRATION.md** | The two‑way sync contract: site, the 5 lists/libraries, every column + type + sync direction, conflict model, the sync engine, and the Microsoft Graph endpoints to implement it. **This is the backbone of the build.** |
| **DATA_MODEL.md** | Canonical entity shapes (Task, Initiative, Milestone, Risk, File, Person) and enums. |
| **DESIGN_TOKENS.md** | Exact colors, type scale, spacing, radii, motion, and component recipes. |

---

## 2. About the design files

The `prototype/` folder is a **design reference built in HTML + React (Babel‑in‑browser)**. It is *not* production code to lift verbatim. The task is to **recreate these designs in the target codebase's environment** — its component library, router, data layer, and design‑token system — not to ship the prototype.

Where the prototype simulates a backend (in‑memory data, `localStorage`, a fake "Sync now" sweep), the corresponding **real** implementation is specified in `SHAREPOINT_INTEGRATION.md`. Treat the prototype as the **spec for look + behavior**, and the integration doc as the **spec for the backend**.

**Fidelity: HIGH.** Final colors, typography, spacing, copy, and interactions are all intentional. Rebuild the UI pixel‑accurately using the codebase's existing primitives. The visual language follows the **Petra Lab‑X "Mazius/ledger" design system** (see DESIGN_TOKENS.md) — a warm‑paper, editorial, instrument‑panel aesthetic. Do **not** restyle it into a generic SaaS theme.

---

## 3. What the product is

Mission Control is the human's cockpit over a team of background **agents**. Agents do work (write code, draft PRDs, run QA); humans **review, approve, assign, and resolve**. Three principles drive every screen:

1. **Everything resolves to a Task.** A task is the atom of work.
2. **Every change mirrors to the record.** SharePoint is the canonical system of record; the UI is a fast, opinionated lens over it. Sync is **two‑way**.
3. **Work is traceable.** PRD requirement → task(s) → PR(s) → evidence → test status → merge commit. Any unmet requirement is a visible GAP.

The audience is internal Petra Lab‑X / Petra Soap staff. People can be tasked by email across both domains.

---

## 4. Architecture of the prototype

Single‑page app. `index.html` loads React 18 + Babel standalone, the two stylesheets, then the component scripts in order. Each `mc-*.jsx` is a `<script type="text/babel">`; components publish themselves to `window` (no module system).

```
prototype/
├── index.html            Script/style load order + #root mount + speaker-notes-free shell
├── mrp-styles.css        DESIGN TOKENS (:root + .dark) + base "MRP" instrument-panel skin
├── mc-styles.css         App component skin, layered on the tokens above
│
├── mc-data.js            ★ ALL DATA + the SharePoint schema (MC_SP) + helpers + sync engine
├── mc-atoms.jsx          Avatar, SyncTick, Confidence, PMark, shared tiny components
├── mc-people.jsx         PeoplePicker (directory typeahead, invite-by-email, domain block) + NotifyTrail
├── mc-chrome.jsx         Topbar (brand, search, live sync pill, dark toggle), Sidebar, CommandPalette
├── mc-views.jsx          InboxView (home), WorkViews (Board / List / Timeline), Traceability
├── mc-bucket.jsx         BucketDetail (initiative): Documents & Links, embedded SP list, milestones, risks
├── mc-task.jsx           TaskDetail + TaskRecord (the two-way "system of record" block)
├── mc-feed.jsx           Agent activity feed
├── mc-sync.jsx           ★ SyncHealth (the Sync console): register mapping, review queue, live sweep, audit
├── mc-files.jsx          FilesView (the Project Documents document library)
├── mc-newtask.jsx        NewTaskModal (the human authoring surface)
├── mc-app.jsx            App shell: routing, nav(), sync event bus, Tweaks panel, modal host
├── tweaks-panel.jsx      Tweaks scaffold (in-design controls; not part of the product)
├── logo-horizontal-ink.svg, favicon.svg
```

**Routing** is a single `route` object `{ screen, bucketId?, taskId? }` in `mc-app.jsx`; `nav(screen, extra)` switches screens. Screens: `home` (Inbox), `board` / `list` / `timeline` (WorkViews), `traceability`, `feed` (Agent activity), `bucket`, `task`, `sync`, `files`, `repos`.

**Sync event bus:** mutations dispatch `window.dispatchEvent(new Event("mc-sync"))`; the shell listens and re‑reads counts so the topbar pill and sidebar badge stay live. In production, replace this with your store/subscription (React Query invalidation, SignalR/webhook push, etc.).

**Persistence in the prototype** (all `localStorage`, all to be replaced by the API):
- `plx_mc_user_tasks_v1` — tasks created via the New Task modal.
- `plx_mc_invited_people_v1` — colleagues invited by email.

---

## 5. How to run the prototype

Serve `prototype/` over any static server (the Babel CDN needs http(s), not `file://`):

```bash
cd prototype && python3 -m http.server 8080   # → http://localhost:8080
```

Dark mode: the moon/sun toggle in the topbar. "Show tweaks" is a design tool, not a product feature.

---

## 6. Screens & views

> **See `screenshots/SCREENS.md` for annotated screenshots of every screen** — numbered callouts keyed to a legend. The descriptions below are the written companion.

Layout shell on every screen: **Topbar** (height ~52px, sticky) over a 2‑column body — **Sidebar** (fixed 232px) + **main column** (`.mc-main`, fluid). Main column always opens with a **page header** (`.ph`): a mono kicker, a Mazius serif `<h1>` with one italic accent word, a muted subtitle (max 66ch), and right‑aligned actions.

### 6.1 Topbar — `mc-chrome.jsx › Topbar`
Left: brand wordmark "Petra Lab‑X" (Mazius 18px) + mono "MISSION CONTROL" divider label + workspace switcher chip. Right: command‑palette search field (`⌘K`), **live sync pill**, dark toggle, user avatar.
- **Sync pill** states (click → `sync` screen): `ok` "Synced" (green dot), `pending` "N pending" (muted), `warn` "N to resolve" (amber) when conflicts+errors > 0. Reads `MC_syncCounts()`.

### 6.2 Sidebar — `mc-chrome.jsx › Sidebar`
Sections: **Inbox** (unread badge) · **VIEWS** (Board, List, Timeline, Traceability, Agent activity w/ "N live") · **BUCKETS** (one row per initiative, each with a **status tick** — a 2px vertical bar, green/amber/slate for on‑track/at‑risk/off‑track) · **SYSTEM OF RECORD** (Repos, Files, Sync w/ "to‑resolve" badge).
- The bucket health tick is the editorial replacement for a colored dot; it grows slightly on hover/active. See DESIGN_TOKENS.md → "Status tick".

### 6.3 Inbox / home — `mc-views.jsx › InboxView`
The default screen. Two grouped sections using `.inbox .grouphd` headers (mono uppercase label on the left, **count pushed to the right via `margin-left:auto`** — e.g. "NEEDS YOUR ATTENTION … 3 UNREAD"):
- **Needs your attention** — notification rows (`.nrow`): leading unread dot, a kind tag (`APPROVAL` green / `CONFLICT` amber / `REVIEW` blue / `MENTION` / `ASSIGNED`), body copy, right‑aligned age.
- **Assigned to me** — task rows: mono task id, title, confidence ring + assignee avatar, due date.
- Header actions: "Agent activity ◉", "New ⌘K".

### 6.4 Board / List / Timeline — `mc-views.jsx › WorkViews`
One component, three modes via the toolbar segmented control.
- **Board:** Kanban columns. Toolbar tweaks: stage banding (`3-band` vs `full lifecycle`), swimlanes (`off` / `human · agent`). Cards show id, title, requirement + repo chips, a confidence bar, assignee, and a sync state pill.
- **List:** dense table — id, title, stage, assignee, due, sync. Group‑by is a Tweak (`bucket` / `status` / `assignee`).
- **Timeline:** a Gantt. Each lane = an initiative; **bars are 7px rounded pills** (`seg-track`/`seg-risk`/`seg-blocked`; `seg-done` = ghost outline), urgent rows get a 9px bar + soft amber halo (`.crit`). Cycle bands tint alternating zones; milestone diamonds sit on the rail. (Bar state classes are namespaced `seg-*` to avoid colliding with global `.track`/`.risk` rules — keep that discipline in the rebuild.)

### 6.5 Traceability — `mc-views.jsx › Traceability`
The auditable matrix: **Requirement → task(s) → PR(s) → evidence → test status → merge commit**, with an Export action. Any unmet requirement renders as a **GAP** row. This is the artifact that proves PRD coverage.

### 6.6 Agent activity — `mc-feed.jsx`
Live feed of what agents are doing (streaming/working/awaiting‑review), each linking to its task.

### 6.7 Initiative (bucket) detail — `mc-bucket.jsx › BucketDetail`
Two columns.
- **Left:** PRD summary; an **embedded SharePoint ToDos list** (`.splist`) styled like a real MS List — header "ToDos (MS List) · {initiative}", columns Task ID / Title / Status / Assigned To (avatars) / Sync, footer "Mirrors two‑way … last sync". Empty state asks for an https PRD link and saves it on the initiative.
- **Right:** **Documents & Links** panel (`.doclinks`) — rows for Project Plan, Roadmap, Milestone Register, Risk Register (MS Lists), Project Documents (Library → Files screen), and each GitHub repo; then Milestones, Risks, and a traceability summary.

### 6.8 Task detail — `mc-task.jsx › TaskDetail` + `TaskRecord`
Full task page: title, description (honors user‑entered text), requirement/repo chips, PRs, evidence checklist, activity log, and an assignee control that opens the shared **PeoplePicker**. Reassigning to a human logs "mirrored to SharePoint · notified via Teams + email" and shows a `NotifyTrail`.
- **`TaskRecord` — the "System of record" block:** shows the task's SharePoint item and the **mapped fields** (Status / Assigned To / Due Date / Priority) each with a ↔ direction glyph, an **"Open in SharePoint"** link, and a **"Sync now"** button. If the task has an open conflict (e.g. `TASK-140`), it renders inline **Keep Mission Control / Keep SharePoint** buttons; resolving logs to audit and clears the conflict.

### 6.9 Sync console — `mc-sync.jsx › SyncHealth`  ★
The two‑way mirror cockpit. Sections:
1. **Site bar** — connection (Connected · Microsoft 365), cadence, last sweep, timezone.
2. **Registers (×5)** — collapsible `SpRegister` cards. Header: icon, list title + kind (list/library), the mapping summary (`↔ Tasks`), and per‑state counts (synced/pending/conflict/error). Expanded: a **field‑mapping table** — *Mission Control field → direction glyph → SharePoint column → type*, with required/notes. This table *is* the column spec; see SHAREPOINT_INTEGRATION.md.
3. **Review queue** — every conflict as a two‑sided card (Mission Control value vs SharePoint value) with **Keep MC / Keep SharePoint**; push **errors** (e.g. invalid choice value) get **Edit value / Retry push**. Manual resolution only — a human always picks the winner.
4. **Sync audit log** — timestamped, actor‑attributed rows with a state pill.
- **"Sync now"** runs a sweep: flips all pending → synced, then applies one simulated **inbound** SharePoint edit (`TASK-188` due date) so two‑way flow is visible, and writes both to the audit log.

### 6.10 Files — `mc-files.jsx › FilesView`
The **Project Documents** document library. Breadcrumb + folder drill‑down. One top‑level folder per initiative (`PRD · Evidence · Deeds · Reports`) plus a `Shared` root. Table: Name (kind chip + folder health dot), Type, Modified, Modified By (avatar), Sync. "Sync now" reconciles pending files.

### 6.11 New Task modal — `mc-newtask.jsx › NewTaskModal`  ★
The human authoring surface. Opened from ⌘K → "New task", the empty‑board CTA, a bucket's "Start blank", or the Tweaks "New task" button. Fields: **title** (required), description, **initiative** (required), **owner** (PeoplePicker), priority (segmented), stage (select), due (date), estimate (S/M/L), PRD requirements (chips scoped to the chosen initiative's PRD), repos (chips), labels (add/remove). Footer shows where it lands + that it mirrors **Pending** to the record. On create → `MC_addTask()` appends the task, persists, navigates to the board. `⌘/Ctrl+Enter` submits; `Esc` closes.

### 6.12 Command palette — `mc-chrome.jsx › CommandPalette`
`⌘K`. Grouped: **Create** (New task, New bucket), **Navigate** (every screen), **Buckets**, **Tasks**, **Assign**. Fuzzy filter. "New task" opens the modal.

---

## 7. Interactions & behavior

- **Navigation:** all via `nav(screen, extra)`. Task cards/rows → `task`; bucket rows → `bucket`; sync pill/badge → `sync`; doc links → `files`/`repos`.
- **Create task:** title + initiative required → Create enables. Appends live, persists to `localStorage`, lands on the board filtered to its initiative. New tasks start `stage: backlog`, `sync.state: pending`.
- **Assign / task a colleague:** PeoplePicker typeahead over the directory (both Petra domains) + agents. Typing a **valid Petra email not yet present** offers "Invite {email}"; a **non‑Petra domain** is blocked with a clear message. On pick of a human, mirror assignee → SharePoint "Assigned To" and dispatch a Teams/email notification (prototype shows the `NotifyTrail` indicator).
- **Sync now** (console, task, files): async sweep (~0.9–1.5s) → pending become synced; console also pulls one inbound edit. Dispatches `mc-sync`.
- **Conflict resolution:** manual. Keep MC / Keep SharePoint → conflict removed, count decremented, item marked synced, audit row added.
- **Dark mode:** toggles `.dark` on the root; all tokens have dark values.
- **Motion:** durations `--p-dur-fast/dur/dur-slow`, easing `--p-ease`. Modal animates transform only (opacity stays 1) so it survives print/reduced‑motion/capture. Respect `prefers-reduced-motion`.
- **Responsive:** at ≤1100px the list view drops secondary columns and the `h1` shrinks; the layout is desktop‑first (this is an internal cockpit).

---

## 8. State management

Prototype keeps state in React local state + module‑level arrays in `mc-data.js`, bridged by the `mc-sync` event. For production:

| Prototype mechanism | Production replacement |
|---|---|
| `window.MC_TASKS` etc. (module arrays) | Server data via your data layer (React Query / RTK Query / Apollo). |
| `MC_addTask`, `MC_invitePerson`, `MC_markAllSynced`, `MC_applyInbound`, `MC_clearUserTasks` | API mutations (see SHAREPOINT_INTEGRATION.md §6). |
| `localStorage` (`plx_mc_user_tasks_v1`, `plx_mc_invited_people_v1`) | Server persistence. |
| `mc-sync` window event | Cache invalidation + push (webhook/SignalR) so the pill/badge update in real time. |
| `route` object in `mc-app.jsx` | Your router (URL‑addressable screens; deep‑link tasks/initiatives). |

Key derived values: `MC_syncCounts()` (topbar/sidebar), `MC_tasksInBucket(id)`, `MC_evidenceComplete(ev)`, `MC_pendingTasks()`.

---

## 9. Assets

- `logo-horizontal-ink.svg`, `favicon.svg` — Petra Lab‑X marks (in `prototype/`).
- Fonts via CDN: **Mazius Display** (Fontshare), **Inter** + **JetBrains Mono** (Google Fonts). Self‑host these in production.
- Avatars are initials‑in‑a‑box (no image assets) — see `mc-atoms.jsx › Avatar`.
- No icon library: glyphs are unicode (`▦ ◷ ◆ △ ❒ ❮❯ ↔ → ←`). Swap for your icon set if preferred, keeping the same semantics.

---

## 10. Build checklist (end‑to‑end)

1. **Provision SharePoint** per SHAREPOINT_INTEGRATION.md §2–4 (site, 5 lists/libraries, exact columns + choice values + folder structure).
2. **Stand up the sync service** §5–6: Graph delta queries + change webhooks, field mapping per direction, the conflict queue, and the audit log.
3. **Identity / directory** §7: resolve `@petralabx.com` / `@petrasoap.com` users via Graph; implement invite + domain validation; wire assignee → "Assigned To" + Teams/email notification.
4. **Rebuild the UI** from §6 here + DESIGN_TOKENS.md, screen by screen, in your framework.
5. **Wire state** per §8 (data layer + real‑time invalidation replacing the `mc-sync` event).
6. **Traceability + evidence** (§6.5) — the audit story; make sure GAP detection is server‑computed.

---

*Questions for the design side are tracked in the conversation; the directory names in the prototype are placeholders to be replaced with the real Microsoft 365 directory.*
