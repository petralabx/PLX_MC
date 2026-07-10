// Project Overview rollup helpers — pure functions of injected buckets/tasks
// (no store reads). Invariants under test: rollup preserves bucket order and
// counts "done" strictly by the done stage band; projectProgress and the
// per-bucket rollups agree with each other on the same task set.

import { describe, expect, it } from "vitest";

import { BUCKETS, TASKS } from "@/lib/mc-data";
import type { Task } from "@/lib/mc-data";
import {
  isDoneStage,
  projectProgress,
  rollupForProject,
  stageChipTone,
} from "@/components/mc/project-overview.helpers";

const task = (over: Partial<Task>): Task =>
  ({ ...TASKS[0], id: `T-${Math.random().toString(36).slice(2, 8)}`, ...over }) as Task;

describe("rollupForProject", () => {
  it("returns one entry per bucket, in bucket order, with only that bucket's tasks", () => {
    const rollups = rollupForProject(BUCKETS, TASKS);
    expect(rollups.map((r) => r.bucket.id)).toEqual(BUCKETS.map((b) => b.id));
    for (const r of rollups) {
      expect(r.tasks.every((t) => t.bucket === r.bucket.id)).toBe(true);
    }
    // Every fixture task belongs to a fixture bucket — none are dropped.
    expect(rollups.reduce((n, r) => n + r.tasks.length, 0)).toBe(TASKS.length);
  });

  it("counts done strictly by the done band (merged/verified)", () => {
    const bucket = BUCKETS[0];
    const tasks = [
      task({ bucket: bucket.id, stage: "merged" }),
      task({ bucket: bucket.id, stage: "verified" }),
      task({ bucket: bucket.id, stage: "qa" }),
      task({ bucket: bucket.id, stage: "backlog" }),
    ];
    const [r] = rollupForProject([bucket], tasks);
    expect(r.done).toBe(2);
    expect(r.pct).toBe(50);
  });

  it("an empty bucket rolls up to zero tasks and 0% (never NaN)", () => {
    const [r] = rollupForProject([BUCKETS[0]], []);
    expect(r.tasks).toEqual([]);
    expect(r.done).toBe(0);
    expect(r.pct).toBe(0);
  });
});

describe("projectProgress", () => {
  it("agrees with the per-bucket rollups on the same task set", () => {
    const rollups = rollupForProject(BUCKETS, TASKS);
    const p = projectProgress(TASKS);
    expect(p.total).toBe(TASKS.length);
    expect(p.done).toBe(rollups.reduce((n, r) => n + r.done, 0));
  });

  it("splits done and doing by band", () => {
    const tasks = [
      task({ stage: "merged" }),
      task({ stage: "progress" }),
      task({ stage: "qa" }),
      task({ stage: "planned" }),
    ];
    const p = projectProgress(tasks);
    expect(p).toMatchObject({ done: 1, doing: 2, total: 4, pct: 25 });
  });

  it("handles an empty project without dividing by zero", () => {
    expect(projectProgress([])).toEqual({ done: 0, doing: 0, total: 0, pct: 0 });
  });
});

describe("stage semantics", () => {
  it("isDoneStage matches the insights.ts done definition", () => {
    expect(isDoneStage(task({ stage: "merged" }))).toBe(true);
    expect(isDoneStage(task({ stage: "verified" }))).toBe(true);
    expect(isDoneStage(task({ stage: "review" }))).toBe(false);
  });

  it("stageChipTone maps every stage to a defined tone", () => {
    const tones = ["muted", "info", "acc", "warn", "ok"];
    for (const stage of ["backlog", "specced", "approved", "planned", "progress", "qa", "review", "merged", "verified"] as const) {
      expect(tones).toContain(stageChipTone(task({ stage })));
    }
  });
});
