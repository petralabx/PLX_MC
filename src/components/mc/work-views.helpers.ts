import { ACTORS, BANDS, BUCKETS, BUCKET_IDX, STAGES, bandOf } from "@/lib/mc-data";
import type { Bucket, Task } from "@/lib/mc-data";

export type BoardGrouping = "band" | "full";
export type BoardSwimlanes = "off" | "agents";
export type ListGroupBy = "bucket" | "status" | "assignee";

type BoardColumn = { key: string; name: string };

export const TIMELINE_MONTH_DAYS = 30;
export const TIMELINE_DEFAULT_END_DAY = 24;

export function filterTasksByBucket(tasks: Task[], bucketId?: string): Task[] {
  if (!bucketId) return tasks;
  return tasks.filter((task) => task.bucket === bucketId);
}

export function boardColumns(grouping: BoardGrouping): BoardColumn[] {
  return grouping === "full" ? STAGES : BANDS;
}

export function columnKeyForTask(task: Task, grouping: BoardGrouping): string {
  return grouping === "full" ? task.stage : bandOf(task.stage);
}

export function partitionTasksByColumn(
  tasks: Task[],
  grouping: BoardGrouping
): Record<string, Task[]> {
  const out = Object.fromEntries(boardColumns(grouping).map((c) => [c.key, [] as Task[]]));
  for (const task of tasks) {
    out[columnKeyForTask(task, grouping)].push(task);
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

export function groupTasksForList(tasks: Task[], groupBy: ListGroupBy): TaskGroup[] {
  if (groupBy === "assignee") {
    const map = new Map<string, Task[]>();
    for (const task of tasks) {
      const key = task.assignee ?? "unassigned";
      const group = map.get(key);
      if (group) group.push(task);
      else map.set(key, [task]);
    }
    return Array.from(map.entries())
      .map(([key, list]) => ({
        key,
        name: key === "unassigned" ? "Unassigned" : (ACTORS[key]?.name ?? key),
        list,
      }))
      .filter((g) => g.list.length > 0);
  }

  if (groupBy === "status") {
    return BANDS.map((band) => ({
      key: band.key,
      name: band.name,
      list: tasks.filter((task) => bandOf(task.stage) === band.key),
    })).filter((g) => g.list.length > 0);
  }

  return BUCKETS.map((bucket) => ({
    key: bucket.id,
    name: bucket.name,
    list: tasks.filter((task) => task.bucket === bucket.id),
  })).filter((g) => g.list.length > 0);
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
