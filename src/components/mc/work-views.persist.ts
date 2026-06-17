// Filter / view persistence — the pure core (no React, no implicit `window`).
//
// Module F (SPEC §3.A): the live `FilterState` + `groupBy` + `swimlanes` persist
// to localStorage per screen, hydrate on mount without an SSR mismatch, sync
// across tabs, and survive corruption / quota / version drift by silently
// falling back to defaults. Plus a named saved-views list (set / apply / delete).
//
// The string↔object transforms are pure and total (never throw); the thin I/O
// wrappers take an INJECTED `Storage` (defaulting to window.localStorage behind
// canPersist()) so corruption / version / quota are all testable in plain vitest
// with no jsdom — a Map-backed shim (SPEC §3.A.4). `sanitizeFilterState` is the
// F↔E trust boundary reused by the Insights click-to-filter path (SPEC §3.B.3):
// any parsed/hand-constructed blob is coerced to a safe `FilterState` against the
// canonical allow-lists (PRIORITY / STAGES) before it can ever reach applyFilters.

import { PRIORITY, STAGES } from "@/lib/mc-data";
import type { PriorityKey, StageKey } from "@/lib/mc-data";

import type { Screen } from "./route";
import { UNASSIGNED_KEY } from "./work-views.helpers";
import type { BoardSwimlanes, FilterState, GroupBy } from "./work-views.helpers";

// Bump → discard-on-mismatch (a soft migration: a stale blob is dropped back to
// defaults, never migrated). Bump ONLY on a STRUCTURAL break to PersistedView /
// SavedView (renaming a field, or a new required field that cannot default).
// Adding a new OPTIONAL facet (e.g. Module G's dueStart/dueEnd) does NOT need a
// bump — old payloads deserialize fine and the missing field reads as undefined,
// and sanitizeFilterState drops anything stale (SPEC §3.A.2).
export const PERSIST_VERSION = 1;

// Two keys, deliberately split so a corrupt named-view blob cannot wipe the
// cheap last-used state and vice-versa (SPEC §3.A.2). Mirrors the established
// `plx_mc_*_v1` convention (store.ts INVITED_KEY).
const VIEW_KEY = (screen: Screen) => `plx_mc_view_v1:${screen}`; // last-used, auto-saved, per screen
const SAVED_VIEWS_KEY = "plx_mc_saved_views_v1"; // named-view list (a view carries its own screen)

// Per-surface persisted state. `v` is the corruption / version gate.
export interface PersistedView {
  v: number;
  groupBy: GroupBy;
  swimlanes: BoardSwimlanes;
  filters: FilterState;
}

// Named saved views (one list; each view records the screen it was saved on).
export interface SavedView {
  id: string; // `sv-${Date.now()}-${rand}`
  name: string;
  screen: Screen;
  groupBy: GroupBy;
  swimlanes: BoardSwimlanes;
  filters: FilterState;
}

export interface SavedViewsDoc {
  v: number;
  views: SavedView[];
}

// SSR / disabled-storage gate, reused verbatim from store.ts so Node/SSR takes
// the no-op path (the I/O wrappers default their `storage` argument behind this).
const canPersist = (): boolean => typeof window !== "undefined" && !!window.localStorage;

// The canonical allow-lists, read straight from the data layer (single source —
// a renamed enum value is dropped, not silently trusted).
const PRIORITY_KEYS = new Set<string>(Object.keys(PRIORITY));
const STAGE_KEYS = new Set<string>(STAGES.map((s) => s.key));
const GROUP_BY_KEYS = new Set<GroupBy>(["band", "stage", "bucket", "priority", "assignee"]);

// Keep only string members of `pool` from an unknown value; non-array → []
// (the caller drops an empty facet). Pure, total.
function keepStringMembers(raw: unknown, pool: Set<string>): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === "string" && pool.has(v));
}

// Keep only string entries from an unknown value (no enum gate); non-array → [].
function keepStrings(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === "string");
}

// The trust boundary (SPEC §3.A.4): coerce ANY parsed blob to a safe FilterState,
// dropping unknown keys / out-of-allow-list values. Pure, total, never throws.
// Identity on a clean FilterState. Reused by Module E for click-to-filter.
export function sanitizeFilterState(raw: unknown): FilterState {
  const out: FilterState = {};
  if (typeof raw !== "object" || raw === null) return out;
  const src = raw as Record<string, unknown>;

  // text → trimmed non-empty string, else dropped.
  if (typeof src.text === "string") {
    const text = src.text.trim();
    if (text) out.text = text;
  }

  // priority → keep only PRIORITY members (non-array coerces to []).
  const priority = keepStringMembers(src.priority, PRIORITY_KEYS) as PriorityKey[];
  if (priority.length) out.priority = priority;

  // stage → keep only STAGES members.
  const stage = keepStringMembers(src.stage, STAGE_KEYS) as StageKey[];
  if (stage.length) out.stage = stage;

  // assignee → string entries only (may include the UNASSIGNED_KEY sentinel,
  // which is a string and so passes through keepStrings unchanged).
  const assignee = keepStrings(src.assignee);
  if (assignee.length) out.assignee = assignee;

  // label → string entries only.
  const label = keepStrings(src.label);
  if (label.length) out.label = label;

  // dueStart / dueEnd (Module G) → keep only finite numbers; drop otherwise.
  if (typeof src.dueStart === "number" && Number.isFinite(src.dueStart)) out.dueStart = src.dueStart;
  if (typeof src.dueEnd === "number" && Number.isFinite(src.dueEnd)) out.dueEnd = src.dueEnd;

  return out;
}

// `assignee` deliberately allows the UNASSIGNED_KEY sentinel; referenced so the
// import is load-bearing (and to document that the sentinel is a valid value).
void UNASSIGNED_KEY;

function sanitizeGroupBy(raw: unknown, fallback: GroupBy): GroupBy {
  return typeof raw === "string" && GROUP_BY_KEYS.has(raw as GroupBy) ? (raw as GroupBy) : fallback;
}

function sanitizeSwimlanes(raw: unknown): BoardSwimlanes {
  return raw === "agents" ? "agents" : "off";
}

// ─── Pure string↔object transforms (the testable seam) ───────────────────────

export function serializeView(v: PersistedView): string {
  return JSON.stringify({
    v: PERSIST_VERSION,
    groupBy: v.groupBy,
    swimlanes: v.swimlanes,
    filters: sanitizeFilterState(v.filters),
  } satisfies PersistedView);
}

// Pure: JSON.parse in try/catch → null on throw (mirrors store.ts corrupt-ignore);
// a version mismatch / missing `v` → null (discard, not migrate); the surviving
// payload is run through sanitizeFilterState so a stale label or renamed enum
// degrades to "filter dropped", never "filter throws".
export function deserializeView(raw: string | null): PersistedView | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null; // corrupt — ignore
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  if (obj.v !== PERSIST_VERSION) return null; // version drift (or missing `v`) — discard
  return {
    v: PERSIST_VERSION,
    groupBy: sanitizeGroupBy(obj.groupBy, "band"),
    swimlanes: sanitizeSwimlanes(obj.swimlanes),
    filters: sanitizeFilterState(obj.filters),
  };
}

export function serializeSavedViews(doc: SavedViewsDoc): string {
  return JSON.stringify({
    v: PERSIST_VERSION,
    views: doc.views.map((view) => ({
      id: view.id,
      name: view.name,
      screen: view.screen,
      groupBy: view.groupBy,
      swimlanes: view.swimlanes,
      filters: sanitizeFilterState(view.filters),
    })),
  } satisfies SavedViewsDoc);
}

// → [] on ANY corruption / version drift (a bad named-view blob never throws and
// never wipes the separate last-used key — SPEC §3.A.2). Each surviving view is
// sanitized; entries missing an id/name are dropped.
export function deserializeSavedViews(raw: string | null): SavedView[] {
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null) return [];
  const obj = parsed as Record<string, unknown>;
  if (obj.v !== PERSIST_VERSION || !Array.isArray(obj.views)) return [];
  const out: SavedView[] = [];
  for (const entry of obj.views) {
    if (typeof entry !== "object" || entry === null) continue;
    const view = entry as Record<string, unknown>;
    if (typeof view.id !== "string" || typeof view.name !== "string") continue;
    if (typeof view.screen !== "string") continue;
    out.push({
      id: view.id,
      name: view.name,
      screen: view.screen as Screen,
      groupBy: sanitizeGroupBy(view.groupBy, "band"),
      swimlanes: sanitizeSwimlanes(view.swimlanes),
      filters: sanitizeFilterState(view.filters),
    });
  }
  return out;
}

// ─── Thin I/O (storage injected; defaults to window.localStorage) ─────────────
//
// `storage` defaults to undefined → resolve to window.localStorage behind
// canPersist(); in vitest pass a Map-backed shim. Every read deserializes
// through the pure path; every write is wrapped (quota / private-mode safe).

function resolveStorage(storage?: Storage): Storage | null {
  if (storage) return storage;
  if (!canPersist()) return null;
  return window.localStorage;
}

export function loadPersistedView(screen: Screen, storage?: Storage): PersistedView | null {
  const s = resolveStorage(storage);
  if (!s) return null;
  try {
    return deserializeView(s.getItem(VIEW_KEY(screen)));
  } catch {
    return null; // a throwing getItem (private mode) degrades to defaults
  }
}

export function savePersistedView(screen: Screen, v: PersistedView, storage?: Storage): void {
  const s = resolveStorage(storage);
  if (!s) return;
  try {
    s.setItem(VIEW_KEY(screen), serializeView(v));
  } catch {
    // quota or disabled — drop; in-memory state stays authoritative.
  }
}

export function loadSavedViews(storage?: Storage): SavedView[] {
  const s = resolveStorage(storage);
  if (!s) return [];
  try {
    return deserializeSavedViews(s.getItem(SAVED_VIEWS_KEY));
  } catch {
    return [];
  }
}

export function saveSavedViews(views: SavedView[], storage?: Storage): void {
  const s = resolveStorage(storage);
  if (!s) return;
  try {
    s.setItem(SAVED_VIEWS_KEY, serializeSavedViews({ v: PERSIST_VERSION, views }));
  } catch {
    // quota or disabled — drop.
  }
}

// ─── Saved-views CRUD over the pure list (set/rename/delete, dedupe by id) ────
//
// Pure list transforms the UI calls before saveSavedViews — kept here so the
// CRUD invariants (add / dedupe-by-id / rename / delete) are unit-testable
// without React. A new view replaces any existing entry with the same id
// (idempotent set); appends otherwise.

export function upsertSavedView(views: SavedView[], view: SavedView): SavedView[] {
  const idx = views.findIndex((v) => v.id === view.id);
  if (idx === -1) return [...views, view];
  const next = views.slice();
  next[idx] = view;
  return next;
}

export function renameSavedView(views: SavedView[], id: string, name: string): SavedView[] {
  return views.map((v) => (v.id === id ? { ...v, name } : v));
}

export function deleteSavedView(views: SavedView[], id: string): SavedView[] {
  return views.filter((v) => v.id !== id);
}

// Mint a collision-resistant id for a freshly-saved view (SPEC §3.A.2 shape).
export function newSavedViewId(): string {
  return `sv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
