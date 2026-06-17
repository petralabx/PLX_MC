# PLX Mission Control — Cycle 2 Research Dossier

**Date:** 2026-06-16 · **Scope:** Cycle-2 deepening on the Cycle-1 spine (MS Planner features + Linear UX)
**Repo:** `C:/Users/vince/PLX_MC` (standalone Next.js 16 / React 19 / Postgres app — *not* the agentic-swarm `apps/vmc-web`)
**Status of Cycle 1:** complete in spec (PR-0 mutation spine + PR-A group-by/filter + PR-B drag + PR-C inline editing + PR-D1 My Tasks).

---

## 0. Premise correction (Truth Before Action / Evidence Over Assertion)

The three inputs to this dossier disagreed on the single most consequential fact — whether a chart
library is already present. I ground-truthed it against **this** repo and the answer is decisive:

| Claim source | Claim | Verdict against `C:/Users/vince/PLX_MC` |
|---|---|---|
| EXTERNAL research | "`recharts@^3.8.1` is already a production dependency; reuse it; native SVG would violate Reuse-Before-Create" | **FALSE for PLX_MC.** That research was reading `apps/vmc-web/...` in a *different* repo (the agentic-swarm worktree). |
| INTERNAL map | "No chart layer exists; zero chart libraries; confidence ring is CSS-only" | **TRUE.** Verified below. |

**Evidence (this repo):**
- `C:/Users/vince/PLX_MC/package.json` dependencies = `clsx, next, next-auth, pg, react, react-dom, tailwind-merge, zod`. **No `recharts`, `d3`, `chart.js`, `visx`, `nivo`, or `victory`** — `grep -iE "recharts|chart\.js|\"d3\"|visx|nivo|victory" package.json package-lock.json` returns nothing.
- `find src -iname "*chart*"` → no results. There is no `mini-chart.tsx` in PLX_MC; that file lives in the other repo.
- The only "chart-like" precedent is a **pure-CSS conic-gradient ring**: `src/components/mc/atoms.tsx:46-54` (`Confidence`) sets `--pct` and renders a `.ring` span — no SVG, no library.

**Consequence for the Charts decision:** the real native-vs-add-dep question for PLX_MC is **"native SVG vs. add recharts (a brand-new dependency)"** — *not* "reuse an existing recharts." Adding recharts here is a genuine new-dependency decision under CLAUDE.md Pillar 3, and must clear the External-Integrations bar (owner, kill switch, etc.). The repo's whole Cycle-1 doctrine was **zero new runtime deps**; native SVG preserves that and matches the existing `--p-*`-token, CSS-ring precedent. Recommendation below follows the evidence, not the EXTERNAL premise.

---

## 1. Post-Cycle-1 current-state map (file:line, verified 2026-06-16)

### 1.1 The mutation spine (frozen public seam)
- `src/lib/mc-data/store.ts` — `patchTaskFields(taskId, patch, opts?)` is the **one** persisted-mutation entry point: optimistic apply → emit → `PATCH /api/tasks/{id}` → adopt server task on success, rollback + `pushNotice` on failure. Thin wrappers: `setTaskStage`, `setTaskPriority`, `setTaskBucket`, `setTaskLabels`, `setCoassignees`, `addSubtask`, `toggleSubtask`, `reassignTask`. Test hook `__setPatchMirrorForTests`.
- Getters available to any new view: `allTasks()`, `taskById()`, `directory()`, `allActors()`, `spLists()`, `openConflicts()`, `openErrors()`, `auditLog()`, `storeSyncCounts()`, `lastSweep()`; reactive via `subscribe()` + `getVersion()`.

### 1.2 Pure helpers (unit-tested, composable) — `src/components/mc/work-views.helpers.ts`
- `GroupBy = "band" | "stage" | "bucket" | "priority" | "assignee"` (L8); `columnsFor`/`boardColumns`, `columnKeyForTask`, `partitionTasksByColumn`.
- Drag: `DragField` (L103), `dragFieldForAxis` (L105), `resolveColumnDrop`, `isNoopDrop`.
- **Filtering:** `FilterState` (L233), `hasActiveFilters` (L241), `applyFilters` (L253), `labelUniverse`, `assigneeUniverse` — all pure, exported, testable.
- **Timeline:** `TIMELINE_DEFAULT_END_DAY = 24` (L20), `timelineRangeForTask` (L334), `dueDay` (L302), `bucketsForTimeline`. **Fixed June grid; read-only.**

### 1.3 Components — `src/components/mc/`
- `work-views.tsx` — unified board/list/timeline/mine surface. **Filter state is ephemeral:** `const [filters, setFilters] = useState<FilterState>({})` at **L499** (no `localStorage`, no URL). `setFilters({})` clear at L561/L713. Board layout class `board${groupBy === "band" ? "" : " compact"}` (L235) is load-bearing (see `mc-views.css`).
- `filter-bar.tsx` — presentational; parent owns `FilterState`. Text + facet pills + removable chips + "/" focus + "Esc" clear. No date control yet.
- `label-editor.tsx` — reusable controlled chip editor (`normalizeLabel`/`addLabelTo`/`removeLabelFrom` + `LabelEditor`).
- `task-detail.tsx` — inline editing for assignee, coassignees, labels, subtasks, bucket (Cycle-1 PR-C).
- `atoms.tsx` — `Confidence` CSS conic-gradient ring (L46-54): **the native-render precedent for charts.**
- `command-palette.tsx` — nav actions work; **stubs (`run: () => {}`):** `create:new-bucket` (L64), `create:draft-prd` (L66-71), `assign:*` agents group (L122-134). No task-context actions.
- Chrome/routing: `chrome.tsx`, `route.ts`, `screens.tsx` — adding a screen = `Screen` union + `screens.tsx` map + sidebar item + palette `nav:` entry (the My-Tasks PR is the worked example).

### 1.4 Persistence / sync (verified)
- **Tiers — `src/lib/sync/state.ts`:** `PUSHED_FIELDS = ["title","stage","priority","due","description"]` (**L117**). `patchTask` only sets `syncState:"pending"` when `pushedDirty.length > 0` (**L134**), so DB-only fields (bucket, labels, coassignees, subtasks, assignee) never falsely queue a push. `PatchTaskInput` documents the new DB-only fields (L97-108); tier comment L110-116.
- **Audit trail — `db/migrations/003_audit_log.sql:6-12`:** `sync_audit_log(id, ts timestamptz, actor, body, state CHECK IN ('synced','pending','conflict','error'))`, index on `ts DESC` (L14). Append-only; written via `repo.appendAudit`. **This is the only historical signal available for any time-series chart.**
- **Engine — `src/lib/sync/engine.ts`:** `pushEntity`, `pullList` (delta + conflict via `dirty_fields`), `resolveConflict`, `runSweep`, `ensureSeeded`.
- **Scheduler — `src/lib/sync/scheduler.ts`:** dormant by default. `syncEnabled()` = `process.env.PLX_MC_SYNC_ENABLED === "1"` (L12-14); `startSyncScheduler` logs "scheduler disabled" and returns when off; 5-min `CADENCE_MS` (L8). Architecture is correct, just gated.
- **Mapping deferral — `src/lib/sync/mapping.ts:6-12`:** person + lookup columns (Assigned To, Reporter, Owner, **Initiative**) "deliberately NOT mapped yet" — need real M365 identities / lookup-id resolution (directory increment). This is the gate on pushing bucket/assignee.
- **State surface — `src/lib/sync/state.ts:23-46`:** `snapshot()` reads `repo.getEntities("task"|"risk"|"file")` + conflicts/errors/audit/counts — the aggregation source for charts.

### 1.5 Under-utilized data already on `Task` (read-only today — `src/lib/mc-data/types.ts`)
`evidence`, `blocked/blockedReason`, `merge`, `prs`, `reqs`, `repos`, `reporter`, `estimate`. `estimate` (S/M/L) is the candidate "measure" axis if charts ever sum effort instead of counting.

---

## 2. GAP / OPPORTUNITY matrix — Cycle-2 candidates

Value/Effort/Risk are H/M/L. "Blocks C2?" = does anything in Cycle 2 depend on it (all candidates are additive — none block).

| # | Candidate | Gap (what's missing now) | Value | Effort | Risk | Native vs add-dep | Blocks C2? |
|---|---|---|---|---|---|---|---|
| 1 | **Charts/Insights — current-state breakdowns** | No chart layer; only CSS confidence ring (`atoms.tsx:48`). Need status donut + bucket/assignee/priority bars + overdue KPI. | **H** | **M** (≈300-500 LOC native SVG) | **L** | **Native SVG** (zero new dep; matches `--p-*`-token CSS-ring precedent). Adding recharts = new dependency + External-Integrations bar — rejected. | No |
| 2 | **Charts — time-series (burndown / burn-up / CFD)** | No snapshot table; only the `sync_audit_log` *narrative* exists. Time-series needs daily status counts. | M | **H** (snapshot job + parser + tests) | **M-H** (audit text is semi-structured; parser is fragile) | Native SVG render; the hard part is the **data layer**, not the chart. | No (gate the view; hide if no history) |
| 3 | **Saved views / filter persistence** | `useState<FilterState>({})` (`work-views.tsx:499`) resets on reload/navigate. No `localStorage`, no URL, no server table. | **H** | **L** (localStorage Phase 1) / M (Postgres saved_views Phase 2) | **L** (local) / M (server table + routes) | Native (Web Storage / URL). Phase 2 needs a migration + `apiRoute()` route. | No |
| 4 | **Command-palette depth** | `create:new-bucket`, `create:draft-prd`, `assign:*` are `run: () => {}` stubs (`command-palette.tsx:64,66,122`). Palette dispatches navigation only. | M | **L** (quick-win task actions) | **L** | Native (reuse store wrappers). | No |
| 5 | **Timeline filtering / scheduling** | `TIMELINE_DEFAULT_END_DAY=24` fixed June grid (`work-views.helpers.ts:20`); no date-range filter, no drag-to-schedule, no group-by. | M | **L** (filter) / M (drag) / M (month-zoom) | **L** (filter) / **M** (drag cell bounds) | Native (extend `FilterState` + existing HTML5 DnD). | No |
| 6 | **Bulk actions / multi-select** | No selection model; every mutation is single-task. | M | **M** (selection store + checkbox renderers + bulk routes) | **M** | Native (new selection store + spine fan-out). | No |
| 7 | **Enable the sync scheduler** | Engine is correct but dormant (`scheduler.ts:12-14`). | M (proves cadence) | **L** (env toggle + cadence test) | **L** | Native (env flag). | No |
| 8 | **Person/lookup SP resolution** | bucket→Initiative + assignee/coassignee person-ids unmapped (`mapping.ts:6-12`). | M | **H** (M365 Graph directory + lookup-id cache) | **H** (credentials, tenant, long-lead) | Add Graph query helpers — but external/credential-gated. | No (Cycle-1 is honest about deferral) |

**Cross-cutting observations**
- Items 2 and 8 are **data/credential-gated**, not UI problems. They are the natural Cycle-3 line.
- Items 1, 3, 4, 5, 7 are pure-client or env-flag changes that reuse the Cycle-1 spine and helpers — high value, low risk, no migrations.
- A universal pattern from both MS Planner and Linear: **one shared status color legend reused on every chart**, and **every chart segment is click-to-filter** into the task list. PLX_MC already has the filter substrate (`applyFilters`/`FilterState`) to make charts a navigation surface — so chart→filter wiring is cheap and should ship with the charts.

---

## 3. Recommended Cycle-2 module set (reuse-first, 3-4 modules)

Building directly on the Cycle-1 spine (`patchTaskFields`, `GroupBy`, `applyFilters`/`FilterState`, `--p-*` tokens). Sequenced so each module is independently shippable and de-risks the next.

### Module E — Insights view (current-state charts) — **native SVG, zero new deps** · P0
**What:** New `insights` screen: Status **donut** + total KPI, **Bucket** stacked bar, **Assignee** stacked bar (explicit "Unassigned"), **Priority** breakdown, **Overdue** KPI (`stage != done && dueDay(due) < today`). One shared status color legend. Each segment is **click-to-filter** → navigates to board/list with that `FilterState` applied (reuses Cycle-1 filter substrate).
**Why native SVG, not recharts:** PLX_MC has **zero** chart deps (§0); recharts would be a *new* runtime dependency subject to the External-Integrations contract and contrary to the Cycle-1 zero-new-dep doctrine. The five P0 charts are static bars/arcs — well within hand-rolled SVG, themeable with the existing `--p-*` tokens exactly like the `atoms.tsx` confidence ring. (Per-category color maps — `STATUS_CHART_COLORS`, `PRIORITY_CHART_COLORS` — are the documented identity-map exception; annotate with a comment.)
**Reuse:** `allTasks()` + a pure, unit-tested aggregator in `lib/mc-data` (deterministic code, not a model — behavioral-contract item 6); `FilterState`/`applyFilters` for drill-down; `route.ts`/`screens.tsx`/`chrome.tsx`/palette `nav:` for the new screen (My-Tasks is the worked example).
**Files:** new `src/components/mc/insights.tsx` + `src/components/mc/charts/{status-donut,bucket-bar,assignee-bar,priority-bar}.tsx` + pure `src/lib/mc-data/insights.ts`; extend `src/styles/mc-views.css` (or new `mc-charts.css`) tokens-only; tests `tests/insights.test.ts`.
**Value H / Effort M / Risk L.**

### Module F — Saved views & filter persistence (localStorage Phase 1) · P0
**What:** Persist `FilterState` (+ `groupBy`, `swimlanes`) to `localStorage` under a versioned key; hydrate on mount; "Save view" / "Clear saved" affordances in the filter bar. Named local views (e.g., "My urgent", "Blocked").
**Why now:** Highest value-to-effort ratio. The filter bar already exists; the only gap is that state dies on reload (`work-views.tsx:499`). No server, no migration. Defer the shareable Postgres `saved_views` table + `apiRoute()` to Cycle 3.
**Reuse:** existing `FilterState`; add pure `serializeFilters`/`deserializeFilters` to `work-views.helpers.ts` so the roundtrip is unit-tested.
**Files:** extend `work-views.tsx` (`useEffect` sync) + `filter-bar.tsx` (Save/Clear) + `work-views.helpers.ts` (serialize) + `tests/mc-filters.test.ts`.
**Value H / Effort L / Risk L.**

### Module G — Timeline filtering + palette quick-wins (interaction depth) · P1
**What (two small, related deepenings of existing surfaces):**
- *Timeline filtering:* add a "Due (date range)" control to `filter-bar.tsx`; wire the timeline to the same `FilterState` so board/list/timeline stay in sync. Add pure `isTaskDueInRange(task, start, end)` to helpers. (June grid stays; month/zoom deferred.)
- *Palette quick actions:* replace two dead stubs with real single-task actions routed through the spine — "Mark done" (`setTaskStage(id,"merged")`) and "Assign to me" (`reassignTask`). Leaves `new-bucket`/`draft-prd`/agent stubs for Cycle 3.
**Why bundled:** both are thin reuses of the spine + filter substrate, both close visible "stub/!filterable" gaps, and together they're ~1.5-2.5 days. Timeline **drag-to-schedule** is explicitly deferred to Module-G Phase 2 / Cycle 3 (drop-cell bounds are riskier than board columns).
**Files:** `filter-bar.tsx`, `work-views.tsx`, `work-views.helpers.ts`, `command-palette.tsx`, plus `store.ts` thin setter if `closeTask` isn't already covered; tests for the date predicate.
**Value M / Effort L / Risk L.**

### Module H (optional, capacity-gated) — Enable & verify the sync scheduler · P1
**What:** Turn on the dormant 5-min sweep in dev (`PLX_MC_SYNC_ENABLED=1`) and add a cadence/loop test; document the operator kill switch. No engine code changes.
**Why optional:** it proves the persistence cadence end-to-end (good evidence) but ships no user-facing surface, so it yields to E/F/G if capacity is tight. Pairs naturally with a "drag/inline-edit survives reload" browser E2E step (the store's `hydrate()`/`snapshot()` already guarantee the roundtrip).
**Files:** `scheduler.ts` (verify only), `tests/sync-scheduler.test.ts`, env docs.
**Value M / Effort L / Risk L.**

**Recommended set:** **E + F + G** as the core three (all P0/P1, zero new deps, no migrations, all reuse the Cycle-1 spine), with **H** as the capacity-gated fourth.

### Sequencing & rationale
1. **F first** (½-1.5 days) — smallest, unblocks daily usability immediately, and the serialize helpers it adds are reused by Module E's drill-down state.
2. **E next** (5-6 days) — the headline value; consumes F's persisted `FilterState` for click-to-filter.
3. **G** (1.5-2.5 days) — rounds out interaction depth across timeline + palette once charts exist to drive filters.
4. **H** (≈1 day, if capacity) — flips on the engine and proves cadence.

### Native-vs-add-dep decision points (explicit)
- **Charts (Module E): NATIVE SVG.** PLX_MC has zero chart deps; recharts is a *new* dependency here (not a reuse), gated by the External-Integrations contract and against the Cycle-1 zero-dep doctrine. Static bars/donut are well inside native SVG, themeable with `--p-*` tokens like the existing CSS ring. Revisit only if Cycle 3 demands many chart types + animations + drill-down simultaneously — then evaluate recharts as a deliberate, owner-assigned dependency addition.
- **Saved views (Module F): NATIVE Web Storage**, not a DB table, for Phase 1. Postgres `saved_views` (shareable, cross-device) is a deliberate Cycle-3 addition (migration + `apiRoute()` + Zod).
- **Time-series charts (deferred): NATIVE render, but data-gated.** Burndown/burn-up/CFD need a `task_status_snapshot` daily job; until that exists, only current-state breakdowns (Module E) are buildable. Hide the time-series view rather than fake it.
- **Person/lookup push (deferred): add MS Graph helpers** — but this is credential/tenant-gated external work for Cycle 3, not a Cycle-2 native change.

### Deferred to Cycle 3 (explicitly out of scope)
Burndown/burn-up/CFD + the snapshot job (item 2); Postgres `saved_views` + URL-encoded filter state (item 3 Phase 2); full palette agent/bucket actions (item 4 remainder); timeline drag-to-schedule + month/zoom (item 5 Phase 2); bulk multi-select (item 6); person/lookup SP resolution (item 8).

---

## 4. Critical files for Cycle-2 implementation (absolute paths, this repo)
- Spine + getters: `C:/Users/vince/PLX_MC/src/lib/mc-data/store.ts`
- Pure helpers (GroupBy/filter/timeline): `C:/Users/vince/PLX_MC/src/components/mc/work-views.helpers.ts`
- Unified surface + ephemeral filter state (L499): `C:/Users/vince/PLX_MC/src/components/mc/work-views.tsx`
- Filter bar: `C:/Users/vince/PLX_MC/src/components/mc/filter-bar.tsx`
- Native-render precedent (CSS ring): `C:/Users/vince/PLX_MC/src/components/mc/atoms.tsx` (L46-54)
- Palette stubs: `C:/Users/vince/PLX_MC/src/components/mc/command-palette.tsx` (L64,66,122)
- Persistence tiers (PUSHED_FIELDS L117 / gate L134): `C:/Users/vince/PLX_MC/src/lib/sync/state.ts`
- Audit trail (time-series source): `C:/Users/vince/PLX_MC/db/migrations/003_audit_log.sql`
- Scheduler (dormant): `C:/Users/vince/PLX_MC/src/lib/sync/scheduler.ts`
- Mapping deferral: `C:/Users/vince/PLX_MC/src/lib/sync/mapping.ts` (L6-12)
- Types (under-used fields): `C:/Users/vince/PLX_MC/src/lib/mc-data/types.ts`
- Screen wiring: `route.ts`, `screens.tsx`, `chrome.tsx` in `C:/Users/vince/PLX_MC/src/components/mc/`
- Token source: `C:/Users/vince/PLX_MC/src/styles/` (`brand-tokens.css`, `mc-views.css`; `--p-*` namespace)

---

## 5. Areas of uncertainty (flagged)
- **No live external doc fetch.** This worktree's guard firewalls WebSearch/WebFetch (trading-lab host allowlist). MS Planner / Linear product behaviors here are from authoritative product knowledge and the EXTERNAL input's canonical URLs (Planner Charts, Linear Insights/Cycles/Dashboards), **not** freshly retrieved. Re-verify exact current UI labels from an unrestricted environment before locking any user-facing copy.
- **EXTERNAL input was repo-mismatched.** Its `recharts`/`mini-chart.tsx` "evidence" is from `apps/vmc-web` (the agentic-swarm worktree), not PLX_MC. All PLX_MC chart-dependency claims in §0 were re-verified directly here. The EXTERNAL functional/UX requirements (status/bucket/assignee/priority breakdowns, shared legend, click-to-filter, burn-up over burndown, CFD = WIP/bottleneck) remain sound product guidance and are folded into Module E and the deferred time-series tier.
- **Time-series (burndown/CFD) is fully data-gated.** Without a persisted daily `task_status_snapshot` (or a reliable parse of the semi-structured `sync_audit_log` body text), only current-state breakdowns are buildable. Treat the snapshot job as the prerequisite, not the chart.
- **`estimate` measure** (count vs. sum-of-effort) is available on `Task` (S/M/L) but unmapped to a numeric scale; confirm the scale before offering an effort-measure toggle.
