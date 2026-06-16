import { ACTORS, BANDS, BUCKETS, BUCKET_IDX, PRIORITY, STAGES, bandOf } from "@/lib/mc-data";
import type { Band, Bucket, PriorityKey, StageKey, Task } from "@/lib/mc-data";

// One unified column axis drives BOTH the board and the list (resolves OQ i;
// replaces the former ad-hoc `BoardGrouping` + `ListGroupBy`). Single-cell:
// a task lands in exactly one column per axis, preserving the disjoint+complete
// partition invariant the tests assert (true multi-membership is Cycle 2, R4).
export type GroupBy = "band" | "stage" | "bucket" | "priority" | "assignee";
export type BoardSwimlanes = "off" | "agents";

type BoardColumn = { key: string; name: string };

// The "Unassigned" column key for assignee-axis grouping/filtering.
export const UNASSIGNED_KEY = "unassigned";

// Priority columns follow the PRIORITY config order (urgent → low).
const PRIORITY_ORDER = Object.keys(PRIORITY) as PriorityKey[];

export const TIMELINE_MONTH_DAYS = 30;
export const TIMELINE_DEFAULT_END_DAY = 24;

export function filterTasksByBucket(tasks: Task[], bucketId?: string): Task[] {
  if (!bucketId) return tasks;
  return tasks.filter((task) => task.bucket === bucketId);
}

// Swimlanes (the Agents/Humans/Unassigned sub-lanes) are only meaningful on the
// lifecycle axes. Under bucket/priority/assignee they would render a meaningless
// sub-split, so the caller must force swimlanes off — keyed off this predicate.
export function swimlanesAllowed(groupBy: GroupBy): boolean {
  return groupBy === "band" || groupBy === "stage";
}

// Ordered columns for an axis — the single grouping source for board + list.
// The band/stage/bucket/priority axes have a fixed column model; the assignee
// axis is data-derived (the distinct assignees present, in directory order,
// then an "Unassigned" column last) so it never renders a column per directory
// member. Pass `tasks` for the assignee axis; the static axes ignore it.
export function columnsFor(groupBy: GroupBy, tasks: Task[] = []): BoardColumn[] {
  switch (groupBy) {
    case "stage":
      return STAGES.map((stage) => ({ key: stage.key, name: stage.name }));
    case "bucket":
      return BUCKETS.map((bucket) => ({ key: bucket.id, name: bucket.name }));
    case "priority":
      return PRIORITY_ORDER.map((key) => ({ key, name: PRIORITY[key].label }));
    case "assignee": {
      const columns = assigneeUniverse(tasks).map((id) => ({
        key: id,
        name: ACTORS[id]?.name ?? id,
      }));
      // The "Unassigned" column is present only when some task lacks an
      // assignee — keeping the partition disjoint+complete with no empty column.
      if (tasks.some((task) => !task.assignee)) {
        columns.push({ key: UNASSIGNED_KEY, name: "Unassigned" });
      }
      return columns;
    }
    case "band":
    default:
      return BANDS.map((band) => ({ key: band.key, name: band.name }));
  }
}

export function boardColumns(groupBy: GroupBy, tasks: Task[] = []): BoardColumn[] {
  return columnsFor(groupBy, tasks);
}

export function columnKeyForTask(task: Task, groupBy: GroupBy): string {
  switch (groupBy) {
    case "stage":
      return task.stage;
    case "bucket":
      return task.bucket;
    case "priority":
      return task.priority;
    case "assignee":
      return task.assignee ?? UNASSIGNED_KEY;
    case "band":
    default:
      return bandOf(task.stage);
  }
}

// ─── Drag-to-mutate axis → field resolution (Module B, pure + tested) ─────────

// The band axis has no single "band" field on a Task; dropping into a band
// column sets the band's ENTRY stage (the first stage of that band). Documented
// map (SPEC §5 Module B): todo→backlog, doing→progress, done→merged. These keys
// are the n=01 / n=05 / n=08 stages of each band in STAGES.
export const BAND_ENTRY_STAGE: Record<Band, StageKey> = {
  todo: "backlog",
  doing: "progress",
  done: "merged",
};

// Which Task field a drop on the given axis mutates. Used both to ENABLE drag
// (only axes that map to a real field are drag-targets) and to route the drop
// through the right PR-0 spine wrapper. Every Cycle-1 axis is persistable, so
// this is non-null for all five — but the union is explicit so a future,
// non-persistable axis (e.g. a derived/computed lane) is disabled, not a silent
// no-op (SPEC §5 "Respect axis sensibility").
export type DragField = "stage" | "priority" | "bucket" | "assignee";

export function dragFieldForAxis(groupBy: GroupBy): DragField | null {
  switch (groupBy) {
    case "band":
    case "stage":
      return "stage";
    case "priority":
      return "priority";
    case "bucket":
      return "bucket";
    case "assignee":
      return "assignee";
    default:
      return null;
  }
}

// True when dropping a card onto a column under this axis maps to a real,
// persisted field mutation. Drives whether cards are `draggable` + columns are
// drop targets (SPEC §5: disable drag on axes where a drop maps to no field,
// rather than no-op silently). All five Cycle-1 axes qualify.
export function dragEnabledForAxis(groupBy: GroupBy): boolean {
  return dragFieldForAxis(groupBy) !== null;
}

// A resolved drop: the field to set and the value to set it to, for the column
// the card was dropped on. `null` when the axis is not drag-mutable or the
// column key is not a real value on that axis (defensive — an unknown drop
// target is dropped, never written). The assignee "Unassigned" column resolves
// to `assignee: null` (unassign). Pure: no store reads, no side effects.
export interface ResolvedDrop {
  field: DragField;
  value: StageKey | PriorityKey | string | null;
}

export function resolveColumnDrop(groupBy: GroupBy, columnKey: string): ResolvedDrop | null {
  switch (groupBy) {
    case "stage":
      // Only a real stage key is a valid target.
      return STAGES.some((s) => s.key === columnKey)
        ? { field: "stage", value: columnKey as StageKey }
        : null;
    case "band": {
      const entry = BAND_ENTRY_STAGE[columnKey as Band];
      return entry ? { field: "stage", value: entry } : null;
    }
    case "priority":
      return columnKey in PRIORITY
        ? { field: "priority", value: columnKey as PriorityKey }
        : null;
    case "bucket":
      return columnKey in BUCKET_IDX ? { field: "bucket", value: columnKey } : null;
    case "assignee":
      // The "Unassigned" sentinel column unassigns; any other key is an actor id.
      return columnKey === UNASSIGNED_KEY
        ? { field: "assignee", value: null }
        : { field: "assignee", value: columnKey };
    default:
      return null;
  }
}

// True when the card already lives in the dropped column on this axis — the
// no-op guard (SPEC §5): a same-column drop must not PATCH (avoids spurious
// writes + the sweep race). Reuses the single read-side column resolver so the
// no-op test is exactly the inverse of where the card renders.
export function isNoopDrop(task: Task, groupBy: GroupBy, columnKey: string): boolean {
  return columnKeyForTask(task, groupBy) === columnKey;
}

export function partitionTasksByColumn(
  tasks: Task[],
  groupBy: GroupBy
): Record<string, Task[]> {
  const out = Object.fromEntries(boardColumns(groupBy, tasks).map((c) => [c.key, [] as Task[]]));
  for (const task of tasks) {
    const key = columnKeyForTask(task, groupBy);
    // Every task lands in a column (the assignee column model is derived from
    // these same tasks, so the partition stays disjoint + complete).
    (out[key] ??= []).push(task);
  }
  return out;
}

export interface SwimlaneGroups {
  agents: Task[];
  humans: Task[];
  unassigned: Task[];
}

export function partitionSwimlanes(tasks: Task[]): SwimlaneGroups {
  const lanes: SwimlaneGroups = { agents: [], humans: [], unassigned: [] };
  for (const task of tasks) {
    const actor = task.assignee ? ACTORS[task.assignee] : undefined;
    if (!actor) {
      lanes.unassigned.push(task);
      continue;
    }
    if (actor.kind === "agent") {
      lanes.agents.push(task);
      continue;
    }
    lanes.humans.push(task);
  }
  return lanes;
}

export interface TaskGroup {
  key: string;
  name: string;
  list: Task[];
}

// List grouping reads the SAME column model as the board (one grouping source
// — kills the former board/list divergence). The list only renders non-empty
// groups; the board renders the full column model. The former list "status"
// option is the unified "band" axis.
export function groupTasksForList(tasks: Task[], groupBy: GroupBy): TaskGroup[] {
  const byColumn = partitionTasksByColumn(tasks, groupBy);
  return columnsFor(groupBy, tasks)
    .map((column) => ({ key: column.key, name: column.name, list: byColumn[column.key] ?? [] }))
    .filter((group) => group.list.length > 0);
}

// ─── Filtering (pure, exported → unit-testable with zero persistence risk) ────

// One filter shape shared by the board + list. Each facet is a multi-select;
// an unset/empty facet does not constrain. Facets AND-combine; within a facet
// the values OR. `assignee` may include UNASSIGNED_KEY to match unassigned tasks.
export interface FilterState {
  text?: string;
  priority?: PriorityKey[];
  assignee?: string[];
  label?: string[];
  stage?: StageKey[];
}

export function hasActiveFilters(f: FilterState): boolean {
  return (
    !!f.text?.trim() ||
    !!f.priority?.length ||
    !!f.assignee?.length ||
    !!f.label?.length ||
    !!f.stage?.length
  );
}

// Pure predicate: text matches id/title/labels (case-insensitive); each facet
// is a Set membership test; an empty filter is the identity. No store reads.
export function applyFilters(tasks: Task[], f: FilterState): Task[] {
  if (!hasActiveFilters(f)) return tasks;
  const text = f.text?.trim().toLowerCase() ?? "";
  const priority = f.priority?.length ? new Set(f.priority) : null;
  const assignee = f.assignee?.length ? new Set(f.assignee) : null;
  const labels = f.label?.length ? new Set(f.label) : null;
  const stages = f.stage?.length ? new Set(f.stage) : null;

  return tasks.filter((task) => {
    if (text) {
      const haystack = [task.id, task.title, ...task.labels].join(" ").toLowerCase();
      if (!haystack.includes(text)) return false;
    }
    if (priority && !priority.has(task.priority)) return false;
    if (assignee && !assignee.has(task.assignee ?? UNASSIGNED_KEY)) return false;
    if (stages && !stages.has(task.stage)) return false;
    if (labels && !task.labels.some((label) => labels.has(label))) return false;
    return true;
  });
}

// Distinct labels across the given tasks, deduped + sorted — filter options.
export function labelUniverse(tasks: Task[]): string[] {
  return Array.from(new Set(tasks.flatMap((task) => task.labels))).sort();
}

// Distinct assignee ids across the given tasks, deduped, in directory order
// (the ACTORS insertion order), with any unknown ids appended sorted. Excludes
// the unassigned sentinel (callers add an "Unassigned" column/option explicitly).
export function assigneeUniverse(tasks: Task[]): string[] {
  const present = new Set(
    tasks.map((task) => task.assignee).filter((id): id is string => !!id)
  );
  const known = Object.keys(ACTORS).filter((id) => present.has(id));
  const unknown = Array.from(present).filter((id) => !(id in ACTORS)).sort();
  return [...known, ...unknown];
}

export function bucketsForTimeline(tasks: Task[]): Bucket[] {
  return BUCKETS.filter((bucket) => tasks.some((task) => task.bucket === bucket.id));
}

// Day offsets from Jun 1 — the timeline is a June grid (CYCLES). Month-aware
// so a "Jul 20" or "Sep 01" due maps beyond the window (and clamps to the
// grid edge) instead of landing on the same-numbered June day.
const MONTH_GRID_OFFSET: Record<string, number> = {
  Apr: -61, May: -31, Jun: 0, Jul: 30, Aug: 61, Sep: 92, Oct: 122, Nov: 153, Dec: 183,
};

export function dueDay(due: string): number | null {
  const withMonth = String(due ?? "").match(/^([A-Z][a-z]{2})\s+(\d+)$/);
  if (withMonth && withMonth[1] in MONTH_GRID_OFFSET) {
    return MONTH_GRID_OFFSET[withMonth[1]] + Number.parseInt(withMonth[2], 10);
  }
  const match = String(due ?? "").match(/(\d+)/);
  if (!match) return null;
  return Number.parseInt(match[1], 10);
}

export function spanOf(estimate?: string): number {
  if (estimate === "S") return 4;
  if (estimate === "M") return 7;
  if (estimate === "L") return 11;
  return 6;
}

export function clampDay(day: number, monthDays = TIMELINE_MONTH_DAYS): number {
  return Math.max(1, Math.min(monthDays, day));
}

export function pctOfDay(day: number, monthDays = TIMELINE_MONTH_DAYS): number {
  return Math.max(0, Math.min(100, (day / monthDays) * 100));
}

export interface TimelineRange {
  startDay: number;
  endDay: number;
  leftPct: number;
  widthPct: number;
}

export function timelineRangeForTask(
  due: string,
  estimate?: string,
  monthDays = TIMELINE_MONTH_DAYS
): TimelineRange {
  // Span is taken from the RAW due day before clamping, so a due beyond the
  // window collapses to a zero-width pin at the grid edge instead of drawing
  // a misleading bar inside June.
  const rawEnd = dueDay(due) ?? TIMELINE_DEFAULT_END_DAY;
  const endDay = clampDay(rawEnd, monthDays);
  const startDay = clampDay(rawEnd - spanOf(estimate), monthDays);
  const leftPct = pctOfDay(startDay, monthDays);
  const widthPct = Math.max(0, pctOfDay(endDay, monthDays) - leftPct);
  return { startDay, endDay, leftPct, widthPct };
}

export function timelineSegmentClass(task: Task): "seg-track" | "seg-risk" | "seg-blocked" | "seg-done" {
  if (task.blocked) return "seg-blocked";
  if (task.stage === "verified" || task.stage === "merged") return "seg-done";
  const bucket = BUCKET_IDX[task.bucket];
  if (task.priority === "urgent" || bucket?.health === "risk") return "seg-risk";
  return "seg-track";
}

export function isTimelineCritical(task: Task): boolean {
  return task.priority === "urgent";
}
