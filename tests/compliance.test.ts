// EN-007 compliance gate — pure-core invariants (P1a). The risk classifier, the
// tier-bundle floor, and the verifier verdicts are the heart of the PR gate, so
// they are tested as pure functions before any DB/route wiring lands (P1b).
import { describe, expect, it } from "vitest";

import type { Evidence, Task } from "@/lib/mc-data";
import {
  bundleRequirementsFor,
  classifyRiskTier,
  evidenceCompleteForTier,
  verifyCompliance,
} from "@/lib/compliance";

const taskish = (over: Partial<Task>): Task => ({
  id: "TASK-X",
  title: "t",
  bucket: "BKT-WMS",
  stage: "progress",
  priority: "medium",
  assignee: "vibes",
  coassignees: [],
  reporter: "vince",
  accountableOwner: "greg",
  reqs: [],
  repos: [],
  estimate: "M",
  labels: [],
  prs: [],
  due: "—",
  sync: { state: "pending", ts: "—", sp: "—" },
  subtasks: [],
  activity: [],
  ...over,
});

const evidence = (over: Partial<Evidence>): Evidence => ({
  summary: "did the thing",
  items: [{ key: "a", label: "a", done: true }],
  ...over,
});

describe("classifyRiskTier (decision 12)", () => {
  it("flags migrations / auth / infra / deploy as high", () => {
    expect(classifyRiskTier(["db/migrations/005_compliance.sql"])).toBe("high");
    expect(classifyRiskTier(["src/lib/auth/session.ts"])).toBe("high");
    expect(classifyRiskTier(["src/server/permissions.ts"])).toBe("high");
    expect(classifyRiskTier(["infra/main.tf"])).toBe("high");
    expect(classifyRiskTier([".github/workflows/ci.yml"])).toBe("high");
    expect(classifyRiskTier(["scripts/deploy.sh"])).toBe("high");
  });

  it("treats docs/test-only changes as low", () => {
    expect(classifyRiskTier(["docs/product/SYSTEM_OF_RECORD.md"])).toBe("low");
    expect(classifyRiskTier(["README.md", "docs/x.md"])).toBe("low");
    expect(classifyRiskTier(["tests/compliance.test.ts"])).toBe("low");
    expect(classifyRiskTier([])).toBe("low");
  });

  it("treats ordinary code changes as standard", () => {
    expect(classifyRiskTier(["src/lib/compliance/verify.ts"])).toBe("standard");
    expect(classifyRiskTier(["src/components/mc/board.tsx", "README.md"])).toBe("standard");
  });

  it("honors explicit label overrides over path heuristics", () => {
    expect(classifyRiskTier(["docs/x.md"], ["risk:high"])).toBe("high");
    expect(classifyRiskTier(["db/migrations/005.sql"], ["risk:low"])).toBe("low");
  });
});

describe("bundleRequirementsFor", () => {
  it("escalates the floor with the tier", () => {
    expect(bundleRequirementsFor("high")).toEqual({ evidence: "full", rollback: true, prd: true });
    expect(bundleRequirementsFor("standard")).toEqual({ evidence: "note", rollback: true, prd: false });
    expect(bundleRequirementsFor("low")).toEqual({ evidence: "minimal", rollback: false, prd: false });
  });
});

describe("evidenceCompleteForTier", () => {
  it("low needs only a non-empty summary", () => {
    expect(evidenceCompleteForTier(evidence({}), "low").ok).toBe(true);
    expect(evidenceCompleteForTier(undefined, "low").ok).toBe(false);
    expect(evidenceCompleteForTier(evidence({ summary: "  " }), "low").ok).toBe(false);
  });

  it("standard needs a complete checklist + rollback note", () => {
    expect(evidenceCompleteForTier(evidence({ rollback: "revert the PR" }), "standard").ok).toBe(true);
    expect(evidenceCompleteForTier(evidence({}), "standard").missing).toContain("a rollback plan");
    const incomplete = evidence({ rollback: "x", items: [{ key: "a", label: "a", done: false }] });
    expect(evidenceCompleteForTier(incomplete, "standard").missing).toContain("a complete evidence checklist");
  });

  it("high additionally needs change-appropriate proof", () => {
    const noProof = evidence({ rollback: "revert" });
    expect(evidenceCompleteForTier(noProof, "high").missing).toContain(
      "change-appropriate proof (screenshots or a test run)"
    );
    const withShots = evidence({ rollback: "revert", shots: [{ label: "ui", cap: "after" }] });
    expect(evidenceCompleteForTier(withShots, "high").ok).toBe(true);
    const withQa = evidence({
      rollback: "revert",
      qa: { pass: 3, fail: 0, total: 3, suite: "vitest", ran: "now", tests: [] },
    });
    expect(evidenceCompleteForTier(withQa, "high").ok).toBe(true);
  });
});

describe("verifyCompliance (decisions 2, 5, 9)", () => {
  it("operator PRs always pass (recorded, ungated) — with or without a task", () => {
    expect(verifyCompliance({ task: null, actor: "operator", tier: "high", bucketHasPrd: false }).verdict).toBe("pass");
    expect(
      verifyCompliance({ task: taskish({}), actor: "operator", tier: "high", bucketHasPrd: false }).verdict
    ).toBe("pass");
  });

  it("an agent PR with no checked-out task is blocked", () => {
    const r = verifyCompliance({ task: null, actor: "agent", tier: "low", bucketHasPrd: false });
    expect(r.verdict).toBe("block");
    expect(r.reasons[0]).toMatch(/no checked-out MC task/);
  });

  it("blocks an agent PR missing a human accountable owner", () => {
    const r = verifyCompliance({
      task: taskish({ accountableOwner: null, evidence: evidence({ rollback: "x" }) }),
      actor: "agent",
      tier: "standard",
      bucketHasPrd: false,
    });
    expect(r.verdict).toBe("block");
    expect(r.reasons.some((x) => /human accountable owner/.test(x))).toBe(true);
  });

  it("passes a standard agent PR with a complete bundle + human owner", () => {
    const r = verifyCompliance({
      task: taskish({ accountableOwner: "greg", evidence: evidence({ rollback: "revert the PR" }) }),
      actor: "agent",
      tier: "standard",
      bucketHasPrd: false,
    });
    expect(r.verdict).toBe("pass");
  });

  it("blocks a high-risk agent PR without a bucket PRD even when evidence is full", () => {
    const full = evidence({ rollback: "revert", shots: [{ label: "ui", cap: "after" }] });
    const r = verifyCompliance({
      task: taskish({ accountableOwner: "greg", evidence: full }),
      actor: "agent",
      tier: "high",
      bucketHasPrd: false,
    });
    expect(r.verdict).toBe("block");
    expect(r.reasons.some((x) => /bucket PRD/.test(x))).toBe(true);
  });

  it("passes a high-risk agent PR with full bundle + PRD + owner", () => {
    const full = evidence({ rollback: "revert", shots: [{ label: "ui", cap: "after" }] });
    const r = verifyCompliance({
      task: taskish({ accountableOwner: "greg", evidence: full }),
      actor: "agent",
      tier: "high",
      bucketHasPrd: true,
    });
    expect(r.verdict).toBe("pass");
  });
});
