// Invariant tests for the Mission Control data layer. These protect behavior
// (sync-count aggregation, confidence derivation, the Petra-domain rule, bucket
// partitioning), not the shape of the mock fixtures.
import { describe, expect, it } from "vitest";

import {
  BUCKETS,
  CURRENT_USER,
  PROJECTS,
  STAGES,
  TASKS,
  bandOf,
  confidenceOf,
  domainOf,
  evidenceComplete,
  isPetraEmail,
  syncCounts,
  tasksForUser,
} from "@/lib/mc-data";
import type { Evidence, Task } from "@/lib/mc-data";

describe("bandOf", () => {
  it("maps every stage to its declared band", () => {
    for (const s of STAGES) {
      expect(bandOf(s.key)).toBe(s.band);
    }
  });

  it("places key lifecycle stages in the right band", () => {
    expect(bandOf("backlog")).toBe("todo");
    expect(bandOf("qa")).toBe("doing");
    expect(bandOf("verified")).toBe("done");
  });
});

describe("bucket partitioning", () => {
  it("assigns every task to a known bucket (no orphans)", () => {
    const known = new Set(BUCKETS.map((b) => b.id));
    for (const t of TASKS) expect(known.has(t.bucket)).toBe(true);
  });
});

describe("project parent (P2)", () => {
  it("every bucket's project (when set) references a known project — no dangling FK", () => {
    const known = new Set(PROJECTS.map((p) => p.id));
    for (const b of BUCKETS) {
      if (b.project) expect(known.has(b.project)).toBe(true);
    }
  });

  it("backfill intent: every seeded go-live bucket rolls up to a project", () => {
    // The P2 migration backfills every existing bucket to PRJ-PORTAL-GOLIVE; the
    // fixture must match so a fresh DB and the migration agree (no orphan bucket).
    for (const b of BUCKETS) expect(b.project).toBeTruthy();
  });
});

describe("evidenceComplete", () => {
  it("is true only when every item is done", () => {
    const all: Evidence = {
      summary: "x",
      items: [
        { key: "a", label: "a", done: true },
        { key: "b", label: "b", done: true },
      ],
    };
    const partial: Evidence = {
      summary: "x",
      items: [
        { key: "a", label: "a", done: true },
        { key: "b", label: "b", done: false },
      ],
    };
    expect(evidenceComplete(all)).toBe(true);
    expect(evidenceComplete(partial)).toBe(false);
    expect(evidenceComplete(undefined)).toBe(false);
  });
});

describe("syncCounts", () => {
  it("aggregates the unprovisioned go-live plan as all-pending, nothing to resolve", () => {
    // 28 go-live items (todos 15 + roadmap 8 + milestones 2 + risks 3) + the 3
    // Repo Registry repos (EN-002 / Item 2), all pending their first push = 31.
    expect(syncCounts()).toEqual({ pending: 31, conflict: 0, error: 0 });
  });

  it("treats conflicts + errors as the 'to resolve' count", () => {
    const c = syncCounts();
    expect(c.conflict + c.error).toBe(0);
  });
});

describe("tasksForUser", () => {
  it("returns only tasks the user owns, co-owns, or reports", () => {
    const mine = tasksForUser("vince");
    expect(mine.length).toBeGreaterThan(0);
    for (const t of mine) {
      const involved =
        t.assignee === "vince" || t.coassignees.includes("vince") || t.reporter === "vince";
      expect(involved).toBe(true);
    }
    expect(mine.map((t) => t.id)).toContain("TASK-221"); // reporter
  });

  it("returns nothing for someone with no involvement", () => {
    expect(tasksForUser("ross")).toHaveLength(0);
  });

  // PR-D1 (My Tasks) membership: the view seeds from tasksForUser, so it must
  // include tasks where the user is the assignee OR a co-assignee (and the
  // reporter), and exclude tasks they have no part in. Synthetic fixture so the
  // three cases are isolated from the shared mock data.
  it("includes assignee, co-assignee, and reporter tasks; excludes the rest", () => {
    const base = TASKS[0];
    const fixture: Task[] = [
      { ...base, id: "MINE-ASG", assignee: "vince", coassignees: [], reporter: "greg" },
      { ...base, id: "MINE-CO", assignee: "greg", coassignees: ["vince"], reporter: "greg" },
      { ...base, id: "MINE-REP", assignee: "greg", coassignees: [], reporter: "vince" },
      { ...base, id: "NOT-MINE", assignee: "greg", coassignees: ["ross"], reporter: "greg" },
    ];
    const mine = tasksForUser("vince", fixture).map((t) => t.id);
    expect(mine).toEqual(["MINE-ASG", "MINE-CO", "MINE-REP"]);
    expect(mine).not.toContain("NOT-MINE");
  });

  // My Tasks is cross-bucket BY DEFINITION (SPEC §5 D1): the seed must span
  // every initiative the user is involved in, never one bucket. This pins the
  // composition-precedence rule — the mine-seed replaces the bucket base, so a
  // single-bucket filter on top would wrongly drop the user's other tasks.
  it("seeds My Tasks across multiple buckets (cross-bucket, not one initiative)", () => {
    const mineBuckets = new Set(
      tasksForUser(CURRENT_USER, TASKS).map((t) => t.bucket)
    );
    expect(mineBuckets.size).toBeGreaterThan(1);
  });

  it("ignores bucket scoping — every involved task is returned regardless of bucket", () => {
    const base = TASKS[0];
    const fixture: Task[] = [
      { ...base, id: "B1", assignee: "vince", bucket: "BKT-WMS" },
      { ...base, id: "B2", assignee: "vince", bucket: "BKT-DAPI" },
    ];
    const ids = tasksForUser("vince", fixture).map((t) => t.id);
    expect(ids).toEqual(["B1", "B2"]); // both buckets present, none filtered out
  });
});

describe("confidenceOf", () => {
  const byId = (id: string) => TASKS.find((t) => t.id === id)!;

  it("flags blocked tasks", () => {
    expect(confidenceOf({ ...byId("TASK-221"), blocked: true }).state).toBe("blocked");
  });

  it("treats verified/merged as ready at 100%", () => {
    const c = confidenceOf({ ...byId("TASK-221"), stage: "verified" });
    expect(c.state).toBe("ready");
    expect(c.pct).toBe(100);
  });

  it("shows an evidence gap in QA/review with the right ratio", () => {
    const c = confidenceOf(byId("TASK-227")); // qa, 0/4 done
    expect(c.state).toBe("gap");
    expect(c.label).toBe("0/4 evidence");
    expect(c.pct).toBe(0);
  });

  it("reads as building/planned before the doing band", () => {
    expect(confidenceOf({ ...byId("TASK-221"), stage: "progress" }).state).toBe("building");
    expect(confidenceOf(byId("TASK-225")).label).toBe("Planned"); // backlog, no evidence
  });
});

describe("Petra domain rule", () => {
  it("accepts both Petra domains, case-insensitively", () => {
    expect(isPetraEmail("team@petralabx.com")).toBe(true);
    expect(isPetraEmail("Ross.Pennino@PETRASOAP.COM")).toBe(true);
  });

  it("rejects external domains and malformed input", () => {
    expect(isPetraEmail("someone@gmail.com")).toBe(false);
    expect(isPetraEmail("a@petralabx.org")).toBe(false);
    expect(isPetraEmail("petralabx.com")).toBe(false);
    expect(isPetraEmail("")).toBe(false);
  });

  it("extracts a lowercased domain", () => {
    expect(domainOf("Ross.Pennino@PetraSoap.com")).toBe("petrasoap.com");
  });
});
