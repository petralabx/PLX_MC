import { describe, expect, it } from "vitest";

import { MILESTONES, RISKS, TASKS, type Trace } from "@/lib/mc-data";
import { rollupsForBucket, summarizeTrace } from "@/components/mc/bucket-detail";
import { traceStatusView } from "@/components/mc/traceability";

// Demo TRACE fixture was purged (rows fill when the first go-live PRD lands),
// so the status/summary invariants are protected with a synthetic matrix.
const SYNTHETIC_TRACE: Trace = {
  bucket: "BKT-PROD",
  rows: [
    { req: "REQ-1", tasks: ["TASK-223"], prs: [], evidence: "complete", test: "4/4", merge: "abc1234", status: "satisfied" },
    { req: "REQ-2", tasks: ["TASK-224"], prs: [], evidence: "partial", test: "in review", merge: "—", status: "in-review" },
    { req: "REQ-3", tasks: ["TASK-227"], prs: [], evidence: "partial", test: "2/4", merge: "—", status: "in-progress" },
    { req: "REQ-4", tasks: [], prs: [], evidence: "incomplete", test: "0/4", merge: "—", status: "gap" },
  ],
};

describe("traceability status mapping", () => {
  it("maps gap rows to GAP tint + flag", () => {
    const view = traceStatusView("gap");
    expect(view.rowClass).toBe(" gap");
    expect(view.chipClass).toBe("gapflag");
    expect(view.label).toBe("GAP");
  });

  it("maps satisfied rows to the ok flag", () => {
    const view = traceStatusView("satisfied");
    expect(view.rowClass).toBe("");
    expect(view.chipClass).toBe("okflag");
    expect(view.label).toBe("Satisfied");
  });
});

describe("bucket rollups", () => {
  it("filters tasks, milestones, and risks to the selected bucket", () => {
    const uat = rollupsForBucket("BKT-UAT", TASKS, MILESTONES, RISKS);
    expect(uat.tasks.length).toBeGreaterThan(0);
    expect(uat.milestones.length).toBeGreaterThan(0);
    expect(uat.risks.length).toBeGreaterThan(0);
    expect(uat.tasks.every((task) => task.bucket === "BKT-UAT")).toBe(true);
    expect(uat.milestones.every((milestone) => milestone.bucket === "BKT-UAT")).toBe(true);
    expect(uat.risks.every((risk) => risk.bucket === "BKT-UAT")).toBe(true);
    expect(uat.tasks.some((task) => task.id === "TASK-234")).toBe(true);
    expect(uat.tasks.some((task) => task.id === "TASK-221")).toBe(false);
  });

  it("does not leak rows from other buckets", () => {
    const fin = rollupsForBucket("BKT-FIN", TASKS, MILESTONES, RISKS);
    expect(fin.tasks.some((task) => task.bucket !== "BKT-FIN")).toBe(false);
    expect(fin.milestones.some((milestone) => milestone.bucket !== "BKT-FIN")).toBe(false);
    expect(fin.risks.some((risk) => risk.bucket !== "BKT-FIN")).toBe(false);
  });
});

describe("trace summary", () => {
  it("counts satisfied, in-flight, and gap requirements", () => {
    expect(summarizeTrace(SYNTHETIC_TRACE)).toEqual({ satisfied: 1, gaps: 1, inFlight: 2 });
  });

  it("returns zeroes for an empty matrix (current go-live state)", () => {
    expect(summarizeTrace({ bucket: "BKT-PROD", rows: [] })).toEqual({
      satisfied: 0,
      gaps: 0,
      inFlight: 0,
    });
  });
});
