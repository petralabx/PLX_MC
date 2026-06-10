import { describe, expect, it } from "vitest";

import { MILESTONES, RISKS, TASKS, TRACE } from "@/lib/mc-data";
import { rollupsForBucket, summarizeTrace } from "@/components/mc/bucket-detail";
import { traceStatusView } from "@/components/mc/traceability";

describe("traceability status mapping", () => {
  it("maps gap rows to GAP tint + flag", () => {
    const gapRow = TRACE.rows.find((row) => row.status === "gap");
    expect(gapRow).toBeDefined();
    if (!gapRow) return;
    const view = traceStatusView(gapRow.status);
    expect(view.rowClass).toBe(" gap");
    expect(view.chipClass).toBe("gapflag");
    expect(view.label).toBe("GAP");
  });

  it("maps satisfied rows to the ok flag", () => {
    const satisfied = TRACE.rows.find((row) => row.status === "satisfied");
    expect(satisfied).toBeDefined();
    if (!satisfied) return;
    const view = traceStatusView(satisfied.status);
    expect(view.rowClass).toBe("");
    expect(view.chipClass).toBe("okflag");
    expect(view.label).toBe("Satisfied");
  });
});

describe("bucket rollups", () => {
  it("filters tasks, milestones, and risks to the selected bucket", () => {
    const cpv2 = rollupsForBucket("BKT-CPV2", TASKS, MILESTONES, RISKS);
    expect(cpv2.tasks.length).toBeGreaterThan(0);
    expect(cpv2.milestones.length).toBeGreaterThan(0);
    expect(cpv2.risks.length).toBeGreaterThan(0);
    expect(cpv2.tasks.every((task) => task.bucket === "BKT-CPV2")).toBe(true);
    expect(cpv2.milestones.every((milestone) => milestone.bucket === "BKT-CPV2")).toBe(true);
    expect(cpv2.risks.every((risk) => risk.bucket === "BKT-CPV2")).toBe(true);
    expect(cpv2.tasks.some((task) => task.id === "TASK-214")).toBe(true);
    expect(cpv2.tasks.some((task) => task.id === "TASK-176")).toBe(false);
  });

  it("does not leak rows from other buckets", () => {
    const mrp = rollupsForBucket("BKT-MRP", TASKS, MILESTONES, RISKS);
    expect(mrp.tasks.some((task) => task.bucket !== "BKT-MRP")).toBe(false);
    expect(mrp.milestones.some((milestone) => milestone.bucket !== "BKT-MRP")).toBe(false);
    expect(mrp.risks.some((risk) => risk.bucket !== "BKT-MRP")).toBe(false);
  });
});

describe("trace summary", () => {
  it("counts satisfied, in-flight, and gap requirements", () => {
    const summary = summarizeTrace(TRACE);
    expect(summary).toEqual({ satisfied: 1, gaps: 1, inFlight: 2 });
  });
});
