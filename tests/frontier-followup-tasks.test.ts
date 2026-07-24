// Frontier follow-up task definitions (post-PR-#160 operational activation):
// structural contract so the submission script can never post malformed tasks.

import { describe, expect, it } from "vitest";

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain .mjs ops script, no type declarations.
import { FOLLOWUP_TASKS } from "../scripts/create-frontier-followup-tasks.mjs";

const FRONTIER_BUCKETS = [
  "BKT-FRONTIER-P1-IDENTITY",
  "BKT-FRONTIER-P2-RELIABILITY",
  "BKT-FRONTIER-P3-FRESHNESS",
  "BKT-FRONTIER-P4-HITL",
  "BKT-FRONTIER-P5-EVAL-LOOP",
];

interface FollowupTask {
  bucket: string;
  title: string;
  priority: string;
  description: string;
}

describe("frontier follow-up task definitions", () => {
  const tasks = FOLLOWUP_TASKS as FollowupTask[];

  it("every task targets a frontier bucket and carries a done-when criterion", () => {
    expect(tasks.length).toBeGreaterThan(0);
    for (const task of tasks) {
      expect(FRONTIER_BUCKETS).toContain(task.bucket);
      expect(task.title.length).toBeGreaterThan(10);
      expect(task.description).toContain("Done-when:");
      expect(["urgent", "high", "medium", "low"]).toContain(task.priority);
    }
  });

  it("titles are unique within their bucket (the idempotency key)", () => {
    const keys = tasks.map((t) => `${t.bucket}:${t.title.toLowerCase()}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("covers the activation follow-ups for phases 1, 2, 3 and 5", () => {
    const buckets = new Set(tasks.map((t) => t.bucket));
    expect(buckets).toContain("BKT-FRONTIER-P1-IDENTITY");
    expect(buckets).toContain("BKT-FRONTIER-P2-RELIABILITY");
    expect(buckets).toContain("BKT-FRONTIER-P3-FRESHNESS");
    expect(buckets).toContain("BKT-FRONTIER-P5-EVAL-LOOP");
  });
});
