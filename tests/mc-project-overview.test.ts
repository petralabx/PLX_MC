// Project Overview rollup helpers — pure functions of injected buckets/tasks
// (no store reads). Invariants under test: rollup preserves bucket order and
// counts "done" strictly by the done stage band; projectProgress and the
// per-bucket rollups agree with each other on the same task set.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { BUCKETS, TASKS } from "@/lib/mc-data";
import type { Task } from "@/lib/mc-data";
import {
  cappedRows,
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
import { TaskTable } from "@/components/mc/task-table";

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

// TASK-3697: a UAT ticket task (kind:code plus uat:<feedbackId>) is done when
// the portal sets verified, and Steward's blocks reach "Needs a human".
describe("UAT ticket tasks", () => {
  const uat = (over: Partial<Task>) =>
    task({ accountableOwner: "vince", labels: ["kind:code", "uat:cmfb7q2xk0001"], ...over });

  it("counts a merged UAT fix as in progress until verified; other merged work stays done", () => {
    const bucket = BUCKETS[0];
    const tasks = [
      uat({ bucket: bucket.id, stage: "merged" }),
      uat({ bucket: bucket.id, stage: "verified" }),
      task({ bucket: bucket.id, stage: "merged", labels: ["kind:code"] }),
    ];
    const [r] = rollupForProject([bucket], tasks);
    expect(r).toMatchObject({ done: 2, remaining: 1, total: 3, pct: 67 });
    expect(projectProgress(tasks)).toMatchObject({ done: 2, doing: 1, remaining: 1 });
    expect(isOutstanding(tasks[0])).toBe(true);
    expect(isOutstanding(tasks[1])).toBe(false);
    expect(isOutstanding(tasks[2])).toBe(false);
    expect(stageChipTone(tasks[0])).toBe("acc");
    expect(stageChipTone(tasks[1])).toBe("ok");
  });

  it("puts a uat:blocked or needs-vince task under Needs a human, and shows Steward's cause", () => {
    const blocked = uat({ stage: "progress", labels: ["kind:code", "uat:cmfb7q2xk0001", "uat:blocked", "uat:cause:quota"] });
    const vince = task({ stage: "planned", accountableOwner: "vince", labels: ["needs-vince"] });
    const plain = uat({ stage: "progress" });
    expect(needsHuman(blocked)).toBe(true);
    expect(needsHuman(vince)).toBe(true);
    expect(needsHuman(plain)).toBe(false);
    expect(filterTasks([blocked, vince, plain], "human")).toEqual([blocked, vince]);
    // Closed work still needs nobody.
    expect(needsHuman({ ...blocked, stage: "cancelled" })).toBe(false);
    const html = renderToStaticMarkup(
      createElement(TaskTable, { tasks: [blocked, vince], nav: () => {}, emptyText: "None" })
    );
    expect(html).toContain("Blocked · quota");
    expect(html).toContain("Needs Vince");
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

describe("schedulePace across DST (America/New_York)", () => {
  // Overdue counts local calendar days, not 24-hour periods: a DST day is 23
  // or 25 hours long.
  const tz = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = "America/New_York";
  });
  afterAll(() => {
    if (tz === undefined) delete process.env.TZ;
    else process.env.TZ = tz;
  });

  it("a spring-forward target is 1 day overdue just after midnight", () => {
    const s = schedulePace(50, "2026.01.01", "2026.03.08", new Date(2026, 2, 9, 0, 30))!;
    expect(s.overdueDays).toBe(1);
    expect(s.pace).toBe("overdue");
  });

  it("a fall-back target is 1 day overdue the next day, not 2", () => {
    expect(schedulePace(50, "2026.01.01", "2026.11.01", new Date(2026, 10, 2, 0, 30))!.overdueDays).toBe(1);
    expect(schedulePace(50, "2026.01.01", "2026.11.01", new Date(2026, 10, 2, 23, 30))!.overdueDays).toBe(1);
  });

  it("is 0 on the target day and for a future target", () => {
    expect(schedulePace(50, "2026.01.01", "2026.03.08", new Date(2026, 2, 8, 23, 59))!.overdueDays).toBe(0);
    expect(schedulePace(50, "2026.01.01", "2026.11.01", new Date(2026, 10, 1, 23, 59))!.overdueDays).toBe(0);
    const future = schedulePace(50, "2026.01.01", "2026.12.31", new Date(2026, 2, 9, 0, 30))!;
    expect(future.overdueDays).toBe(0);
    expect(future.pace).not.toBe("overdue");
  });
});

describe("cappedRows (TaskTable row cap)", () => {
  const open = Array.from({ length: 10 }, (_, i) => `open-${i}`);
  const closed = ["closed-0", "closed-1", "closed-2"];

  it("closed rows hidden: the first `cap` outstanding rows, as before", () => {
    expect(cappedRows(open, [], 8)).toEqual(open.slice(0, 8));
    expect(cappedRows(open.slice(0, 3), [], 8)).toEqual(open.slice(0, 3));
  });

  it("closed rows shown with 8+ outstanding: the closed rows are still visible", () => {
    const rows = cappedRows(open, closed, 8);
    expect(rows).toEqual([...open.slice(0, 8), ...closed]);
  });

  it("caps each group separately", () => {
    const many = Array.from({ length: 12 }, (_, i) => `closed-${i}`);
    expect(cappedRows(open, many, 8)).toEqual([...open.slice(0, 8), ...many.slice(0, 8)]);
  });

  it("TaskTable with closed rows hidden still caps the outstanding rows", () => {
    const outstanding = Array.from({ length: 10 }, (_, i) => task({ id: `T-OPEN-${i}`, stage: "backlog" }));
    const done = [task({ id: "T-DONE-0", stage: "merged" }), task({ id: "T-DONE-1", stage: "merged" })];
    const html = renderToStaticMarkup(
      createElement(TaskTable, { tasks: outstanding, closed: done, nav: () => {}, emptyText: "None" })
    );
    expect(html.match(/class="pv-trow"/g)).toHaveLength(8);
    expect(html).toContain("T-OPEN-7");
    expect(html).not.toContain("T-OPEN-8");
    expect(html).not.toContain("T-DONE-0");
    expect(html).toContain("Show all 10 · 2 more");
    expect(html).toContain("Show 2 closed");
  });
});

describe("section header CSS at the phone tier", () => {
  it("lets the progress bar shrink and the count wrap below 600px", () => {
    const css = readFileSync(join(process.cwd(), "src/styles/mc-overview.css"), "utf8");
    const start = css.indexOf("@container pv-sec (max-width: 599px)");
    expect(start).toBeGreaterThan(-1);
    const block = css.slice(start, css.indexOf("\n}\n", start));
    expect(block).toMatch(/\.pv-sec-r \.track \.bar \{[^}]*flex: 0 1 96px;[^}]*min-width: 48px;/);
    expect(block).toMatch(/\.pv-sec-r \.track \.ct \{[^}]*min-width: 0;[^}]*white-space: normal;/);
  });
});
