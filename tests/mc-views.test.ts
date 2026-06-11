import { describe, expect, it } from "vitest";

import { BANDS, STAGES, TASKS } from "@/lib/mc-data";
import {
  dueDay,
  partitionSwimlanes,
  partitionTasksByColumn,
  spanOf,
  timelineRangeForTask,
} from "@/components/mc/work-views.helpers";

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
    const byStage = partitionTasksByColumn(TASKS, "full");
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
