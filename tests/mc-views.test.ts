import { describe, expect, it } from "vitest";

import { ACTORS, BANDS, BUCKETS, PRIORITY, STAGES, TASKS } from "@/lib/mc-data";
import type { PriorityKey, Task } from "@/lib/mc-data";
import {
  applyFilters,
  assigneeUniverse,
  BAND_ENTRY_STAGE,
  boardColumns,
  columnsFor,
  dragEnabledForAxis,
  dragFieldForAxis,
  dueDay,
  groupTasksForList,
  isNoopDrop,
  labelUniverse,
  partitionSwimlanes,
  partitionTasksByColumn,
  resolveColumnDrop,
  spanOf,
  swimlanesAllowed,
  timelineRangeForTask,
  UNASSIGNED_KEY,
  type GroupBy,
} from "@/components/mc/work-views.helpers";

// Asserts the partition is disjoint (no task in two columns) and complete
// (every task lands in exactly one column) for the given axis.
function expectDisjointComplete(tasks: Task[], groupBy: GroupBy) {
  const byColumn = partitionTasksByColumn(tasks, groupBy);
  const columnKeys = boardColumns(groupBy, tasks).map((c) => c.key);
  expect(Object.keys(byColumn)).toEqual(columnKeys);

  const seen = new Set<string>();
  let count = 0;
  for (const key of columnKeys) {
    for (const task of byColumn[key]) {
      expect(seen.has(task.id)).toBe(false);
      seen.add(task.id);
      count += 1;
    }
  }
  expect(count).toBe(tasks.length);
}

describe("board column partitioning", () => {
  it("places every task in exactly one 3-band column", () => {
    const byBand = partitionTasksByColumn(TASKS, "band");
    const expectedKeys = BANDS.map((band) => band.key);
    expect(Object.keys(byBand)).toEqual(expectedKeys);

    const seen = new Set<string>();
    let count = 0;
    for (const key of expectedKeys) {
      for (const task of byBand[key]) {
        expect(seen.has(task.id)).toBe(false);
        seen.add(task.id);
        count += 1;
      }
    }
    expect(count).toBe(TASKS.length);
  });

  it("places every task in exactly one full-lifecycle stage column", () => {
    const byStage = partitionTasksByColumn(TASKS, "stage");
    const expectedKeys = STAGES.map((stage) => stage.key);
    expect(Object.keys(byStage)).toEqual(expectedKeys);

    const seen = new Set<string>();
    let count = 0;
    for (const key of expectedKeys) {
      for (const task of byStage[key]) {
        expect(seen.has(task.id)).toBe(false);
        seen.add(task.id);
        count += 1;
      }
    }
    expect(count).toBe(TASKS.length);
  });

  it("keeps the partition disjoint + complete for every GroupBy axis", () => {
    for (const axis of ["band", "stage", "bucket", "priority", "assignee"] as const) {
      expectDisjointComplete(TASKS, axis);
    }
  });

  it("orders priority columns by the PRIORITY config order (urgent → low)", () => {
    expect(columnsFor("priority").map((c) => c.key)).toEqual(Object.keys(PRIORITY));
  });

  it("orders bucket columns by the BUCKETS definition order", () => {
    expect(columnsFor("bucket").map((c) => c.key)).toEqual(BUCKETS.map((b) => b.id));
  });

  it("ends the assignee axis with an Unassigned column when an unassigned task exists", () => {
    const tasks: Task[] = [
      { ...TASKS[0], id: "T-A", assignee: "vince" },
      { ...TASKS[0], id: "T-B", assignee: null },
    ];
    const keys = columnsFor("assignee", tasks).map((c) => c.key);
    expect(keys).toEqual(["vince", UNASSIGNED_KEY]);
    expect(keys[keys.length - 1]).toBe(UNASSIGNED_KEY);
  });

  it("omits the Unassigned column when every task has an assignee", () => {
    const tasks: Task[] = [
      { ...TASKS[0], id: "T-A", assignee: "vince" },
      { ...TASKS[0], id: "T-B", assignee: "maya" },
    ];
    const keys = columnsFor("assignee", tasks).map((c) => c.key);
    expect(keys).not.toContain(UNASSIGNED_KEY);
    expect(new Set(keys)).toEqual(new Set(["vince", "maya"]));
  });
});

describe("list grouping reads the unified column model", () => {
  it("renders only non-empty groups for the band axis (the former list 'status')", () => {
    const groups = groupTasksForList(TASKS, "band");
    expect(groups.every((g) => g.list.length > 0)).toBe(true);
    const total = groups.reduce((sum, g) => sum + g.list.length, 0);
    expect(total).toBe(TASKS.length);
  });

  it("groups by bucket with every task accounted for once", () => {
    const groups = groupTasksForList(TASKS, "bucket");
    const seen = new Set<string>();
    for (const group of groups) for (const task of group.list) seen.add(task.id);
    expect(seen.size).toBe(TASKS.length);
  });
});

describe("swimlanes axis gating (SPEC §5 reset)", () => {
  it("allows swimlanes only on the band and stage axes", () => {
    expect(swimlanesAllowed("band")).toBe(true);
    expect(swimlanesAllowed("stage")).toBe(true);
    expect(swimlanesAllowed("bucket")).toBe(false);
    expect(swimlanesAllowed("priority")).toBe(false);
    expect(swimlanesAllowed("assignee")).toBe(false);
  });
});

describe("drag-to-mutate axis → field resolution (Module B)", () => {
  it("enables drag on every Cycle-1 axis (all map to a real field mutation)", () => {
    for (const axis of ["band", "stage", "bucket", "priority", "assignee"] as const) {
      expect(dragEnabledForAxis(axis)).toBe(true);
      expect(dragFieldForAxis(axis)).not.toBeNull();
    }
  });

  it("maps the stage axis: a drop sets stage to the dropped column's stage key", () => {
    const resolved = resolveColumnDrop("stage", "qa");
    expect(resolved).toEqual({ field: "stage", value: "qa" });
    // The board only writes real stage keys; an unknown column is dropped.
    expect(resolveColumnDrop("stage", "not-a-stage")).toBeNull();
  });

  it("maps the band axis to each band's documented ENTRY stage", () => {
    // SPEC §5 Module B: todo→backlog, doing→progress, done→merged.
    expect(BAND_ENTRY_STAGE).toEqual({ todo: "backlog", doing: "progress", done: "merged" });
    expect(resolveColumnDrop("band", "todo")).toEqual({ field: "stage", value: "backlog" });
    expect(resolveColumnDrop("band", "doing")).toEqual({ field: "stage", value: "progress" });
    expect(resolveColumnDrop("band", "done")).toEqual({ field: "stage", value: "merged" });
    // Every entry stage is a real stage key.
    for (const key of Object.values(BAND_ENTRY_STAGE)) {
      expect(STAGES.some((s) => s.key === key)).toBe(true);
    }
    expect(resolveColumnDrop("band", "nope")).toBeNull();
  });

  it("maps the priority axis: a drop sets priority to the dropped column's key", () => {
    for (const key of Object.keys(PRIORITY) as PriorityKey[]) {
      expect(resolveColumnDrop("priority", key)).toEqual({ field: "priority", value: key });
    }
    expect(resolveColumnDrop("priority", "not-a-priority")).toBeNull();
  });

  it("maps the bucket axis: a drop sets bucket to the dropped initiative id", () => {
    const bucketId = BUCKETS[0].id;
    expect(resolveColumnDrop("bucket", bucketId)).toEqual({ field: "bucket", value: bucketId });
    expect(resolveColumnDrop("bucket", "BKT-NOPE")).toBeNull();
  });

  it("maps the assignee axis: an actor column reassigns; the Unassigned column unassigns", () => {
    expect(resolveColumnDrop("assignee", "maya")).toEqual({ field: "assignee", value: "maya" });
    expect(resolveColumnDrop("assignee", UNASSIGNED_KEY)).toEqual({
      field: "assignee",
      value: null,
    });
  });

  it("treats a drop on the card's CURRENT column as a no-op (the same-column guard)", () => {
    const task: Task = { ...TASKS[0], stage: "qa", priority: "high", bucket: "BKT-WMS", assignee: "maya" };
    // Same column on each axis → no-op (would skip the PATCH).
    expect(isNoopDrop(task, "stage", "qa")).toBe(true);
    expect(isNoopDrop(task, "priority", "high")).toBe(true);
    expect(isNoopDrop(task, "bucket", "BKT-WMS")).toBe(true);
    expect(isNoopDrop(task, "assignee", "maya")).toBe(true);
    // The band column the card already sits in (qa → doing) is also a no-op.
    expect(isNoopDrop(task, "band", "doing")).toBe(true);
    // A different column on each axis → not a no-op.
    expect(isNoopDrop(task, "stage", "merged")).toBe(false);
    expect(isNoopDrop(task, "priority", "low")).toBe(false);
    expect(isNoopDrop(task, "assignee", UNASSIGNED_KEY)).toBe(false);
  });

  it("resolves an unassigned card's no-op against the Unassigned column", () => {
    const task: Task = { ...TASKS[0], assignee: null };
    expect(isNoopDrop(task, "assignee", UNASSIGNED_KEY)).toBe(true);
    expect(isNoopDrop(task, "assignee", "maya")).toBe(false);
  });
});

describe("board swimlane partitioning", () => {
  it("keeps agents, humans, and unassigned disjoint and complete", () => {
    const lanes = partitionSwimlanes(TASKS);
    const ids = {
      agents: new Set(lanes.agents.map((task) => task.id)),
      humans: new Set(lanes.humans.map((task) => task.id)),
      unassigned: new Set(lanes.unassigned.map((task) => task.id)),
    };

    for (const id of ids.agents) {
      expect(ids.humans.has(id)).toBe(false);
      expect(ids.unassigned.has(id)).toBe(false);
    }
    for (const id of ids.humans) {
      expect(ids.unassigned.has(id)).toBe(false);
    }

    const total = lanes.agents.length + lanes.humans.length + lanes.unassigned.length;
    expect(total).toBe(TASKS.length);
  });
});

describe("applyFilters truth table", () => {
  const base = TASKS[0];
  const fixture: Task[] = [
    { ...base, id: "F-1", title: "Alpha widget", priority: "urgent", assignee: "vince", stage: "backlog", labels: ["api", "go-live"] },
    { ...base, id: "F-2", title: "Beta service", priority: "low", assignee: "maya", stage: "progress", labels: ["api"] },
    { ...base, id: "F-3", title: "Gamma report", priority: "low", assignee: null, stage: "qa", labels: ["finance"] },
  ];

  it("returns the identity (same array) for an empty filter", () => {
    expect(applyFilters(fixture, {})).toBe(fixture);
    expect(applyFilters(fixture, { text: "  " })).toBe(fixture);
  });

  it("matches text against id, title, and labels (case-insensitive)", () => {
    expect(applyFilters(fixture, { text: "beta" }).map((t) => t.id)).toEqual(["F-2"]);
    expect(applyFilters(fixture, { text: "F-3" }).map((t) => t.id)).toEqual(["F-3"]);
    expect(applyFilters(fixture, { text: "FINANCE" }).map((t) => t.id)).toEqual(["F-3"]);
  });

  it("filters by a single facet (priority OR within the facet)", () => {
    expect(applyFilters(fixture, { priority: ["low"] as PriorityKey[] }).map((t) => t.id)).toEqual([
      "F-2",
      "F-3",
    ]);
    expect(
      applyFilters(fixture, { priority: ["urgent", "low"] as PriorityKey[] }).map((t) => t.id)
    ).toEqual(["F-1", "F-2", "F-3"]);
  });

  it("includes the unassigned sentinel in the assignee facet", () => {
    expect(applyFilters(fixture, { assignee: [UNASSIGNED_KEY] }).map((t) => t.id)).toEqual(["F-3"]);
    expect(applyFilters(fixture, { assignee: ["vince"] }).map((t) => t.id)).toEqual(["F-1"]);
  });

  it("matches a task whose labels intersect the label facet", () => {
    expect(applyFilters(fixture, { label: ["api"] }).map((t) => t.id)).toEqual(["F-1", "F-2"]);
  });

  it("filters by the stage facet", () => {
    expect(applyFilters(fixture, { stage: ["qa"] }).map((t) => t.id)).toEqual(["F-3"]);
  });

  it("AND-combines across facets", () => {
    expect(
      applyFilters(fixture, { priority: ["low"] as PriorityKey[], label: ["api"] }).map((t) => t.id)
    ).toEqual(["F-2"]);
    expect(
      applyFilters(fixture, { priority: ["low"] as PriorityKey[], assignee: [UNASSIGNED_KEY] }).map(
        (t) => t.id
      )
    ).toEqual(["F-3"]);
  });
});

describe("filter option universes", () => {
  const base = TASKS[0];
  const fixture: Task[] = [
    { ...base, id: "U-1", assignee: "maya", labels: ["go-live", "api"] },
    { ...base, id: "U-2", assignee: "vince", labels: ["api"] },
    { ...base, id: "U-3", assignee: null, labels: ["go-live"] },
  ];

  it("dedupes + sorts labels", () => {
    expect(labelUniverse(fixture)).toEqual(["api", "go-live"]);
  });

  it("dedupes assignees in directory order and excludes the unassigned sentinel", () => {
    const ids = assigneeUniverse(fixture);
    expect(ids).not.toContain(UNASSIGNED_KEY);
    expect(new Set(ids)).toEqual(new Set(["maya", "vince"]));
    // Directory order: ACTORS lists maya before vince.
    expect(ids.indexOf("maya")).toBeLessThan(ids.indexOf("vince"));
    // Every returned id is a known actor.
    for (const id of ids) expect(id in ACTORS).toBe(true);
  });
});

describe("timeline math helpers", () => {
  it("parses due day and estimate span", () => {
    expect(dueDay("Jun 16")).toBe(16);
    expect(dueDay("—")).toBeNull();
    expect(spanOf("S")).toBe(4);
    expect(spanOf("M")).toBe(7);
    expect(spanOf("L")).toBe(11);
  });

  it("uses fallback due day when no due is present", () => {
    const range = timelineRangeForTask("—", "M");
    expect(range.startDay).toBe(17);
    expect(range.endDay).toBe(24);
  });

  it("clamps out-of-window days to a zero-width pin at the grid edge", () => {
    const late = timelineRangeForTask("Jun 42", "L");
    expect(late.endDay).toBe(30);
    expect(late.startDay).toBe(30);
    expect(late.widthPct).toBe(0);

    const early = timelineRangeForTask("Jun 0", "L");
    expect(early.endDay).toBe(1);
    expect(early.startDay).toBe(1);
    expect(early.widthPct).toBe(0);
  });

  it("maps non-June dues beyond the June grid, never onto a June day", () => {
    expect(dueDay("Jul 20")).toBe(50);
    expect(dueDay("Sep 01")).toBe(93);
    expect(dueDay("May 30")).toBe(-1);

    // A July due must not draw a bar inside the June window (go-live plan).
    const july = timelineRangeForTask("Jul 20", "M");
    expect(july.endDay).toBe(30);
    expect(july.widthPct).toBe(0);
  });
});
