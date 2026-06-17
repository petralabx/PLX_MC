# PLX Mission Control — CYCLE-2 Implementation Spec (WINNING SYNTHESIS)

**Status:** Final · **Author:** Lead architect (synthesis of three Cycle-2 proposals + three judge scorecards) · **Date:** 2026-06-16
**Base branch:** `cycle1/harden-e2e-polish` (all Cycle-1 PRs landed) · **Repo:** `C:/Users/vince/PLX_MC` (standalone Next.js 16 / React 19 / Postgres)
**Verified against the working tree 2026-06-16** (file:line cites re-checked; corrections folded in).

**Lens:** Correctness / risk-first (winning base, all three judges 1st), grafted with Linear-fidelity polish (motion / a11y / shared-legend prescription) and the explicit `sanitizeFilterState` trust-boundary test coverage.
**Doctrine:** `--p-*` tokens only, no raw hex (charts included, via annotated category→token maps); native SVG charts; native Web Storage persistence; shared `route()`/`parseBody()` + Zod unchanged; vitest pure-helper + store/contract tests, Playwright `e2e/`; **ZERO new runtime deps; ZERO SQL migrations.** Every change is additive over the frozen Cycle-1 spine (`patchTaskFields` + wrappers reused verbatim — no new store wrappers).

---

## 1. Overview & goals

Cycle 1 delivered the interactive board/list/timeline spine: drag-to-mutate through `patchTaskFields` (optimistic → PATCH → reconcile/rollback + `pushNotice`), the `FilterState` filter bar, group-by, swimlanes, My Tasks, and a dormant 5-minute sync scheduler. Cycle 2 turns that spine into a **daily-usable workspace**: filters that survive reload, an Insights surface that *reads* the ledger and *drives* those filters, a filterable timeline, real palette task actions, and a proven sync cadence — all without new dependencies, migrations, or any change to the frozen mutation spine.

**Goals**
1. **Persistence (F):** filter/view configuration survives reload, navigation, and a second tab — versioned, corruption/quota-safe, SSR-safe.
2. **Insight (E):** a native-SVG, current-state analytics screen where **every chart segment is a click-to-filter drill-down** into the board.
3. **Interaction depth (G):** the timeline obeys the same `FilterState` (via a due-range facet); two dead palette stubs become real spine-backed task actions.
4. **Proven cadence (H):** the dormant scheduler's 5-minute cadence is verified deterministically (fake timers), dormant-by-default preserved, kill switch documented.

**Non-goals (this cycle):** any new runtime dependency, any SQL migration, any new pushed SharePoint field, any change to `patchTaskFields`/`PUSHED_FIELDS`, any time-series chart.

### 1.1 Ground-truth corrections (verified in-tree — these *shrink* the diff)

The Cycle-2 research dossier predates the fully-landed Cycle-1 spine and overstates several gaps. Corrections (each reduces scope):

| Dossier framing | Verified reality (this branch) | Consequence |
|---|---|---|
| Filters "ephemeral, no serialize helpers" | TRUE ephemeral (`work-views.tsx` seeds `useState<FilterState>({})`); `FilterState` (5 facets: text/priority/assignee/label/stage) + `applyFilters` + `hasActiveFilters` + `assigneeUniverse` + `labelUniverse` + `UNASSIGNED_KEY` + `dueDay` are all pure + exported (`work-views.helpers.ts:8,14,233-310`). | **F adds only serialize/sanitize + persistence + UX**; the filter engine is reused as-is. |
| Charts "need a lib" | FALSE. `package.json` deps = `clsx, next, next-auth, pg, react, react-dom, tailwind-merge, zod` — **zero chart libs**. Precedent: the `Confidence` conic ring sets `--pct` and renders `.ring` (`atoms.tsx:46-55`). | **E is native SVG**; recharts would be a *new* dep (Pillar 3 / External-Integrations bar) — rejected. |
| Palette "has stubs" | TRUE: `create:new-bucket` (`command-palette.tsx:64`), `create:draft-prd` (:66-71), `assign:*` agents (:122-127) are `run: () => {}`. **`nav:mine` already exists** (:79). `nav:task` already uses a "first task" precedent (:96-102); a per-task command map already exists (`taskCommands`, :116-121). | **G adds two per-task spine actions** into the existing `taskCommands` map; nav is done. |
| Scheduler "needs enabling" | TRUE dormant + correctly gated (`scheduler.ts`: `syncEnabled()` reads `PLX_MC_SYNC_ENABLED === "1"`, default off; `__plxMcSyncTimer` idempotent guard; immediate kick + `setInterval(CADENCE_MS)`). **`CADENCE_MS` is NOT exported.** | **H = one fake-timer test + export `CADENCE_MS`** (test-visibility only) + docs. No engine logic change. |
| Persistence honesty | TRUE: localStorage idiom is `INVITED_KEY = "plx_mc_invited_people_v1"`, `canPersist()` (`store.ts:48,211`), hydrate-in-`useEffect` + try/catch-discard-on-corruption (`store.ts:259-294`). | **F mirrors this verbatim** — same key convention, same SSR-safe hydrate, same corruption posture. |

**The one material dossier error — there is no wall-clock "today".** `dueDay(due)` returns a **day-offset from Jun 1 on a fixed June grid** (`work-views.helpers.ts:295-311`; `MONTH_GRID_OFFSET` maps Apr…Dec, Jun = 0). The dossier's "overdue = `dueDay(due) < Date.now()`" would make the aggregator **impure and calendar-flaky** and mark ~nothing overdue against real June 2026. **Resolution:** define one documented, injected constant `INSIGHTS_TODAY_DAY` (the grid "now" cursor, Jun 16 ⇒ day `16`); overdue is computed against it; tests inject it. Pure, deterministic, matches the existing `dueDay`/timeline discipline. (A live clock is a one-line Cycle-3 seam swap — not baked in now.)

---

## 2. Final Cycle-2 module set & scope

| Mod | Title | Priority | Persistence | New deps | Migration | H in? |
|----|-------|----------|-------------|----------|-----------|-------|
| **F** | Saved views & filter persistence (localStorage) | **P0 (first)** | localStorage — versioned · cross-tab · corruption-safe · quota-safe · SSR-safe | none | none | — |
| **E** | Insights view (native-SVG current-state charts, click-to-filter) | **P0 (headline)** | none (pure read over `allTasks()`) | none | none | — |
| **G** | Timeline due-range filter + 2 palette spine actions | **P1** | none (extends `FilterState`; reuses spine wrappers) | none | none | — |
| **H** | Enable & verify dormant scheduler (dev-only) | **P1 (capacity-gated)** | none | none | none | **YES — in scope.** Lowest surface (one fake-timer test + `export CADENCE_MS` + docs). Yields to E/F/G only if capacity is exhausted; carries zero UI/prod risk so it ships by default. |

**Dependency order:** **F → E → G → (H).** F first because its pure `sanitizeFilterState` is the **trust boundary** E reuses for click-to-filter, and persisted `groupBy`/`filters` give E's drill-down a stable surface. E and G are independent of each other once F lands; H is independent of all.

### 2.1 Explicitly OUT of scope (Cycle 3 — stated so "harden" does not add to be safe)

- **Time-series charts** (burndown / burn-up / CFD) and any `task_status_snapshot` daily job — **the historical data layer does not exist**; the only signal is semi-structured audit-log body text, too fragile to parse. Charts are **current-state only**; do not fake a trend.
- **Postgres `saved_views`** (shareable / cross-device) + URL-encoded filter state — needs a migration + `apiRoute()` + Zod. F is **localStorage-only** ("Saved on this device").
- **Person/lookup SharePoint push** (`bucket → Initiative`, assignee/coassignee person-ids) — credential/tenant-gated (`mapping.ts:6-12`); stays DB-only and honest. **No new pushed field this cycle.**
- **Bucket as a `FilterState` facet** — `FilterState` has no `bucket` field; a bucket-segment click **navigates** to the existing bucket screen (`nav("board", { bucketId })`) rather than widening the filter contract (see §3.5).
- **Bulk multi-select**, timeline **drag-to-schedule** (the due-range is filter-only; it never mutates a due date), month/zoom, and the remaining palette stubs (`create:new-bucket`, `create:draft-prd`, the `assign:*` agent group — these need bucket-creation / agent infra that doesn't exist).
- **Live-clock overdue** (the `INSIGHTS_TODAY_DAY` → injected-clock seam swap).
- **Visually-hidden chart data-table fallback** (a11y nicety beyond Cycle-2's bar; focusable segments + `aria-label` meet the bar now).

---

## 3. Per-module specification

### Module F — Saved views & filter persistence (P0, ships first) · RISK-CENTERED

**What ships:** `FilterState` + `groupBy` + `swimlanes` persist to `localStorage` **per screen**, hydrate on mount without an SSR hydration mismatch, sync across tabs, and survive corruption/quota by silently falling back to defaults. Plus named local views (Save / apply / delete) in the filter bar, with a Linear "modified •" dirty-view cue (graft from Approach 2; build-step-optional, see §3.A.6).

#### 3.A.1 Files to change / create

| File | Change |
|------|--------|
| `src/components/mc/work-views.persist.ts` | **NEW** — the schema + pure helpers (serialize/deserialize/`sanitizeFilterState`) + thin storage-injected I/O wrappers. No React; no implicit `window` in the pure core (tests inject a `Storage` shim). |
| `src/components/mc/work-views.tsx` | **EDIT** — three mount-only effects (hydrate-adopt, storage-listener, persist-write) + `hydratedRef`/`adoptingRef` write-loop guards; the persist key is `screen` (board/list/mine each remember their own view; task/bucket/etc. never persist). Adopt `route.filter` for E's click-to-filter (see §3.B.3). |
| `src/components/mc/filter-bar.tsx` | **EDIT** — append a **Save view** affordance (name → `saveSavedViews`) and a **"Views ▾"** popover (apply on click → lifted `onApplyView`; per-row delete). Presentational only; reuses the existing `.fb-pop`/`.fb-pill`/`.fb-chip` skins and the `FacetConfig` row pattern. New props: `savedViews`, `onApplyView`, `onSaveView`, `onDeleteView`. |
| `src/styles/mc-views.css` | **EDIT (only if needed)** — a `.savedviews`/`.fb-views` width tweak inside the existing `.filterbar` block; tokens only. |
| `tests/mc-view-persist.test.ts` | **NEW** — pure: round-trip / version / corruption / quota / `sanitizeFilterState` allow-list cases; saved-views CRUD over a fake `Storage`; cross-tab echo guard. |
| `e2e/saved-views.spec.ts` | **NEW** — Playwright: filter → reload → restored; save named → clear → re-apply; corrupt-blob init → loads clean. |

#### 3.A.2 localStorage schema (versioned · namespaced · self-describing)

Mirrors the established `plx_mc_*_v1` convention. **Two keys**, deliberately split so a corrupt named-view blob cannot wipe the cheap last-used state and vice-versa:

```ts
// work-views.persist.ts — pure core (no React, no implicit window)
import type { GroupBy, BoardSwimlanes, FilterState } from "./work-views.helpers";
import type { Screen } from "./route";

export const PERSIST_VERSION = 1;                 // bump → discard-on-mismatch (soft migration)
const VIEW_KEY = (screen: Screen) => `plx_mc_view_v1:${screen}`;  // last-used, auto-saved, per screen
const SAVED_VIEWS_KEY = "plx_mc_saved_views_v1";  // named-view list (a view carries its own screen)

// Per-surface persisted state. `v` is the corruption/version gate.
export interface PersistedView {
  v: number;
  groupBy: GroupBy;
  swimlanes: BoardSwimlanes;
  filters: FilterState;
}

// Named saved views (one list; each view records the screen it was saved on).
export interface SavedView {
  id: string;            // `sv-${Date.now()}-${rand}`
  name: string;
  screen: Screen;
  groupBy: GroupBy;
  swimlanes: BoardSwimlanes;
  filters: FilterState;
}
export interface SavedViewsDoc { v: number; views: SavedView[]; }
```

**Versioning strategy (Cycle-2):** keep `PERSIST_VERSION = 1`. **Bump only on a *structural* break** to `PersistedView` / `SavedView` (e.g. renaming a field, or adding a required field that cannot default) — adding a new *optional* facet (such as G's `dueStart`/`dueEnd`) does **not** need a bump, since old payloads deserialize fine and the missing field reads as `undefined` (and `sanitizeFilterState` drops anything stale). A version mismatch **discards** the persisted blob silently (back to defaults) — it is not migrated, so a user's last-used filter / saved views are lost on a bump. That is acceptable for Cycle-2 local polish; a migrated, cross-device store (Postgres `saved_views`) is the Cycle-3 path (§2.1).

#### 3.A.3 The five robustness invariants (the heart of F)

1. **SSR-safety / no hydration mismatch (load-bearing).** Exactly the store's contract (`store.ts:277-296`, `shell.tsx`): **never read `localStorage` in a `useState` initializer or in render** (SSR renders empty, client renders persisted → React hydration mismatch). Instead initialize to current defaults (`isMine ? "bucket" : "band"`, `swimlanes "off"`, `filters {}`), then in a **mount-only `useEffect`** call `loadPersistedView(screen)` and, if present, `setGroupBy/setSwimlanes/setFilters`. First client paint == SSR (defaults); persisted state applies one tick later. `canPersist()` (`typeof window !== "undefined" && !!window.localStorage`, reused verbatim) makes Node/SSR take the no-op path.
2. **Corruption-safe.** `deserializeView(raw): PersistedView | null` is pure: `JSON.parse` in `try/catch` → `null` on throw (mirrors `catch { /* corrupt — ignore */ }` at `store.ts:291`); `v !== PERSIST_VERSION` → `null`; then `sanitizeFilterState` (below) drops any out-of-allow-list facet value. A stale label (deleted task) or a renamed enum degrades to "filter dropped," never "filter throws."
3. **Quota-safe.** Every `setItem` is wrapped: `try { … } catch { /* quota or disabled — drop */ }` (shape of `persistInvited`, `store.ts:259-268`). A persist failure never breaks an interaction; in-memory state stays authoritative.
4. **Cross-tab sync.** A second mount-only effect registers `window.addEventListener("storage", handler)` (fires only in *other* tabs). On a `StorageEvent` whose `key` matches this screen's key, re-run `deserializeView(e.newValue)` (same sanitize path) and adopt. **Guard:** ignore `e.newValue === null` (another tab's `clear()` must not blow away an active tab's filters). Listener removed on unmount.
5. **Write-loop / echo guard.** The persist effect (`useEffect(persist, [screen, groupBy, swimlanes, filters])`) must **not** fire during the initial hydrate-adopt (#1) or a storage-event adopt (#4) — else tab B's adopt writes back and can ping-pong. Use `hydratedRef`/`adoptingRef` to short-circuit the write during programmatic adopts (idempotent serialization makes this belt-and-suspenders, but it stops the storage fan-out from echoing).

#### 3.A.4 Pure helpers (the testable seam — `work-views.persist.ts`)

Pure string↔object split from thin I/O that takes an explicit `Storage` (so corruption/version/quota are all testable in vitest **without jsdom** — honoring the repo's pure/store/contract-only test rule):

```ts
export function sanitizeFilterState(raw: unknown): FilterState;  // REUSED by Module E (the F↔E trust boundary)
export function serializeView(v: PersistedView): string;
export function deserializeView(raw: string | null): PersistedView | null;
export function serializeSavedViews(doc: SavedViewsDoc): string;
export function deserializeSavedViews(raw: string | null): SavedView[];   // → [] on any corruption
// thin I/O (storage injected; defaults to window.localStorage behind canPersist()):
export function loadPersistedView(screen: Screen, storage?: Storage): PersistedView | null;
export function savePersistedView(screen: Screen, v: PersistedView, storage?: Storage): void;
export function loadSavedViews(storage?: Storage): SavedView[];
export function saveSavedViews(views: SavedView[], storage?: Storage): void;
```

`sanitizeFilterState` (pure, total, never throws) — the trust boundary reused by E and validated against the **canonical allow-lists already in the codebase**:
- `text` → coerce to a trimmed string or drop.
- `priority` → keep only members of `PRIORITY` (drop unknown enum values); coerce non-array → undefined.
- `stage` → keep only members of `STAGES`.
- `assignee` / `label` → keep only string entries (drop non-strings); `assignee` may include `UNASSIGNED_KEY`.
- `dueStart` / `dueEnd` (added by G) → keep only finite numbers (`Number.isFinite`); drop otherwise.
- Identity on a clean `FilterState`.

The I/O wrappers take an optional injected `Storage` (defaulting to `window.localStorage` behind `canPersist()`), so corruption / version / quota are all testable in plain vitest with no jsdom — a `Map`-backed shim:

```ts
// test helper — no jsdom; pass as the `storage?` argument.
const fakeStorage = (): Storage => {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  } as Storage;
};
// a quota stub overrides setItem to throw, proving savePersistedView swallows it:
//   const s = fakeStorage(); s.setItem = () => { throw new Error("QuotaExceeded"); };
```

#### 3.A.5 Persistence wiring (small, contained client surface)

`work-views.tsx` keeps `changeGroupBy`/`setSwimlanes`/`setFilters` as the single state mutators; the persist effect *observes* them. The `mine` screen keeps its own defaults and is persisted under its own `plx_mc_view_v1:mine` key (per-screen split means "My urgent" never leaks onto the all-work board). Screens not in `{board, list, mine, timeline}` never persist.

##### 3.A.5.1 Effect sequencing and guard semantics (load-bearing — implement in this order)

Three effects, with a fixed ordering so neither the persist write nor the `route.filter` adopt (Module E) clobbers the other. The two refs (`hydratedRef`, `adoptingRef`, both `useRef(false)`) gate the write effect off during programmatic adopts so an adopt never echoes back to `localStorage` or fans out a storage event to a peer tab.

1. **Hydrate-adopt (mount-only, `useEffect(…, [])`).** `adoptingRef.current = true`; call `loadPersistedView(screen)`; if present, `setGroupBy/setSwimlanes/setFilters` from it; then set `hydratedRef.current = true` and clear `adoptingRef` on the next microtask/tick (so the write effect that the `set*` calls schedule sees `adoptingRef === true` and no-ops). If absent, just set `hydratedRef.current = true`. Runs once.
2. **Route-filter adopt (`useEffect(…, [route.filter])`, Module E — scaffolded in PR-F, consumed in PR-E).** Runs **after** hydrate on the same mount, and again whenever `route.filter` changes. If `route.filter` is present, `adoptingRef.current = true`, `setFilters(sanitizeFilterState(route.filter))`, clear `adoptingRef` next tick. **`route.filter` wins over the persisted last-used filter** (explicit user intent from a slice click beats the restored filter — this is why it runs second). When `route.filter` is absent, this effect does nothing (the persisted/hydrated filter stands).
3. **Persist-write (`useEffect(persist, [screen, groupBy, swimlanes, filters])`).** First line: `if (!hydratedRef.current || adoptingRef.current) return;` — never write during the initial paint, the hydrate-adopt, or a route-filter / storage-event adopt. Otherwise `savePersistedView(screen, { v: PERSIST_VERSION, groupBy, swimlanes, filters })`. The `screen` in the dep array means switching board↔list↔mine writes/reads each screen's own key.

The cross-tab `storage` listener (§3.A.3 #4) is a fourth, mount-only effect; its adopt path sets `adoptingRef.current = true` around the `set*` calls identically, so a peer-tab adopt also never echoes a write back out. Idempotent serialization makes the guard belt-and-suspenders, but it is what stops the storage fan-out from ping-ponging between tabs.

#### 3.A.6 Named-views UX + the "modified •" dirty cue (Linear graft, build-optional)

The Views popover (Save + "Views ▾" switcher) is **required** for F: it lists saved views (apply / delete); applying a view sets `{groupBy, swimlanes, filters}` and records the active view id. **Build-optional polish on top of it — the "modified •" dirty cue (graft from Approach 2):** track the active view's serialized snapshot; if the live state diverges, render a subtle "• modified" dot next to the view name (Linear's dirty-view idiom) until re-saved or reset. **Build-step gate (the dot only, not the switcher):** the dot is ~10 lines of state in `work-views.tsx`; include it if the switcher is being built in the same PR, otherwise defer to Cycle 3 — it is polish, not correctness, and never blocks F's acceptance (see §3.A.8).

#### 3.A.7 Tests (F)

- **Vitest, pure (`tests/mc-view-persist.test.ts`):** `serializeView`→`deserializeView` round-trips every field; `deserializeView` → `null` on non-JSON garbage / `{v:0}` (version mismatch) / missing `v` / `null` input. **`sanitizeFilterState` (the grafted comprehensive coverage):** drops an unknown `priority` enum value; drops an unknown `stage`; coerces a non-string `label` out; coerces a non-array facet → undefined; drops a non-finite `dueStart`; is the identity on a clean `FilterState`. `loadPersistedView`/`savePersistedView` over a `Map`-backed fake `Storage`: save→load round-trips; a `setItem` that throws (quota stub) does not throw out of `savePersistedView`; a corrupt stored string loads as `null`. Saved-views: add / dedupe-by-id / delete round-trip; a corrupt saved-views blob loads as `[]` without nuking the last-used key. **Cross-tab echo guard:** simulate the `storage` handler twice in a row and assert no write-back / no ping-pong (the guard is tight).
- **Playwright (`e2e/saved-views.spec.ts`):** set text + a priority facet → `page.reload()` → filters restored (the headline fix vs. Cycle-1 reset-on-reload); Save named view → clear → re-apply → filters return; **corruption guard:** `page.addInitScript` seeds `localStorage["plx_mc_view_v1:board"] = "{bad json"` → board loads clean, no crash, no console error. (Cross-tab is asserted in the *unit* test on the pure handler — Playwright cross-context storage events are flaky.)

#### 3.A.8 Acceptance criteria (F)

- A reload (and a `nav` away-and-back) restores the exact `{groupBy, swimlanes, filters}` for board/list/mine.
- A corrupt or version-stale payload yields defaults with **no crash and no console error**; `applyFilters` never receives an out-of-allow-list value.
- A second tab adopts the first tab's saved view without reload; no write-loop.
- A quota/private-mode write failure degrades to ephemeral filters (no thrown error).
- **[REQUIRED]** Named views save / apply / delete (the "Views ▾" switcher in the filter bar is part of F's acceptance).
- **[OPTIONAL — ship only if the switcher is built in the same PR, else defer to Cycle 3]** The active saved view shows a subtle "• modified" dot when live state diverges from the saved snapshot; re-saving or resetting clears it. Polish, not correctness — never blocks F's acceptance.
- SSR HTML and first client render are identical (no hydration warning).

---

### Module E — Insights view (native-SVG charts, click-to-filter) (P0, headline)

**What ships:** a new `insights` screen reachable from the sidebar Views group + `⌘K` + `g i`, rendering current-state breakdowns over `allTasks()`: a **status donut** + total-tasks KPI; an **overdue KPI**; **by-Initiative (bucket)**, **by-Assignee** (explicit "Unassigned"), **by-Priority** bars; one shared status legend. **Every segment is click-to-filter** — clicking navigates to the board with the corresponding `FilterState` applied via `route.filter` (validated through F's `sanitizeFilterState`).

#### 3.B.1 Files to change / create

| File | Change |
|------|--------|
| `src/lib/mc-data/insights.ts` | **NEW** — pure, deterministic aggregator. No React, no store reads, no `Date.now()` (the "today" reference is injected). `buildInsights(tasks, todayDay)`, `isOverdue(task, todayDay)`, and the per-segment `FilterState` + `filterForSegment(...)`. |
| `src/components/mc/charts/donut.tsx` | **NEW** — generic native-SVG donut (arc segments via `stroke-dasharray`/`stroke-dashoffset` on a shared radius; center total). Each arc a focusable button. |
| `src/components/mc/charts/bar.tsx` | **NEW** — generic native-SVG horizontal bar list (`CategoryBar`), **one component reused by bucket/assignee/priority**. |
| `src/components/mc/charts/legend.tsx` | **NEW** — the one shared `StatusLegend` (swatch = `var(--p-*)` + label + count). |
| `src/components/mc/charts/chart-tokens.ts` | **NEW** — the per-category identity color maps (documented Pillar-3 exception; values are existing `--p-*` vars, **never raw hex**). |
| `src/components/mc/charts/index.ts` | **NEW** — barrel for the three primitives + the shared `ChartSlice` type. |
| `src/components/mc/insights.tsx` | **NEW** — the `insights` screen (`ScreenProps`): KPI strip + donut + three `CategoryBar`s; owns the segment→`nav("board", { filter })` handlers. |
| `src/components/mc/route.ts` | **EDIT** — add `"insights"` to `Screen`; add optional `filter?: FilterState` to `Route` (see §3.B.3 churn note). |
| `src/components/mc/screens.tsx` | **EDIT** — register `insights: InsightsView`. |
| `src/components/mc/chrome.tsx` | **EDIT** — sidebar `item("insights", "◔", "Insights")` in the Views group (after My Tasks). |
| `src/components/mc/command-palette.tsx` | **EDIT** — add `{ key: "nav:insights", icon: "◔", label: "Go to Insights", run: () => nav("insights") }` to the navigate group (after `nav:mine`). |
| `src/components/mc/shell.tsx` | **EDIT** — add `i: "insights"` to `VIEW_CHORDS` for `g i`. |
| `src/styles/mc-charts.css` | **NEW** — all chart skins (`.insights`, `.chartcard`, `.donut`, `.catbar`, `.kpi`, `.clegend`); tokens only; imported alongside the other `mc-*.css`. |
| `tests/mc-insights.test.ts` | **NEW** — aggregator truth tables + the slice→`applyFilters` contract. |
| `e2e/insights.spec.ts` | **NEW** — screen renders; a segment click lands on a filtered board; reduced-motion smoke. |

#### 3.B.2 The pure aggregator (`insights.ts` — deterministic, unit-tested)

```ts
import { ACTORS, BANDS, BUCKETS, PRIORITY, STAGES, bandOf, dueDay } from "@/lib/mc-data";
import type { Task } from "@/lib/mc-data";
import type { FilterState } from "@/components/mc/work-views.helpers";
import { UNASSIGNED_KEY } from "@/components/mc/work-views.helpers";

// IMPORTANT: a fixed constant for Cycle-2 determinism — NOT a live clock.
// dueDay() is a Jun-1 day-offset grid (Jun = 0 ⇒ Jun 16 = day 16), so this is
// the grid "now" cursor. Do NOT replace it with Date.now()/new Date(): that
// makes the aggregator impure, flakes the isOverdue tests by calendar day, and
// (against real June 2026) marks ~nothing overdue. A live clock is a one-line
// Cycle-3 seam swap (replace this constant with the injected runtime value) —
// see §1.1 and §2.1. Tests inject todayDay explicitly.
export const INSIGHTS_TODAY_DAY = 16;  // fixed June-grid "now" cursor (Jun 16)

// One chart slice: a labelled count, a TOKEN name for its fill (NOT a hex — the
// component maps it to var(--p-*)), and the FilterState a click applies.
export interface ChartSlice { key: string; label: string; value: number; colorVar: string; filter: FilterState | null; }

export interface InsightsModel {
  total: number;
  overdue: number;
  byStatus: ChartSlice[];    // 3 bands (todo/doing/done) via bandOf — the donut
  byBucket: ChartSlice[];    // BUCKETS order
  byAssignee: ChartSlice[];  // assigneeUniverse order + Unassigned
  byPriority: ChartSlice[];  // PRIORITY order
}

export function isOverdue(task: Task, todayDay = INSIGHTS_TODAY_DAY): boolean {
  if (task.stage === "merged" || task.stage === "verified") return false;  // done excluded
  const d = dueDay(task.due);
  return d !== null && d < todayDay;
}
export function buildInsights(tasks: Task[], todayDay = INSIGHTS_TODAY_DAY): InsightsModel;
export function filterForSegment(
  kind: "status" | "priority" | "assignee", key: string,
): FilterState;   // pure; the click-to-filter mapping (bucket/overdue handled at the call site, see §3.B.5)
```

- **Reuse, not reinvent:** `byBucket`/`byAssignee` ordering reuses `assigneeUniverse` + `BUCKETS`; `byPriority` reuses `PRIORITY` order; `byStatus` reuses `BANDS` + `bandOf`; tones reuse `PRIORITY[k].cls`. (`columnsFor`/`partitionTasksByColumn` may be reused for the grouping if it keeps Insights identical to the board's ordering — preferred.)
- **Determinism:** every aggregator is `(tasks, todayDay) => …`, pure, sorted by the canonical fixture order, zero store reads.
- **"Done" is explicit and tested:** done = `stage ∈ {merged, verified}` (band `done`); overdue excludes done.

#### 3.B.3 The click-to-filter contract (E ⇄ F ⇄ work-views) — the load-bearing seam

**Mechanism (chosen): `route.filter?: FilterState`.** A slice click calls `nav("board", { filter })`; `WorkViews` adopts `route.filter` **on mount / route change**, running it through F's `sanitizeFilterState` (so a hand-constructed/garbage filter can never poison the board). The slice's filter is produced by the **pure aggregator**, validated by **F's sanitizer**, applied by the **existing `applyFilters`** — no segment can navigate to a filter the board can't render.

**Churn note (resolves Judge 1's concern):** `Nav = (screen, extra?: Omit<Route, "screen">) => void` (verified `route.ts:25`). Adding an optional `filter?` to `Route` is **automatically carried** by all ~20 existing `nav()` call sites with **zero edits** — they simply don't pass the new optional field. So the `route.filter` approach is genuinely low-diff here; this is why it is preferred over a one-shot store channel.

**Precedence with F:** a slice click is **explicit user intent** → `route.filter` **wins** over the persisted last-used filter for that navigation. This is realized by the effect ordering in **§3.A.5.1** (hydrate-adopt first, route-filter adopt second), which prevents a "click does nothing because the persisted filter reloaded over it" bug. The route-filter adopt sanitizes through F's `sanitizeFilterState` before `setFilters`, and is gated by `adoptingRef` so it never echoes a persist write.

**Fallback is explicitly OUT of this cycle's scope.** `route.filter` is the single, proven path (its low-churn `Omit<Route,"screen">` typing is verified below). A one-shot pending-view channel (`setPendingView`/`takePendingView`) was considered and rejected for Cycle 2 — shipping a second, half-wired transport for the same data violates Simplify Relentlessly and Reuse Before Create. **If** `route.filter` adoption hits a genuine SSR/route complication during harden, that is a **separate, design-reviewed blocker PR** (which would then fully specify the channel, including a unit-tested consume-once contract), **not** an escape hatch baked into this spec. Do not implement two paths.

#### 3.B.4 Native-SVG chart components (Linear standard — grafted prescription)

**Shared rules (all primitives):**
- **Tokens only.** Fills are `fill={`var(${slice.colorVar})`}` / `stroke=var(--p-*)`; tracks/gridlines use `--p-grid`/`--p-grid-2`; text uses `--p-ink`/`--p-muted` with `--p-font-mono` + `font-variant-numeric: tabular-nums` for numerals (mirrors `.p-data`). **No raw hex anywhere.**
- **Color discipline — the documented identity-map exception** (`charts/chart-tokens.ts`, annotated):
  ```ts
  // charts/chart-tokens.ts — per-category identity maps (CLAUDE.md Pillar-3
  // exception: a category→token map, NOT raw color). All values are existing
  // --p-* CSS vars, so light/dark + brand theming are automatic.
  export const STATUS_COLOR_VAR: Record<Band, string> = {
    todo: "var(--p-info)", doing: "var(--p-warn)", done: "var(--p-ok)",
  };  // status donut by band (9 stages collapse to 3 bands for legibility)
  export const PRIORITY_COLOR_VAR: Record<PriorityKey, string> = {
    urgent: "var(--p-hot)", high: "var(--p-warn)", medium: "var(--p-info)", low: "var(--p-muted)",
  };  // mirrors PRIORITY[*].cls — same visual language as the chips
  ```
  Bucket/assignee bars use **one hue** (`--p-accent`) with opacity steps — never N arbitrary colors.
- **Motion + reduced-motion (Linear polish, accessible — grafted explicit form):** arcs animate `stroke-dashoffset` from full→target; bars animate `width`/`transform: scaleX` 0→1; durations from `--p-dur`/`--p-dur-slow`, easing `--p-ease`. **The transition/keyframes are wrapped in `@media (prefers-reduced-motion: no-preference)`** (the exact codebase posture, `mc-views.css:192-195`); the final rendered state (full arcs/bars) is the no-animation default, so reduced-motion users get the correct chart instantly with no tween. CSS only — SSR-safe. The required structure (final state outside the query, animation inside it):
  ```css
  /* mc-charts.css — the rendered (final) state is the default. */
  .donut .arc { stroke-dashoffset: var(--arc-target); }     /* full arc, no tween */
  @media (prefers-reduced-motion: no-preference) {
    .donut .arc { animation: arc-in var(--p-dur) var(--p-ease) both; }
    @keyframes arc-in { from { stroke-dashoffset: var(--arc-circ); } to { stroke-dashoffset: var(--arc-target); } }
  }
  ```
- **Accessibility (grafted explicit form):** each chart container is `role="img"` with an `aria-label` summarizing the breakdown (e.g. "Status: 12 to do, 8 in progress, 5 done"). **Each clickable segment is a real focusable element** — a `<button>` or SVG `<g role="button" tabIndex={0}>` with `onKeyDown` (Enter/Space) — carrying its own `aria-label` ("Filter to High priority — 4 tasks") and a `<title>`. Keyboard-operable and screen-reader navigable, mirroring the `.tcard` interactive pattern. (A visually-hidden data-table fallback is Cycle-3.)
- **Responsive:** SVG uses `viewBox` + `width="100%"` (no fixed pixel width) so charts reflow in the insights grid.

**`Donut`** (`charts/donut.tsx`): `StatusDonut({ slices, total, onSlice })` — `<circle>` arc segments via `stroke-dasharray`/`stroke-dashoffset` (standard zero-lib donut); center `<text>` shows the total KPI. Empty/zero-total renders a neutral `--p-grid` ring (no NaN paths).

**`CategoryBar`** (`charts/bar.tsx`): `CategoryBar({ title, slices, onSlice })` — a vertical list of rows (label + `<rect>` bar at `value/max` width + right-aligned mono count). **One component, three instances** (bucket/assignee/priority) driven entirely by `ChartSlice[]` — the Linear "distribution" idiom; degrades at any width; zero/empty rows render a hairline placeholder, never a 0-width clickable.

> **Two primitives, not four chart files:** one `Donut` + one `CategoryBar` (+ `StatusLegend`) cover all charts. Three of four "bars" are the same component with different data — the fewest-new-files native-SVG design.

#### 3.B.5 The per-segment filter mapping (honest, documented asymmetry)

- **status (band)** segment → `{ stage: STAGES.filter(s => s.band === key).map(s => s.key) }`, navigate to board. (A band is N stages; `applyFilters` filters on `stage`, so this stays honest — no synthetic "band" facet.)
- **priority** segment → `{ priority: [key] }`.
- **assignee** segment → `{ assignee: [key] }` (Unassigned → `{ assignee: [UNASSIGNED_KEY] }` — round-trips exactly through `applyFilters`).
- **bucket** segment → **bucket is not a `FilterState` facet.** Click navigates to the bucket-scoped board: `nav("board", { bucketId: key })` (the board already scopes by `route.bucketId`). **Documented asymmetry:** bucket is a board axis/destination, not a filter facet — do **not** invent a `bucket` facet just for this chart (it would fork the filter contract). `filter` for a bucket slice is `null`; the call site routes by `bucketId`.
- **overdue KPI** → in Cycle 2 it is **display-only** (a number + label), because "overdue" requires either an `overdue` facet or G's due-range to express. If G has landed, the KPI may drill to `nav("board", { filter: { dueEnd: INSIGHTS_TODAY_DAY - 1, stage: nonDoneStages } })`; otherwise it stays display-only and notes "drill lands with G." Either way no rework.
- **total KPI** → display-only (or navigates to an unfiltered board).

The split is explicit at the call site in `insights.tsx` (a code comment makes the asymmetry self-documenting so no future dev forks the filter contract with a `bucket` facet):

```ts
// insights.tsx — STATUS / PRIORITY / ASSIGNEE apply a FilterState and navigate;
// BUCKET is a board AXIS, not a FilterState facet, so it navigates by route
// param. OVERDUE/TOTAL KPIs are display-only in Cycle-2 (see SPEC §3.B.5).
const onSlice = (kind: "status" | "priority" | "assignee" | "bucket", key: string) => {
  if (kind === "bucket") { nav("board", { bucketId: key }); return; }   // board axis, not a filter
  nav("board", { filter: filterForSegment(kind, key) });                // sanitized on adopt by WorkViews
};
```

#### 3.B.6 `insights.tsx` layout

A `.mc-main` surface with the standard `.ph` header ("Insights / a read on the work — click any segment to drill in"); a KPI strip (Total · Overdue [tone `--p-warn`/`--p-hot` when > 0] · Unassigned · Blocked — KPIs that map cleanly to a facet are clickable, others display-only per §3.B.5); then a responsive grid: donut + `StatusLegend` in the lead cell, the three `CategoryBar`s in the remaining cells. `useMcVersion()` at the top so it re-aggregates after any mutation; `const model = useMemo(() => buildInsights(allTasks(), INSIGHTS_TODAY_DAY), [version])`. Workspace-wide (no incoming filter), like the board's default.

#### 3.B.7 Tests (E)

- **Vitest, pure (`tests/mc-insights.test.ts`):** `buildInsights` total = `tasks.length`; each breakdown (status/bucket/priority/assignee) sums to total (disjoint-partition invariant, same discipline as `partitionTasksByColumn` tests); "Unassigned" slice present iff a task lacks an assignee. `isOverdue` truth table: a non-done task due before `todayDay` → overdue; a `merged`/`verified` task due in the past → **not** overdue; a future-day task → not overdue (deterministic via injected `todayDay`). **The load-bearing contract:** for every status/priority/assignee slice, `applyFilters(allFixtureTasks, slice.filter).length === slice.value` (the click-to-filter correctness proof — no segment is half-wired). Zero-task input → zero slices / NaN-free donut math.
- **Charts (presentational, no jsdom):** none required (repo's no-RTL stance); behavior covered by aggregator tests + E2E.
- **Playwright (`e2e/insights.spec.ts`):** navigate (sidebar "Insights"; assert the donut `[role="img"]` + the three bars render with non-zero totals); click a **Priority** segment → lands on the board, the Priority chip is present, count matches the segment value (reuse filter-bar locators); click the **Unassigned** assignee segment → board shows the unassigned filter; `g i` reaches Insights; reduced-motion: with `page.emulateMedia({ reducedMotion: 'reduce' })` the charts still render the final state (smoke, no tween assertion).

#### 3.B.8 Acceptance criteria (E)

- Insights renders KPI strip + status donut + three breakdown bars from `allTasks()`, all counts correct and summing to the total.
- Every status/priority/assignee segment is a focusable, keyboard-activatable control with an `aria-label`; clicking lands on the board with the exact matching filter and a result count equal to the segment value.
- Bucket segment navigates to the bucket-scoped board; overdue KPI is honest (display-only unless G's due-range backs the drill).
- No raw hex in `mc-charts.css` or chart TSX; colors are `--p-*` only (category maps annotated).
- Reduced-motion users see the final chart instantly; SVG is responsive (no fixed width).

---

### Module G — Timeline due-range filter + palette spine actions (P1)

Two thin, related deepenings of existing surfaces, bundled because both are spine/filter reuses.

#### 3.G.1 Timeline due-range filter (extend the shared `FilterState`)

Today the timeline renders the full `baseTasks` scope and the filter bar is hidden on the timeline; `dueDay` is month-aware. Change: add one optional due-range facet and wire the timeline to the same filtered list so board/list/timeline stay in sync.

```ts
// work-views.helpers.ts — FilterState gains a due range (day-offset based,
// reusing the June-grid dueDay() — no new date model, no calendar widget).
export interface FilterState {
  text?: string; priority?: PriorityKey[]; assignee?: string[]; label?: string[]; stage?: StageKey[];
  dueStart?: number;   // inclusive day offset (dueDay scale); undefined = open
  dueEnd?: number;     // inclusive; undefined = open
}
export function isTaskDueInRange(task: Task, start?: number, end?: number): boolean {
  if (start === undefined && end === undefined) return true;
  const d = dueDay(task.due);
  if (d === null) return false;          // undated tasks fall OUT of an explicit range (documented)
  if (start !== undefined && d < start) return false;
  if (end !== undefined && d > end) return false;
  return true;
}
```

- Extend `applyFilters` with one AND-combined clause (`if ((f.dueStart != null || f.dueEnd != null) && !isTaskDueInRange(task, f.dueStart, f.dueEnd)) return false;`) and `hasActiveFilters` with `|| f.dueStart != null || f.dueEnd != null`. Pure, unit-tested.
- **Filter bar:** a "Due" facet (one `FACET_ORDER` + `facetConfig` entry — the config-map already supports this) rendering a popover of **preset ranges** expressed as grid-day offsets. **Day-offset convention (verified against `dueDay`, `work-views.helpers.ts:298-310`): `MONTH_GRID_OFFSET["Jun"] = 0`, so Jun 1 = day `1`, Jun 14 = day `14`, Jun 28 = day `28`, Jun 30 = day `30`; Jul 1 = day `31`. Both `dueStart` and `dueEnd` are INCLUSIVE.** The presets, with their exact patches:
  - **Overdue** → `{ dueEnd: INSIGHTS_TODAY_DAY - 1 }` (everything due strictly before the grid "now" cursor — Jun 16, so `dueEnd: 15`).
  - **This cycle (Jun 1–14)** → `{ dueStart: 1, dueEnd: 14 }`.
  - **Next cycle (Jun 15–28)** → `{ dueStart: 15, dueEnd: 28 }`.
  - **Beyond June** → `{ dueStart: 30 }` (Jun 30 onward; open-ended high bound — captures any post-June due via the month-offset scale).

  Presets (not a calendar) keep it native and honest to the fixed-June grid (month/zoom is Cycle-3). Each preset is one `FilterState` patch; renders a removable chip via the existing chip pipeline.
- **Wire the timeline:** render `<FilterBar>` above the timeline too (currently board/list only), and feed `TimelineView` the filtered `visible` set (not `baseTasks`); update the timeline count to the filtered length. The fixed June grid / milestones / Gantt math are untouched — only the *set of rows* narrows. The existing timeline empty-state handles filtered-to-zero.
- **No persistence question:** the due-range is **filter-only** (never mutates a due date — that's drag-to-schedule, Cycle-3), so it rides `applyFilters` and Module F carries it for free (it's part of `FilterState`). The same PR adds `dueStart`/`dueEnd` validation to `sanitizeFilterState`.

#### 3.G.2 Palette spine actions (replace exactly two dead stubs)

Add two **per-task** spine-backed commands to the existing `taskCommands` map (`command-palette.tsx:116-121`, which already iterates all tasks) — the cleanest unambiguous target (consistent with the existing `nav:task` precedent), no new route/selection state:

```ts
// per task, appended to the taskCommands map:
{ key: `task-done:${task.id}`,    icon: "✓", label: `Mark ${task.id} done`,        hint: "task action",
  run: () => setTaskStage(task.id, "verified") },          // "done" = verified (band=done); spine wrapper
{ key: `assign-me:${task.id}`,    icon: "☺", label: `Assign ${task.id} to me`,     hint: "task action",
  run: () => reassignTask(task.id, CURRENT_USER) },        // spine wrapper; honest deferred-mirror copy
```

- Import `CURRENT_USER` from `@/lib/mc-data` and `setTaskStage`/`reassignTask` from `@/lib/mc-data/store`. There is no `closeTask`/`markDone` and we must **not** invent one (Pillar 3) — `setTaskStage(id, "verified")` is the path.
- Both route through the **frozen spine** (`setTaskStage`/`reassignTask` → `patchTaskFields` → optimistic + PATCH + reconcile/rollback + notice), inheriting all Cycle-1 correctness — **zero new store code, no half-wire.**
- The two genuinely-deferred `create:*` stubs and the `assign:*` agent group stay as-is (they need bucket-creation / agent infra that doesn't exist). The "two dead stubs replaced" goal is met by adding the two real per-task actions (the dead `() => {}` create/agent handlers remain clearly labelled deferred).

#### 3.G.3 Files & tests (G)

| File | Change |
|------|--------|
| `src/components/mc/work-views.helpers.ts` | `dueStart`/`dueEnd` on `FilterState`; `isTaskDueInRange`; one clause each in `applyFilters` + `hasActiveFilters`. |
| `src/components/mc/work-views.tsx` | Render `<FilterBar>` for the timeline; feed `TimelineView` the filtered `visible`; timeline count = filtered length. |
| `src/components/mc/filter-bar.tsx` | "Due" preset facet (config-map entry + chip). |
| `src/components/mc/command-palette.tsx` | Two per-task spine actions in `taskCommands`; import `CURRENT_USER` + wrappers. |
| `src/components/mc/work-views.persist.ts` | `sanitizeFilterState` validates `dueStart`/`dueEnd` (finite numbers). |
| `src/styles/mc-views.css` | `.fb-due` preset-control skin in the `.filterbar` block (tokens only). |
| `tests/mc-views.test.ts` | **EXTEND** — `isTaskDueInRange` truth table with explicit boundary cases (task due exactly on `dueStart` ⇒ IN; exactly on `dueEnd` ⇒ IN; one day below `dueStart` ⇒ OUT; one day above `dueEnd` ⇒ OUT; open-ended low (`dueStart` undefined) and open-ended high (`dueEnd` undefined); both undefined ⇒ IN/identity; null-due (undated) ⇒ OUT of any explicit range); a preset-alignment assertion that `{dueStart:1,dueEnd:14}` matches a "Jun 14" task and excludes "Jun 15" (Jun 1 = day 1 convention); `applyFilters` AND-combines the due-range with other facets and is identity when unset; `hasActiveFilters` true when only a bound is set. |
| `tests/mc-store.test.ts` | **EXTEND** — "mark done" sets `stage:"verified"` (optimistic + via `taskById`, using `__setPatchMirrorForTests`); "assign to me" sets `assignee: CURRENT_USER`; a rejecting mirror proves rollback + notice (reuse the existing pattern). |
| `e2e/timeline-filter.spec.ts` | **NEW** — apply a preset (e.g. "Next cycle") on the timeline → rows narrow + count matches; same chip narrows board/list when switched (cross-view sync); clear → all rows return. Palette: ⌘K → "Assign TASK-x to me" → assignee becomes current user (no fabricated "Synced"); "Mark TASK-x done" → stage Merged/Verified. |

#### 3.G.4 Acceptance criteria (G)

- A due-range preset narrows the timeline; the *same* `FilterState` narrows board and list (one filter, three lenses); the timeline count matches the filtered rows.
- An undated task is excluded by any explicit range, included when no range is set.
- The due-range survives reload / lens-switch (carried by Module F); `sanitizeFilterState` drops a non-finite bound.
- "Mark <id> done" and "Assign <id> to me" mutate through the spine (optimistic + reconcile, rollback + notice on failure); no new persistence path; the deferred stubs remain clearly labelled.

---

### Module H — Enable & verify the dormant scheduler (dev-only) (P1, capacity-gated) · RISK-CENTERED

**What ships:** a deterministic cadence test + an explicit dev-only enablement story. **No engine logic change; dormant-by-default preserved.** Lowest-surface module; yields to E/F/G if capacity is exhausted, but carries zero UI/prod risk so it ships by default.

#### 3.H.1 The guarantee: zero prod / zero credential impact

The scheduler is already correctly gated (`scheduler.ts`: `syncEnabled()` → `PLX_MC_SYNC_ENABLED === "1"`, default off; `__plxMcSyncTimer` idempotent guard; `instrumentation.ts` boots it only when `NEXT_RUNTIME === "nodejs"`). H's contract:
- **Do NOT change the default.** `PLX_MC_SYNC_ENABLED` stays unset/`""` in production, the Playwright `webServer.env` (already pins it `""`), and CI. Enablement is a **local-dev opt-in only** — a developer exports `PLX_MC_SYNC_ENABLED=1` in their own shell. Documented in env docs, **not** in any committed config.
- **No credentials touched.** A sweep with no DB/SP creds runs against the in-memory engine the same way the on-demand "Sync now" does today — so "enable" proves the **cadence**, not a real SharePoint write.
- **Kill switch documented:** unset the env var → `startSyncScheduler` logs "scheduler disabled" and returns (already true; H writes it down).

#### 3.H.2 The deterministic cadence test (no real timers, no flake) — `tests/sync-scheduler.test.ts` (NEW)

- `vi.mock("@/lib/sync/engine", () => ({ runSweep: vi.fn(async () => ({ pushed: 0, pulled: 0, conflicts: 0, pushErrors: 0 })) }))`.
- **Disabled by default (the most important assertion):** with `PLX_MC_SYNC_ENABLED` unset, `startSyncScheduler()` does **not** call `runSweep` and sets no timer.
- **Enabled cadence:** set `process.env.PLX_MC_SYNC_ENABLED = "1"`, `vi.useFakeTimers()`, call `startSyncScheduler()` → one immediate `void sweep()`; `vi.advanceTimersByTime(CADENCE_MS)` → a second sweep; advance again → a third (proves the 5-min interval, deterministically).
- **Idempotent start:** two `startSyncScheduler()` calls register only one interval (the `__plxMcSyncTimer` guard) — `runSweep` not double-scheduled.
- **Failure keeps cadence:** make `runSweep` reject once → the `catch` swallows it and the next `advanceTimersByTime` still sweeps.
- **Cleanup:** `afterEach` → `vi.useRealTimers()`, `clearInterval(globalThis.__plxMcSyncTimer)`, delete the global, restore the prior `PLX_MC_SYNC_ENABLED` — so no live timer leaks into the rest of the vitest run (a leak is itself a flake source).
- **One-line code touch (test-visibility only):** `export const CADENCE_MS` in `scheduler.ts` (currently module-private). No logic change.

#### 3.H.3 Files & acceptance criteria (H)

| File | Change |
|------|--------|
| `src/lib/sync/scheduler.ts` | **EDIT (test-visibility only)** — `export const CADENCE_MS`. No logic change. |
| `tests/sync-scheduler.test.ts` | **NEW** — the fake-timer cadence test above. |
| `TOOLS.md` / env docs | **EDIT** — dev-only `PLX_MC_SYNC_ENABLED=1` opt-in + kill-switch note (no committed config flips it on). |

**Acceptance:**
- `CADENCE_MS` is exported from `scheduler.ts` (test-visibility only; no logic change) so the cadence test can `vi.advanceTimersByTime(CADENCE_MS)`.
- With the flag unset, no sweep and no timer; with it set under fake timers, an immediate sweep + one per `CADENCE_MS` (advance twice ⇒ second and third sweeps); idempotent start (two calls ⇒ one interval).
- A failed sweep doesn't kill the loop (the `catch` swallows it; the next `advanceTimersByTime` still sweeps).
- **No timer leaks:** `afterEach` restores real timers (`vi.useRealTimers()`), clears `globalThis.__plxMcSyncTimer`, deletes the global, and restores the prior `PLX_MC_SYNC_ENABLED` — so a subsequent test can call `startSyncScheduler()` again and the idempotent guard re-registers exactly one interval. No live timer leaks into the rest of the vitest run.
- Production/E2E defaults are unchanged (`PLX_MC_SYNC_ENABLED` unset in prod, CI, and Playwright `webServer.env`).

---

## 4. Zero new deps / zero migrations (confirmation)

- **Zero new runtime dependencies.** Verified `package.json` deps = `clsx, next, next-auth, pg, react, react-dom, tailwind-merge, zod`; devDeps already include `@playwright/test` + `vitest`. Charts = native SVG (precedent: the `Confidence` conic ring). Persistence = native Web Storage. Scheduler test = built-in `vi.useFakeTimers()`. **No exception requested.**
- **Zero SQL migrations.** Nothing touches `db/migrations/`. All Insights data is a pure read over the in-memory store; saved views live in `localStorage`; the due-range is an in-memory `FilterState` field. `PUSHED_FIELDS` is unchanged (no new SharePoint-pushed field), so the field-tier boundary is untouched. `scripts/check-migrations.py` stays clean (it rejects any stray non-`\d{3}_[a-z0-9_]+\.sql` file under `db/migrations/`) — harden must not drop a scratch file there either.

---

## 5. Dependency-ordered, thematic PR breakdown

Branches **stacked on `cycle1/harden-e2e-polish`**, prefix `cycle2/`. Each PR opened **draft** and must be **green through `scripts/preflight.sh --mode pre-push`** (policy gates [`check-repo-hygiene.py`, `check-migrations.py`] + `npm run typecheck` + `npm run test` [`vitest run`] + `next build`) and the relevant `npm run test:e2e` before review. Conventional commits. **Zero deps; zero migrations.**

```
PR-F  ── (foundation; depends only on the C1 branch) ── pure helpers + sanitizeFilterState reused by PR-E
PR-E  ── HARD dep: PR-F (sanitizeFilterState trust boundary + route.filter adopt)
PR-G  ── SOFT dep: PR-F (FilterState.dueStart/End sanitized there); independent of PR-E
PR-H  ── independent of all (capacity-gated; lands any time, parallel to everything)
        (PR-E ∥ PR-G once PR-F lands; PR-H ∥ everything)
```

| # | Branch | Conventional commit (title) | Files | Tests / gate |
|---|--------|-----------------------------|-------|--------------|
| **PR-F** | `cycle2/saved-views-persistence` | `feat(mc): persist & save filter views to localStorage (versioned, cross-tab, corruption-safe)` | NEW `work-views.persist.ts`; EDIT `work-views.tsx` (3 guarded effects + `route.filter` adopt scaffold), `filter-bar.tsx` (Save / Views popover), `mc-views.css` (reuse `.filterbar`) | NEW `tests/mc-view-persist.test.ts` (round-trip / version / corruption / quota / `sanitizeFilterState` allow-lists / cross-tab echo); NEW `e2e/saved-views.spec.ts` |
| **PR-E** | `cycle2/insights-charts` | `feat(mc): native-SVG Insights view with click-to-filter` | NEW `lib/mc-data/insights.ts`, `insights.tsx`, `charts/{donut,bar,legend,chart-tokens,index}.tsx`, `styles/mc-charts.css`; EDIT `route.ts` (`insights` + `filter?`), `screens.tsx`, `chrome.tsx`, `command-palette.tsx` (`nav:insights`), `shell.tsx` (`g i`), `work-views.tsx` (adopt `route.filter` via `sanitizeFilterState`) | NEW `tests/mc-insights.test.ts` (counts / overdue / **slice↔applyFilters contract**); NEW `e2e/insights.spec.ts` |
| **PR-G** | `cycle2/timeline-filter-palette-actions` | `feat(mc): due-range timeline filter + palette mark-done / assign-to-me` | EDIT `work-views.helpers.ts` (`dueStart/End` + `isTaskDueInRange` + `applyFilters`/`hasActiveFilters`), `filter-bar.tsx` (Due presets), `work-views.tsx` (timeline filtered + FilterBar shown), `command-palette.tsx` (2 per-task spine actions), `work-views.persist.ts` (sanitize range) | EXTEND `tests/mc-views.test.ts` (range truth table); EXTEND `tests/mc-store.test.ts` (mark-done / assign-to-me reconcile + rollback); NEW `e2e/timeline-filter.spec.ts` |
| **PR-H** | `cycle2/scheduler-enable-verify` | `test(mc): deterministic sync-scheduler cadence test + dev-only enable docs` | EDIT `scheduler.ts` (`export CADENCE_MS` only), `TOOLS.md`/env docs | NEW `tests/sync-scheduler.test.ts` (fake-timer cadence, dormant-by-default, idempotent, failure-keeps-cadence); preflight |

One coherent arc: **a persisted, switchable filter workspace → a polished native-SVG Insights surface that drives those filters → a filterable timeline + real palette actions → a proven sync cadence** — zero new runtime deps, zero migrations, every seam tested, nothing half-wired, the scheduler proven without leaving its dormant default.

---

## 6. Risks & mitigations

- **R1 — Fake "today" / impure overdue.** Fixed, documented, injected `INSIGHTS_TODAY_DAY` grid cursor (§1.1); the aggregator stays pure + deterministic; tests don't flake by calendar day. Live-clock overdue is a Cycle-3 one-line seam swap.
- **R2 — localStorage corruption / cross-tab loop / quota / SSR.** All reads through `deserializeView`/`deserializeSavedViews` + `sanitizeFilterState` (try/catch + version discard + allow-list); writes guarded; storage-event loop broken by `hydratedRef`/`adoptingRef` + `newValue === null` ignore; SSR-gated by `canPersist()` + hydrate-in-`useEffect`. Corrupt blob → clean default, never a crash (same contract as the invited-people hydrate). The five invariants (§3.A.3) are each test-backed.
- **R3 — Click-to-filter coupling E→F.** One-directional: E writes the filter into `route.filter`, validated by F's `sanitizeFilterState`; F ships first. **`route.filter` is low-churn** (`Nav`'s `Omit<Route,"screen">` carries it; ~20 existing `nav()` sites need zero edits). Single transport — the effect ordering in §3.A.5.1 makes the slice click win over the persisted filter. A pending-view fallback is explicitly **not** shipped (§3.B.3); a genuine SSR/route complication in harden is a separate design-reviewed blocker, not a pre-baked second path.
- **R4 — Bucket has no `FilterState` facet.** A bucket slice **navigates** to the bucket-scoped board (`nav("board", { bucketId })`) — reuse an existing destination rather than widening `applyFilters`. In-board bucket filtering, if ever wanted, is an explicit small facet PR — never smuggled into Insights.
- **R5 — SVG donut a11y / contrast.** Every segment is a real keyboard-focusable button with `aria-label` (count + label); colors are the existing status `--p-*` tokens that already pass on the board; reduced-motion shows the final state instantly; chart container `role="img"` with a summary label.
- **R6 — Palette action ambiguity (which task?).** Resolved by **per-task** commands (`Mark <id> done` / `Assign <id> to me`) in the existing `taskCommands` map — the target id is in the label; no hidden "current task" global, no first-task guessing for mutations.
- **R7 — Scheduler accidentally on in prod / E2E.** Unchanged kill switch (`PLX_MC_SYNC_ENABLED` unset by default; `instrumentation.ts` gate; Playwright `webServer.env` forces `""`). PR-H only verifies + exports `CADENCE_MS`; it never changes the default. `afterEach` clears the timer so the test leaks none.
- **R8 — New CSS raw-hex regression.** All new chart/switcher CSS is tokens-only under `.mc`/`.insights`; the donut/bars consume `var(--p-*)` via annotated identity maps, never literals. `check-repo-hygiene.py` + a no-hex grep over the diff in review enforce it.
- **R9 — Scope creep into Cycle-3 lines.** Burndown/CFD, person push, bulk select, Postgres saved-views, drag-to-schedule, live-clock overdue, month/zoom are all named OUT per module; E **hides/omits** time-series (no snapshot table exists) rather than faking it.
- **R10 — "Modified •" dirty cue scope.** Build-step-optional (§3.A.6); ships only if the switcher is already being built, else deferred — it is polish, not correctness, and never blocks F's acceptance.

---

### Critical files for implementation
- `C:/Users/vince/PLX_MC/src/components/mc/work-views.persist.ts` *(NEW)* — versioned / corruption / SSR / quota-safe schema + `sanitizeFilterState` (the F↔E trust boundary)
- `C:/Users/vince/PLX_MC/src/components/mc/work-views.tsx` — F's three guarded persistence effects; E's `route.filter` adopt (via `sanitizeFilterState`); G's filtered timeline + FilterBar exposure
- `C:/Users/vince/PLX_MC/src/components/mc/work-views.helpers.ts` — `FilterState` (+ `dueStart`/`dueEnd`), `applyFilters`, `isTaskDueInRange`, `assigneeUniverse`, `dueDay` (E/F/G all read these)
- `C:/Users/vince/PLX_MC/src/lib/mc-data/insights.ts` *(NEW)* — pure aggregator: counts, overdue, and the per-slice `FilterState` click-to-filter contract
- `C:/Users/vince/PLX_MC/src/components/mc/insights.tsx` + `src/components/mc/charts/{donut,bar,legend,chart-tokens,index}.tsx` *(NEW)* — the native-SVG Linear-grade surface, `--p-*` tokens + reduced-motion + a11y
- `C:/Users/vince/PLX_MC/src/components/mc/filter-bar.tsx` — Save / Views popover (F) + Due-range preset facet (G), reusing the `FacetConfig` + chip pipeline
- `C:/Users/vince/PLX_MC/src/components/mc/command-palette.tsx` — two per-task spine actions (`setTaskStage(id,"verified")` / `reassignTask(id,CURRENT_USER)`) + `nav:insights`
- Supporting: `src/components/mc/{route,screens,chrome,shell}.tsx` (insights screen + `g i` + `route.filter`); `src/lib/sync/scheduler.ts` (H, `export CADENCE_MS` only); `src/styles/{mc-charts.css(new),mc-views.css}` (tokens only); precedents to mirror — `src/lib/mc-data/store.ts:48,211,259-294` (SSR-safe localStorage), `src/components/mc/atoms.tsx:46-55` + `src/styles/mc-app.css` (native render) + `src/styles/mc-views.css` (reduced-motion). Tests: `tests/{mc-view-persist,mc-insights,sync-scheduler}.test.ts` *(new)* + extend `tests/{mc-views,mc-store}.test.ts`; `e2e/{saved-views,insights,timeline-filter}.spec.ts` *(new)*. **No migrations** (all reads or `entities.data`-resident; `PUSHED_FIELDS` unchanged).
