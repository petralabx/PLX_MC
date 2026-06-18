import { describe, expect, it } from "vitest";

import { BUCKETS, PRIORITY, STAGES, TASKS, bandOf } from "@/lib/mc-data";
import type { PriorityKey, StageKey, Task } from "@/lib/mc-data";
import {
  INSIGHTS_TODAY_DAY,
  buildInsights,
  filterForSegment,
  isOverdue,
} from "@/lib/mc-data/insights";
import { applyFilters, UNASSIGNED_KEY } from "@/components/mc/work-views.helpers";

// A minimal Task factory — only the fields the aggregator + applyFilters read
// matter; the rest are filled with inert defaults so the truth tables stay
// deterministic and independent of the live fixture (SPEC §3.B.7).
let seq = 0;
function task(over: Partial<Task> = {}): Task {
  seq += 1;
  return {
    id: `T-${seq}`,
    title: `Task ${seq}`,
    bucket: "BKT-WMS",
    stage: "planned",
    priority: "medium",
    assignee: "greg",
    coassignees: [],
    reporter: "vince",
    accountableOwner: "vince",
    reqs: [],
    repos: [],
    estimate: "M",
    labels: [],
    prs: [],
    due: "Jun 10",
    sync: { state: "pending", ts: "—", sp: "—" },
    subtasks: [],
    activity: [],
    ...over,
  };
}

// A mixed fixture spanning all three bands, distinct assignees (+ an unassigned),
// every priority, two buckets, a blocked task, and a range of due days so the
// click-to-filter contract is exercised across each axis.
function mixedTasks(): Task[] {
  return [
    task({ stage: "backlog", priority: "urgent", assignee: "greg", bucket: "BKT-WMS", due: "Jun 5" }),
    task({ stage: "specced", priority: "high", assignee: "rishi", bucket: "BKT-WMS", due: "Jun 20" }),
    task({ stage: "progress", priority: "high", assignee: "greg", bucket: "BKT-DAPI", due: "Jun 8", blocked: true }),
    task({ stage: "qa", priority: "medium", assignee: null, bucket: "BKT-DAPI", due: "Jun 12" }),
    task({ stage: "review", priority: "low", assignee: "rishi", bucket: "BKT-WMS", due: "Jul 02" }),
    task({ stage: "merged", priority: "medium", assignee: "greg", bucket: "BKT-DAPI", due: "Jun 1" }),
    task({ stage: "verified", priority: "urgent", assignee: null, bucket: "BKT-WMS", due: "Jun 3" }),
  ];
}

describe("buildInsights — counts & partition invariants (SPEC §3.B.7)", () => {
  it("total equals tasks.length", () => {
    const tasks = mixedTasks();
    expect(buildInsights(tasks).total).toBe(tasks.length);
  });

  it("each breakdown sums to the total (disjoint + complete partition)", () => {
    const tasks = mixedTasks();
    const m = buildInsights(tasks);
    const sum = (slices: { value: number }[]) => slices.reduce((a, s) => a + s.value, 0);
    expect(sum(m.byStatus)).toBe(m.total);
    expect(sum(m.byBucket)).toBe(m.total);
    expect(sum(m.byAssignee)).toBe(m.total);
    expect(sum(m.byPriority)).toBe(m.total);
  });

  it("byStatus has the three bands in BANDS order and matches bandOf counts", () => {
    const tasks = mixedTasks();
    const m = buildInsights(tasks);
    expect(m.byStatus.map((s) => s.key)).toEqual(["todo", "doing", "done"]);
    for (const slice of m.byStatus) {
      const expected = tasks.filter((t) => bandOf(t.stage) === slice.key).length;
      expect(slice.value).toBe(expected);
    }
  });

  it("byPriority follows PRIORITY config order", () => {
    const m = buildInsights(mixedTasks());
    expect(m.byPriority.map((s) => s.key)).toEqual(Object.keys(PRIORITY));
  });

  it("includes an Unassigned assignee slice iff some task lacks an assignee", () => {
    const withUnassigned = buildInsights(mixedTasks());
    expect(withUnassigned.byAssignee.some((s) => s.key === UNASSIGNED_KEY)).toBe(true);
    expect(withUnassigned.unassigned).toBe(2);

    const allAssigned = buildInsights([task({ assignee: "greg" }), task({ assignee: "rishi" })]);
    expect(allAssigned.byAssignee.some((s) => s.key === UNASSIGNED_KEY)).toBe(false);
    expect(allAssigned.unassigned).toBe(0);
  });

  it("byBucket lists only present buckets, in BUCKETS order, summing to total", () => {
    const m = buildInsights(mixedTasks());
    const presentInOrder = BUCKETS.map((b) => b.id).filter((id) =>
      m.byBucket.some((s) => s.key === id)
    );
    expect(m.byBucket.map((s) => s.key)).toEqual(presentInOrder);
    // Only the two seeded buckets are present.
    expect(m.byBucket.map((s) => s.key).sort()).toEqual(["BKT-DAPI", "BKT-WMS"]);
  });

  it("blocked KPI counts blocked tasks", () => {
    expect(buildInsights(mixedTasks()).blocked).toBe(1);
  });

  it("is zero-safe / NaN-free on empty input", () => {
    const m = buildInsights([]);
    expect(m.total).toBe(0);
    expect(m.overdue).toBe(0);
    expect(m.unassigned).toBe(0);
    expect(m.blocked).toBe(0);
    // Status/priority are fixed-order axes (always rendered); bucket/assignee are
    // data-derived so empty input yields no rows.
    expect(m.byBucket).toEqual([]);
    expect(m.byAssignee).toEqual([]);
    for (const slice of [...m.byStatus, ...m.byPriority]) {
      expect(Number.isFinite(slice.value)).toBe(true);
      expect(slice.value).toBe(0);
    }
  });

  it("the live TASKS fixture sums correctly across every axis", () => {
    const m = buildInsights(TASKS);
    expect(m.total).toBe(TASKS.length);
    const sum = (slices: { value: number }[]) => slices.reduce((a, s) => a + s.value, 0);
    expect(sum(m.byStatus)).toBe(TASKS.length);
    expect(sum(m.byBucket)).toBe(TASKS.length);
    expect(sum(m.byAssignee)).toBe(TASKS.length);
    expect(sum(m.byPriority)).toBe(TASKS.length);
  });
});

describe("isOverdue — injected todayDay, never a live clock (SPEC §1.1 / §3.B.7)", () => {
  it("INSIGHTS_TODAY_DAY is the fixed Jun-16 grid cursor", () => {
    expect(INSIGHTS_TODAY_DAY).toBe(16);
  });

  it("a non-done task due before todayDay is overdue", () => {
    expect(isOverdue(task({ stage: "progress", due: "Jun 10" }), 16)).toBe(true);
    expect(isOverdue(task({ stage: "backlog", due: "Jun 15" }), 16)).toBe(true);
  });

  it("a task due ON or AFTER todayDay is not overdue (strict <)", () => {
    expect(isOverdue(task({ stage: "progress", due: "Jun 16" }), 16)).toBe(false);
    expect(isOverdue(task({ stage: "progress", due: "Jun 20" }), 16)).toBe(false);
  });

  it("a merged/verified task due in the past is NOT overdue (done excluded)", () => {
    expect(isOverdue(task({ stage: "merged", due: "Jun 1" }), 16)).toBe(false);
    expect(isOverdue(task({ stage: "verified", due: "Jun 1" }), 16)).toBe(false);
  });

  it("an undated task (dueDay → null) is never overdue", () => {
    expect(isOverdue(task({ stage: "progress", due: "" }), 16)).toBe(false);
  });

  it("is deterministic under an injected todayDay (no calendar flake)", () => {
    const t = task({ stage: "progress", due: "Jun 10" });
    expect(isOverdue(t, 5)).toBe(false); // grid cursor before the due day
    expect(isOverdue(t, 11)).toBe(true); // grid cursor after it
  });

  it("buildInsights overdue uses the injected todayDay", () => {
    const tasks = mixedTasks();
    // Hand-count: non-done tasks due < 16 are Jun5(urgent/backlog), Jun8(blocked/
    // progress), Jun12(qa). Jun20 + Jul02 are future; merged/verified excluded.
    expect(buildInsights(tasks, 16).overdue).toBe(3);
    // A cursor of day 1 marks nothing overdue (strict <).
    expect(buildInsights(tasks, 1).overdue).toBe(0);
  });
});

describe("click-to-filter contract — every slice.filter selects exactly its tasks (SPEC §3.B.7)", () => {
  it("status/priority/assignee slices: applyFilters(tasks, slice.filter).length === slice.value", () => {
    const tasks = mixedTasks();
    const m = buildInsights(tasks);
    for (const slice of [...m.byStatus, ...m.byPriority, ...m.byAssignee]) {
      expect(slice.filter).not.toBeNull();
      expect(applyFilters(tasks, slice.filter!).length).toBe(slice.value);
    }
  });

  it("the contract holds on the live TASKS fixture too", () => {
    const m = buildInsights(TASKS);
    for (const slice of [...m.byStatus, ...m.byPriority, ...m.byAssignee]) {
      expect(applyFilters(TASKS, slice.filter!).length).toBe(slice.value);
    }
  });

  it("bucket slices NAVIGATE (filter === null), never widen the filter contract", () => {
    const m = buildInsights(mixedTasks());
    expect(m.byBucket.length).toBeGreaterThan(0);
    for (const slice of m.byBucket) {
      expect(slice.filter).toBeNull();
    }
  });

  it("filterForSegment maps each axis to the right facet", () => {
    // status (band) → the band's stages (no synthetic band facet).
    const doingStages = STAGES.filter((s) => s.band === "doing").map((s) => s.key);
    expect(filterForSegment("status", "doing")).toEqual({ stage: doingStages as StageKey[] });
    // priority → [key].
    expect(filterForSegment("priority", "high")).toEqual({ priority: ["high" as PriorityKey] });
    // assignee → [key], including the unassigned sentinel.
    expect(filterForSegment("assignee", "greg")).toEqual({ assignee: ["greg"] });
    expect(filterForSegment("assignee", UNASSIGNED_KEY)).toEqual({ assignee: [UNASSIGNED_KEY] });
  });

  it("the Unassigned assignee slice round-trips through applyFilters", () => {
    const tasks = mixedTasks();
    const m = buildInsights(tasks);
    const unassignedSlice = m.byAssignee.find((s) => s.key === UNASSIGNED_KEY)!;
    expect(applyFilters(tasks, unassignedSlice.filter!).length).toBe(unassignedSlice.value);
    expect(applyFilters(tasks, unassignedSlice.filter!).every((t) => !t.assignee)).toBe(true);
  });
});
