// Insights aggregator — pure, deterministic, unit-tested (SPEC §3.B.2 / Module E).
//
// No React, no store reads, no Date.now()/new Date(): the "today" reference is an
// INJECTED constant (INSIGHTS_TODAY_DAY), so every aggregator is a pure
// (tasks, todayDay) => model. This keeps the overdue computation deterministic
// (tests inject todayDay) and honest to the existing fixed-June grid that dueDay()
// already uses — see the INSIGHTS_TODAY_DAY note below and SPEC §1.1.

import { ACTORS, BANDS, BUCKETS, PRIORITY, STAGES, bandOf } from "@/lib/mc-data";
import type { Band, Bucket, PriorityKey, Task } from "@/lib/mc-data";
import {
  UNASSIGNED_KEY,
  assigneeUniverse,
  dueDay,
} from "@/components/mc/work-views.helpers";
import type { FilterState } from "@/components/mc/work-views.helpers";
import {
  BUCKET_COLOR_VAR,
  PRIORITY_COLOR_VAR,
  STATUS_COLOR_VAR,
  UNASSIGNED_COLOR_VAR,
} from "@/components/mc/charts/chart-tokens";

// IMPORTANT: a fixed constant for Cycle-2 determinism — NOT a live clock.
// dueDay() is a Jun-1 day-offset grid (Jun = 0 ⇒ Jun 16 = day 16), so this is
// the grid "now" cursor. Do NOT replace it with Date.now()/new Date(): that
// makes the aggregator impure, flakes the isOverdue tests by calendar day, and
// (against real June 2026) marks ~nothing overdue. A live clock is a one-line
// Cycle-3 seam swap (replace this constant with the injected runtime value) —
// see SPEC §1.1 and §2.1. Tests inject todayDay explicitly.
export const INSIGHTS_TODAY_DAY = 16; // fixed June-grid "now" cursor (Jun 16)

// One chart slice: a labelled count, a TOKEN name for its fill (NOT a hex — the
// component maps it to var(--p-*)), and the FilterState a click applies. `filter`
// is null when a slice navigates by route param instead of widening the filter
// contract (the bucket axis — SPEC §3.B.5).
export interface ChartSlice {
  key: string;
  label: string;
  value: number;
  colorVar: string;
  filter: FilterState | null;
}

export interface InsightsModel {
  total: number;
  overdue: number;
  unassigned: number;
  blocked: number;
  byStatus: ChartSlice[]; // 3 bands (todo/doing/done) via bandOf — the donut
  byBucket: ChartSlice[]; // BUCKETS order (present buckets only)
  byAssignee: ChartSlice[]; // assigneeUniverse order + Unassigned
  byPriority: ChartSlice[]; // PRIORITY order
}

// The stages that make up a band (used both for the status→stage filter mapping
// and to keep the donut honest: a band is N stages, and applyFilters filters on
// `stage`, so there is no synthetic "band" facet — SPEC §3.B.5).
function stagesForBand(band: Band) {
  return STAGES.filter((s) => s.band === band).map((s) => s.key);
}

// "Done" is explicit and tested: done = stage ∈ {merged, verified} (band `done`).
// Overdue EXCLUDES done; an undated task (dueDay → null) is never overdue.
export function isOverdue(task: Task, todayDay = INSIGHTS_TODAY_DAY): boolean {
  if (task.stage === "merged" || task.stage === "verified") return false; // done excluded
  const d = dueDay(task.due);
  return d !== null && d < todayDay;
}

// The pure click-to-filter mapping for the three facetable axes (SPEC §3.B.5).
// status (band) → the band's stages; priority → [key]; assignee → [key] (which
// may be the UNASSIGNED_KEY sentinel, round-tripping through applyFilters). The
// bucket axis has NO FilterState facet, so it is handled at the call site
// (nav by bucketId), never here — passing "bucket" is unreachable by design.
export function filterForSegment(
  kind: "status" | "priority" | "assignee",
  key: string
): FilterState {
  switch (kind) {
    case "status":
      return { stage: stagesForBand(key as Band) };
    case "priority":
      return { priority: [key as PriorityKey] };
    case "assignee":
      return { assignee: [key] };
  }
}

export function buildInsights(
  tasks: Task[],
  todayDay = INSIGHTS_TODAY_DAY,
  // Buckets are INJECTED (default = fixture) so this stays a pure, deterministic
  // aggregator with no store reads; the view passes the live allBuckets() set
  // (EN-005) so user-created initiatives chart once they hold tasks.
  buckets: Bucket[] = BUCKETS
): InsightsModel {
  // ── Status (band) — the donut. BANDS order; bandOf maps each stage to a band,
  // so the partition is disjoint + complete over `tasks`. ──────────────────────
  const bandCounts = new Map<Band, number>(BANDS.map((b) => [b.key, 0]));
  for (const task of tasks) {
    const band = bandOf(task.stage);
    bandCounts.set(band, (bandCounts.get(band) ?? 0) + 1);
  }
  const byStatus: ChartSlice[] = BANDS.map((band) => ({
    key: band.key,
    label: band.name,
    value: bandCounts.get(band.key) ?? 0,
    colorVar: STATUS_COLOR_VAR[band.key],
    filter: filterForSegment("status", band.key),
  }));

  // ── Bucket (Initiative) — BUCKETS order, present buckets only (a bucket with
  // zero tasks renders no clickable row; SPEC §3.B.4 "never a 0-width clickable").
  // bucket is a board AXIS, not a facet, so filter is null and the click site
  // routes by bucketId (SPEC §3.B.5). ─────────────────────────────────────────
  const bucketCounts = new Map<string, number>();
  for (const task of tasks) {
    bucketCounts.set(task.bucket, (bucketCounts.get(task.bucket) ?? 0) + 1);
  }
  const byBucket: ChartSlice[] = buckets.filter(
    (b) => (bucketCounts.get(b.id) ?? 0) > 0
  ).map((b) => ({
    key: b.id,
    label: b.name,
    value: bucketCounts.get(b.id) ?? 0,
    colorVar: BUCKET_COLOR_VAR,
    filter: null, // bucket is a board axis, not a FilterState facet (§3.B.5)
  }));

  // ── Assignee — assigneeUniverse order (present assignees, directory order),
  // then an explicit "Unassigned" slice when some task lacks an assignee. Keeps
  // the partition disjoint + complete (mirrors columnsFor's assignee axis). ────
  const assigneeCounts = new Map<string, number>();
  let unassigned = 0;
  for (const task of tasks) {
    if (task.assignee) {
      assigneeCounts.set(task.assignee, (assigneeCounts.get(task.assignee) ?? 0) + 1);
    } else {
      unassigned += 1;
    }
  }
  const byAssignee: ChartSlice[] = assigneeUniverse(tasks).map((id) => ({
    key: id,
    label: ACTORS[id]?.name ?? id,
    value: assigneeCounts.get(id) ?? 0,
    colorVar: BUCKET_COLOR_VAR, // bars use one hue + opacity steps (§3.B.4)
    filter: filterForSegment("assignee", id),
  }));
  if (unassigned > 0) {
    byAssignee.push({
      key: UNASSIGNED_KEY,
      label: "Unassigned",
      value: unassigned,
      colorVar: UNASSIGNED_COLOR_VAR,
      filter: filterForSegment("assignee", UNASSIGNED_KEY),
    });
  }

  // ── Priority — PRIORITY config order (urgent → low). Every task has a
  // priority, so this partition is complete over `tasks`. ─────────────────────
  const priorityKeys = Object.keys(PRIORITY) as PriorityKey[];
  const priorityCounts = new Map<PriorityKey, number>(priorityKeys.map((k) => [k, 0]));
  for (const task of tasks) {
    priorityCounts.set(task.priority, (priorityCounts.get(task.priority) ?? 0) + 1);
  }
  const byPriority: ChartSlice[] = priorityKeys.map((key) => ({
    key,
    label: PRIORITY[key].label,
    value: priorityCounts.get(key) ?? 0,
    colorVar: PRIORITY_COLOR_VAR[key],
    filter: filterForSegment("priority", key),
  }));

  return {
    total: tasks.length,
    overdue: tasks.filter((task) => isOverdue(task, todayDay)).length,
    unassigned,
    blocked: tasks.filter((task) => task.blocked).length,
    byStatus,
    byBucket,
    byAssignee,
    byPriority,
  };
}
