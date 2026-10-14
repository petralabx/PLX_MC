// Pure rollup math for the Project Overview lens (no store reads — buckets and
// tasks are INJECTED, the same contract as work-views.helpers). "Done" is the
// explicit stage band (merged/verified); progress counts cancelled as closed.

import { STAGES, STAGE_IDX, countTaskProgress } from "@/lib/mc-data";
import type { Bucket, Task } from "@/lib/mc-data";

export interface InitiativeRollup {
  bucket: Bucket;
  tasks: Task[];
  done: number;
  cancelled: number;
  closedTasks: number;
  remaining: number;
  /** All tasks, including cancelled (TASK-2815). */
  total: number;
  pct: number;
}

export function isDoneStage(task: Task): boolean {
  return STAGES[STAGE_IDX[task.stage]].band === "done";
}

export function isDoingStage(task: Task): boolean {
  return STAGES[STAGE_IDX[task.stage]].band === "doing";
}

// One rollup entry per bucket, in the buckets' given order. Tasks keep their
// given order (the store's), so rows are stable across renders.
export function rollupForProject(buckets: Bucket[], tasks: Task[]): InitiativeRollup[] {
  return buckets.map((bucket) => {
    const bucketTasks = tasks.filter((t) => t.bucket === bucket.id);
    const { done, cancelled, closedTasks, remaining, total, pctDone } = countTaskProgress(bucketTasks);
    return { bucket, tasks: bucketTasks, done, cancelled, closedTasks, remaining, total, pct: Math.round((pctDone ?? 0) * 100) };
  });
}

// Whole-project counts for the facts-strip progress cell.
export function projectProgress(tasks: Task[]) {
  const counts = countTaskProgress(tasks);
  return { ...counts, doing: counts.inProgress, pct: Math.round((counts.pctDone ?? 0) * 100) };
}

// Stage → chip tone for the rollup task table. Uses the dedicated status TEXT
// tokens (brand contrast remediation) so chips hold WCAG AA on 12% fills.
export function stageChipTone(task: Pick<Task, "stage">): "muted" | "info" | "acc" | "warn" | "ok" {
  const stage = STAGES[STAGE_IDX[task.stage]];
  if (stage.band === "done") return "ok";
  if (stage.band === "cancelled") return "muted";
  if (stage.key === "qa") return "warn";
  if (stage.band === "doing") return "acc";
  if (stage.key === "backlog") return "muted";
  return "info";
}
