// Project Overview rollup helpers — pure functions of injected buckets/tasks
// (no store reads). Invariants under test: rollup preserves bucket order and
// counts "done" strictly by the done stage band; projectProgress and the
// per-bucket rollups agree with each other on the same task set.

import { describe, expect, it } from "vitest";

import { BUCKETS, TASKS } from "@/lib/mc-data";
import type { Task } from "@/lib/mc-data";
import {
  filterCounts,
  filterTasks,
  isDoneStage,
  isOutstanding,
  needsHuman,
  parseMcDate,
  projectProgress,
  rollupForProject,
  schedulePace,
  shortDate,
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
    expect(projectProgress([])).toMatchObject({ done: 0, doing: 0, total: 0, pct: 0 });
  });
});

describe("cancelled closure", () => {
  it("a cancelled-only project and bucket show zero open, 100% closed, zero delivered", () => {
    const bucket = BUCKETS[0];
    const tasks = [task({ bucket: bucket.id, stage: "cancelled" }), task({ bucket: bucket.id, stage: "cancelled" })];
    const expected = { done: 0, cancelled: 2, closedTasks: 2, remaining: 0, total: 2, pct: 100 };
    expect(projectProgress(tasks)).toMatchObject(expected);
    expect(rollupForProject([bucket], tasks)[0]).toMatchObject(expected);
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

describe("task filter predicates", () => {
  const gate = (status: "pending" | "approved") =>
    ({ id: "apg_1", reason: "r", requestedBy: "agent", status }) as unknown as NonNullable<Task["approvalGates"]>[number];
  const owned = { accountableOwner: "vince" };

  it("Outstanding excludes exactly the done and cancelled bands", () => {
    expect(isOutstanding(task({ stage: "review" }))).toBe(true);
    expect(isOutstanding(task({ stage: "backlog" }))).toBe(true);
    for (const stage of ["merged", "verified", "cancelled"] as const) {
      expect(isOutstanding(task({ stage }))).toBe(false);
    }
  });

  it("Needs a human: a pending gate, a blocked flag, or no human accountable owner", () => {
    expect(needsHuman(task({ ...owned, stage: "progress" }))).toBe(false);
    expect(needsHuman(task({ ...owned, stage: "progress", approvalGates: [gate("pending")] }))).toBe(true);
    expect(needsHuman(task({ ...owned, stage: "progress", approvalGates: [gate("approved")] }))).toBe(false);
    expect(needsHuman(task({ ...owned, stage: "planned", blocked: true }))).toBe(true);
    expect(needsHuman(task({ stage: "planned", accountableOwner: null }))).toBe(true);
    // An agent id is not a human accountable owner (policy.hasHumanAccountableOwner).
    expect(needsHuman(task({ stage: "planned", accountableOwner: "atlas" }))).toBe(true);
  });

  it("closed work never needs a human, whatever its flags", () => {
    expect(needsHuman(task({ stage: "merged", blocked: true, accountableOwner: null }))).toBe(false);
    expect(needsHuman(task({ stage: "cancelled", approvalGates: [gate("pending")] }))).toBe(false);
  });

  it("filterTasks keeps order, and the counts agree with the filtered lists", () => {
    const tasks = [
      task({ ...owned, stage: "merged" }),
      task({ ...owned, stage: "progress", blocked: true }),
      task({ ...owned, stage: "backlog" }),
      task({ ...owned, stage: "cancelled" }),
    ];
    expect(filterTasks(tasks, "open")).toEqual([tasks[1], tasks[2]]);
    expect(filterTasks(tasks, "human")).toEqual([tasks[1]]);
    expect(filterTasks(tasks, "all")).toEqual(tasks);
    expect(filterCounts(tasks)).toEqual({ open: 2, human: 1, all: 4 });
  });
});

describe("parseMcDate", () => {
  it("reads the seed dot format, ISO, and month labels", () => {
    expect(parseMcDate("2026.06.11", 2000)).toEqual(new Date(2026, 5, 11));
    expect(parseMcDate("2026-06-11", 2000)).toEqual(new Date(2026, 5, 11));
    expect(parseMcDate("Oct 01", 2026)).toEqual(new Date(2026, 9, 1));
    expect(parseMcDate("Dec 18, 2027", 2026)).toEqual(new Date(2027, 11, 18));
    expect(parseMcDate("September 3", 2026)).toEqual(new Date(2026, 8, 3));
  });

  it("is null for placeholders, junk and impossible days — never a guess", () => {
    for (const raw of ["—", "", "   ", "TBD", "2026.13.01", "2026.02.30", "Foo 12", "Q3", null, undefined]) {
      expect(parseMcDate(raw, 2026)).toBeNull();
    }
  });

  it("shortDate prints the strip label", () => {
    expect(shortDate(new Date(2026, 5, 1))).toBe("Jun 01");
  });
});

describe("schedulePace", () => {
  // Span Jun 01 → Sep 09 2026 is 100 days, so each day is one point.
  const at = (month: number, day: number) => new Date(2026, month, day);

  it("elapsed % is the share of the started → target span behind us", () => {
    const s = schedulePace(50, "2026.06.01", "2026.09.09", at(6, 21))!;
    expect(s.elapsedPct).toBe(50);
    expect(s.pace).toBe("on");
  });

  it("uses the ±3 point thresholds for ahead and behind", () => {
    const today = at(6, 21); // 50% elapsed
    expect(schedulePace(53, "2026.06.01", "2026.09.09", today)!.pace).toBe("ahead");
    expect(schedulePace(52, "2026.06.01", "2026.09.09", today)!.pace).toBe("on");
    expect(schedulePace(48, "2026.06.01", "2026.09.09", today)!.pace).toBe("on");
    const behind = schedulePace(47, "2026.06.01", "2026.09.09", today)!;
    expect(behind.pace).toBe("behind");
    expect(behind.delta).toBe(-3);
  });

  it("is overdue past the target day, whatever the closed share", () => {
    const s = schedulePace(99, "2026.06.11", "Oct 01", new Date(2026, 9, 17))!;
    expect(s.pace).toBe("overdue");
    expect(s.overdueDays).toBe(16);
    expect(s.elapsedPct).toBe(100);
    // Later on the target day itself is not overdue yet.
    expect(schedulePace(100, "2026.06.11", "Oct 01", new Date(2026, 9, 1, 18))!.pace).toBe("on");
  });

  it("clamps elapsed to 0 before the start", () => {
    expect(schedulePace(0, "2026.06.01", "2026.09.09", at(4, 1))!.elapsedPct).toBe(0);
  });

  it("reads a year-less target in the started year, rolling forward past the start", () => {
    const s = schedulePace(10, "2026.11.01", "Feb 01", new Date(2026, 11, 1))!;
    expect(s.target).toEqual(new Date(2027, 1, 1));
  });

  it("is null when a date does not parse or the span is not forward", () => {
    expect(schedulePace(50, "2026.06.11", "—", at(6, 1))).toBeNull();
    expect(schedulePace(50, "soon", "2026.09.09", at(6, 1))).toBeNull();
    expect(schedulePace(50, "2026.09.09", "2026.06.01", at(6, 1))).toBeNull();
    expect(schedulePace(50, "2026.06.01", "2026.06.01", at(6, 1))).toBeNull();
  });
});
