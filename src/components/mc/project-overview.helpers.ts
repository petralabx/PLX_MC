// Pure rollup math for the Project Overview lens (no store reads — buckets and
// tasks are INJECTED, the same contract as work-views.helpers). "Done" is the
// explicit stage band (merged/verified), matching insights.ts and the P1 card
// grid so every surface counts progress identically.

import { STAGES, STAGE_IDX } from "@/lib/mc-data";
import type { Bucket, Task } from "@/lib/mc-data";

export interface InitiativeRollup {
  bucket: Bucket;
  tasks: Task[];
  done: number;
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
    const done = bucketTasks.filter(isDoneStage).length;
    const pct = bucketTasks.length > 0 ? Math.round((done / bucketTasks.length) * 100) : 0;
    return { bucket, tasks: bucketTasks, done, pct };
  });
}

// Whole-project counts for the facts-strip progress cell.
export function projectProgress(tasks: Task[]): { done: number; doing: number; total: number; pct: number } {
  const done = tasks.filter(isDoneStage).length;
  const doing = tasks.filter(isDoingStage).length;
  const total = tasks.length;
  return { done, doing, total, pct: total > 0 ? Math.round((done / total) * 100) : 0 };
}

// Stage → chip tone for the rollup task table. Uses the dedicated status TEXT
// tokens (brand contrast remediation) so chips hold WCAG AA on 12% fills.
export function stageChipTone(task: Task): "muted" | "info" | "acc" | "warn" | "ok" {
  const stage = STAGES[STAGE_IDX[task.stage]];
  if (stage.band === "done") return "ok";
  if (stage.key === "qa") return "warn";
  if (stage.band === "doing") return "acc";
  if (stage.key === "backlog") return "muted";
  return "info";
}
