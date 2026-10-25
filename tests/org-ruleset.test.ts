// TASK-3901: one org ruleset for every petralabx repo. Keep it on every repo's
// default branch, free of bypass actors and merge-commit only, and keep phase 2
// phase 1 plus the shared checks, the org-wide merge-hold and the merge queue.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface Ruleset {
  target: string;
  enforcement: string;
  bypass_actors: unknown[];
  conditions: { ref_name: { include: string[] }; repository_name: { include: string[]; exclude: string[] } };
  rules: { type: string; parameters?: Record<string, unknown> }[];
}

const load = (name: string): Ruleset => JSON.parse(readFileSync(`config/github/${name}`, "utf8"));
const phase1 = load("petralabx-default-branch.phase1.json");
const phase2 = load("petralabx-default-branch.phase2.json");
const params = (rs: Ruleset, type: string) => rs.rules.find((r) => r.type === type)?.parameters ?? {};

describe("org ruleset (TASK-3901)", () => {
  it.each([
    ["phase 1", phase1],
    ["phase 2", phase2],
  ])("%s covers every repo's default branch with no bypass", (_, rs) => {
    expect(rs.target).toBe("branch");
    expect(rs.enforcement).toBe("active");
    expect(rs.bypass_actors).toEqual([]);
    expect(rs.conditions.ref_name.include).toEqual(["~DEFAULT_BRANCH"]);
    expect(rs.conditions.repository_name).toMatchObject({ include: ["~ALL"], exclude: [] });
    expect(rs.rules.map((r) => r.type)).toEqual(expect.arrayContaining(["deletion", "non_fast_forward"]));
    expect(params(rs, "pull_request")).toMatchObject({ required_approving_review_count: 0, allowed_merge_methods: ["merge"] });
    expect(params(rs, "workflows").workflows).toContainEqual({
      repository_id: 1265176198,
      path: ".github/workflows/compliance-gate.yml",
      ref: "refs/heads/main",
    });
  });

  it("phase 2 is phase 1 plus the shared checks, org merge-hold and the merge queue", () => {
    expect(phase2.rules.map((r) => r.type)).toEqual([
      ...phase1.rules.map((r) => r.type),
      "required_status_checks",
      "merge_queue",
    ]);
    const checks = params(phase2, "required_status_checks").required_status_checks as { context: string }[];
    expect(checks.map((c) => c.context)).toEqual(["ci", "ai-review/verdict"]);
    const workflows = params(phase2, "workflows").workflows as { path: string }[];
    expect(workflows.map((w) => w.path)).toEqual([".github/workflows/compliance-gate.yml", ".github/workflows/org-merge-hold.yml"]);
    expect(params(phase2, "merge_queue")).toMatchObject({ merge_method: "MERGE", grouping_strategy: "ALLGREEN" });
  });
});
