// Pure rollup math for the Project Overview lens (no store reads — buckets and
// tasks are INJECTED, the same contract as work-views.helpers). "Done" is the
// explicit stage band (merged/verified); progress counts cancelled as closed.
// A merged UAT ticket task stays outstanding until verified (TASK-3697); one
// closed as STALE (uat:stale) is closed and unconfirmed, never done (TASK-4200).

import {
  STAGES,
  STAGE_IDX,
  countTaskProgress,
  awaitsRetest,
  hasHumanAccountableOwner,
  inputRequired,
  isOpenInRollup,
} from "@/lib/mc-data";
import type { Bucket, Task } from "@/lib/mc-data";
import { hasHumanBlockLabel, isStaleClosed } from "@/lib/tasks/uat-labels";

export interface InitiativeRollup {
  bucket: Bucket;
  tasks: Task[];
  done: number;
  cancelled: number;
  /** Closed as STALE (TASK-4200): closed, never done. */
  unconfirmed: number;
  closedTasks: number;
  remaining: number;
  /** All tasks, including cancelled (TASK-2815). */
  total: number;
  pct: number;
}

export function isDoneStage(task: Task): boolean {
  return STAGES[STAGE_IDX[task.stage]].band === "done" && !isStaleClosed(task);
}

export function isDoingStage(task: Task): boolean {
  return STAGES[STAGE_IDX[task.stage]].band === "doing";
}

// One rollup entry per bucket, in the buckets' given order. Tasks keep their
// given order (the store's), so rows are stable across renders.
export function rollupForProject(buckets: Bucket[], tasks: Task[]): InitiativeRollup[] {
  return buckets.map((bucket) => {
    const bucketTasks = tasks.filter((t) => t.bucket === bucket.id);
    const { done, cancelled, unconfirmed, closedTasks, remaining, total, pctDone } = countTaskProgress(bucketTasks);
    return { bucket, tasks: bucketTasks, done, cancelled, unconfirmed, closedTasks, remaining, total, pct: Math.round((pctDone ?? 0) * 100) };
  });
}

// Whole-project counts for the facts-strip progress cell.
export function projectProgress(tasks: Task[]) {
  const counts = countTaskProgress(tasks);
  return { ...counts, doing: counts.inProgress, pct: Math.round((counts.pctDone ?? 0) * 100) };
}

// Stage → chip tone for the rollup task table. Uses the dedicated status TEXT
// tokens (brand contrast remediation) so chips hold WCAG AA on 12% fills.
export function stageChipTone(task: Pick<Task, "stage"> & { labels?: readonly string[] }): "muted" | "info" | "acc" | "warn" | "ok" {
  const stage = STAGES[STAGE_IDX[task.stage]];
  if (awaitsRetest(task)) return "acc";
  // Closed as STALE: nobody confirmed the fix, so never the delivered tone.
  if (isStaleClosed(task)) return "muted";
  if (stage.band === "done") return "ok";
  if (stage.band === "cancelled") return "muted";
  if (stage.key === "qa") return "warn";
  if (stage.band === "doing") return "acc";
  if (stage.key === "backlog") return "muted";
  return "info";
}

// ─── Task filter (Outstanding · Needs a human · All) ────────────────────────

export type TaskFilterKey = "open" | "human" | "all";

/** Outstanding: the stage band is neither done nor cancelled, or a UAT fix awaits re-test. */
export function isOutstanding(task: Pick<Task, "stage" | "labels">): boolean {
  return isOpenInRollup(task);
}

// Needs a human: an open task waiting on a person — a pending runtime approval
// gate (the A2A input-required state), a blocked flag, a Steward block
// (uat:blocked) or needs-vince label (TASK-3697), or no human accountable
// owner (the needs-me.ts unownedTasks rule). Closed work needs nobody.
export function needsHuman(
  task: Pick<Task, "stage" | "approvalGates" | "blocked" | "accountableOwner" | "labels">
): boolean {
  if (!isOutstanding(task)) return false;
  return inputRequired(task) || !!task.blocked || hasHumanBlockLabel(task) || !hasHumanAccountableOwner(task);
}

export function filterTasks<T extends Task>(tasks: readonly T[], filter: TaskFilterKey): T[] {
  if (filter === "open") return tasks.filter(isOutstanding);
  if (filter === "human") return tasks.filter(needsHuman);
  return [...tasks];
}

export function filterCounts(tasks: readonly Task[]): Record<TaskFilterKey, number> {
  return { open: tasks.filter(isOutstanding).length, human: tasks.filter(needsHuman).length, all: tasks.length };
}

// ─── Due filter (TASK-4392) ─────────────────────────────────────────────────
// The project overview filters by due date as well as status. Overdue is an
// outstanding task (the status filter's rule, so a merged UAT fix awaiting
// re-test still counts) past its due date; "week" is Monday to Sunday around
// today; "next14" is today and the 13 days after; "none" has no readable due
// date. Insights' isOverdue reads days on its fixed June demo grid, so it
// cannot take a real today.

export type DueFilterKey = "any" | "overdue" | "week" | "next14" | "none";

export const DUE_FILTERS: ReadonlyArray<{ key: DueFilterKey; label: string }> = [
  { key: "any", label: "Any date" },
  { key: "overdue", label: "Overdue" },
  { key: "week", label: "This week" },
  { key: "next14", label: "Next 14 days" },
  { key: "none", label: "No due date" },
];

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDaysTo = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const ROLL_MS = 300 * 86_400_000;

/**
 * A task's due date as a local day. A label without a year ("Jan 02", the form
 * MC stores) is read in the current year, as the sync reads it (dueToIso). Only
 * when that puts it more than 300 days away does it roll to the nearer year, so
 * the windows hold across New Year (on Dec 30 "Jan 02" is next week, and on
 * Jan 3 "Dec 20" is two weeks late) and a task months overdue stays overdue.
 */
export function dueDate(raw: string | null | undefined, today: Date): Date | null {
  const year = today.getFullYear();
  const due = parseMcDate(raw, year);
  if (!due || /\d{4}/.test(raw ?? "")) return due;
  const gap = due.getTime() - today.getTime();
  if (gap > ROLL_MS) return parseMcDate(raw, year - 1);
  if (gap < -ROLL_MS) return parseMcDate(raw, year + 1);
  return due;
}

/** The Due choices one task matches, besides "any": none, or its windows. */
function dueKeys(task: Pick<Task, "due" | "stage" | "labels">, today: Date): DueFilterKey[] {
  const due = dueDate(task.due, today);
  if (due === null) return ["none"];
  const keys: DueFilterKey[] = [];
  if (due < today && isOutstanding(task)) keys.push("overdue");
  const monday = addDaysTo(today, -((today.getDay() + 6) % 7));
  if (due >= monday && due < addDaysTo(monday, 7)) keys.push("week");
  if (due >= today && due < addDaysTo(today, 14)) keys.push("next14");
  return keys;
}

export function matchesDue(task: Pick<Task, "due" | "stage" | "labels">, key: DueFilterKey, now: Date): boolean {
  return key === "any" || dueKeys(task, dayStart(now)).includes(key);
}

export function filterDue<T extends Pick<Task, "due" | "stage" | "labels">>(tasks: readonly T[], key: DueFilterKey, now: Date): T[] {
  return key === "any" ? [...tasks] : tasks.filter((t) => matchesDue(t, key, now));
}

/** Each Due choice's count, in one pass over the tasks. */
export function dueCounts(tasks: readonly Pick<Task, "due" | "stage" | "labels">[], now: Date): Record<DueFilterKey, number> {
  const out: Record<DueFilterKey, number> = { any: tasks.length, overdue: 0, week: 0, next14: 0, none: 0 };
  const today = dayStart(now);
  for (const task of tasks) for (const key of dueKeys(task, today)) out[key] += 1;
  return out;
}

// The rows a capped TaskTable shows: the cap applies to the outstanding rows
// and the revealed closed rows separately, so "Show closed" always shows some.
export function cappedRows<T>(tasks: readonly T[], closed: readonly T[], cap: number): T[] {
  return [...tasks.slice(0, cap), ...closed.slice(0, cap)];
}

// ─── Schedule vs work ────────────────────────────────────────────────────────

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DAY_MS = 86_400_000;

function validDate(year: number, month: number, day: number): Date | null {
  const date = new Date(year, month, day);
  return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day ? date : null;
}

// Local calendar date as a whole-day ordinal, independent of DST.
function dayNumber(date: Date): number {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS;
}

// Project/bucket dates are free text: "2026.06.11" (seed), ISO "2026-06-11",
// or a label like "Oct 01" / "Oct 1, 2026". A label without a year takes
// `fallbackYear`. Anything else (including "—") is null — never a guess.
export function parseMcDate(raw: string | null | undefined, fallbackYear: number): Date | null {
  const value = raw?.trim() ?? "";
  const ymd = /^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})(?:[T ].*)?$/.exec(value);
  if (ymd) return validDate(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));
  const label = /^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?$/.exec(value);
  if (!label) return null;
  const month = MONTHS.indexOf(label[1].toLowerCase());
  if (month < 0) return null;
  return validDate(label[3] ? Number(label[3]) : fallbackYear, month, Number(label[2]));
}

/** "Jun 11" — the short label the strip shows for a parsed date. */
export function shortDate(date: Date): string {
  const month = MONTHS[date.getMonth()];
  return `${month[0].toUpperCase()}${month.slice(1)} ${String(date.getDate()).padStart(2, "0")}`;
}

export type PaceKey = "overdue" | "ahead" | "behind" | "on";

export interface SchedulePace {
  started: Date;
  target: Date;
  /** Share of the started → target span behind us, 0–1. */
  frac: number;
  elapsedPct: number;
  /** closedPct − elapsedPct, in points. */
  delta: number;
  pace: PaceKey;
  /** Whole days past the target (0 unless overdue). */
  overdueDays: number;
}

// Closed % vs elapsed % for the overview strip. Null when either date fails
// to parse or the span is not forward in time: the strip then hides the
// comparison instead of showing a wrong one. A target label without a year is
// read in the started year, and rolls forward a year if that lands before it.
export function schedulePace(
  closedPct: number,
  startedRaw: string,
  targetRaw: string,
  today: Date
): SchedulePace | null {
  const started = parseMcDate(startedRaw, today.getFullYear());
  if (!started) return null;
  let target = parseMcDate(targetRaw, started.getFullYear());
  if (target && target < started && !/\d{4}/.test(targetRaw)) {
    target = parseMcDate(targetRaw, started.getFullYear() + 1);
  }
  if (!target || target <= started) return null;
  const span = target.getTime() - started.getTime();
  const frac = Math.min(1, Math.max(0, (today.getTime() - started.getTime()) / span));
  const elapsedPct = Math.round(frac * 100);
  const delta = closedPct - elapsedPct;
  // Overdue counts from the end of the target day, in local calendar days (a
  // DST day is not DAY_MS long).
  const overdueDays = Math.max(0, dayNumber(today) - dayNumber(target));
  const pace: PaceKey = overdueDays > 0 ? "overdue" : delta >= 3 ? "ahead" : delta <= -3 ? "behind" : "on";
  return { started, target, frac, elapsedPct, delta, pace, overdueDays };
}
