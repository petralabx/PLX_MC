// P3: metadata-only evidence normalization — never persists raw PR body.

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  normalizeRoutingEvidence,
  type RoutingEvidenceInput,
} from "@/lib/routing/evidence";

const SECRET_BODY = [
  "Implements fleet routing.",
  "MC-Task: TASK-297",
  "MC-Routing: rtx_abc123",
  "DO_NOT_PERSIST: super-secret-token",
].join("\n");

function baseInput(overrides: Partial<RoutingEvidenceInput> = {}): RoutingEvidenceInput {
  return {
    repoId: "123456",
    repoFullName: "petralabx/PLX_MC",
    changeId: "112",
    headSha: "abc123def456",
    baseBranch: "main",
    sourceBranch: "feat/TASK-297-routing",
    title: "  Fix   sparse   PR   creation  ",
    body: SECRET_BODY,
    changedPaths: [
      "src/lib/routing/engine.ts",
      "/src/lib/routing/engine.ts",
      "src/lib/routing/engine.ts",
      "docs/modules/routing/README.md",
    ],
    labels: [" Routing ", "routing", "INFRA", ""],
    actorId: "user-1",
    actorKind: "human",
    eventSource: "pull_request",
    eventAction: "opened",
    eventAt: "2026-07-14T18:00:00.000Z",
    ...overrides,
  };
}

describe("normalizeRoutingEvidence", () => {
  it("normalizes title, paths, labels, and markers without retaining raw body", () => {
    const result = normalizeRoutingEvidence(baseInput());

    expect(result.evidence.title).toBe("Fix sparse PR creation");
    expect(result.evidence.changedPaths).toEqual([
      "src/lib/routing/engine.ts",
      "docs/modules/routing/README.md",
    ]);
    expect(result.evidence.pathCount).toBe(2);
    expect(result.evidence.labels).toEqual(["routing", "infra"]);
    expect(result.evidence.branch).toBe("feat/TASK-297-routing");
    expect(result.evidence.sourceBranch).toBe("feat/TASK-297-routing");
    expect(result.evidence.bodyContentHash).toBe(
      createHash("sha256").update(SECRET_BODY, "utf8").digest("hex")
    );

    expect(result.markers.ok).toBe(true);
    expect(result.markers.taskIds).toEqual(["TASK-297"]);
    expect(result.markers.routingSessionIds).toEqual(["rtx_abc123"]);
    expect(result.branchTaskIds).toEqual(["TASK-297"]);

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("DO_NOT_PERSIST");
    expect(serialized).not.toContain("super-secret-token");
    expect(serialized).not.toContain(SECRET_BODY);
    expect(result).not.toHaveProperty("body");
    expect(result.evidence).not.toHaveProperty("body");
  });

  it("hashes empty body stably and rejects oversized body markers fail-closed", () => {
    const empty = normalizeRoutingEvidence(baseInput({ body: "" }));
    expect(empty.evidence.bodyContentHash).toBe(
      createHash("sha256").update("", "utf8").digest("hex")
    );
    expect(empty.markers.ok).toBe(true);
    expect(empty.markers.markers).toEqual([]);

    const oversized = "x".repeat(256 * 1024 + 1);
    const big = normalizeRoutingEvidence(baseInput({ body: oversized }));
    expect(big.markers.ok).toBe(false);
    expect(big.markers.rejection).toBe("oversized");
    expect(JSON.stringify(big)).not.toContain(oversized.slice(0, 64));
  });

  it("extracts branch Task IDs without treating them as mutation authority", () => {
    const result = normalizeRoutingEvidence(
      baseInput({
        body: "no markers here",
        sourceBranch: "fix/task-12-and-TASK-99",
      })
    );
    expect(result.markers.taskIds).toEqual([]);
    expect(result.branchTaskIds).toEqual(["TASK-12", "TASK-99"]);
  });
});
