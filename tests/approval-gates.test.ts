// TASK-629/630 — runtime approval gates: input-required stage freeze,
// separation of duties, and the approval capability wiring.

import { describe, expect, it } from "vitest";

import { authorize } from "@/lib/permissions";
import {
  inputRequired,
  pendingApprovalGates,
  stageAdvanceViolation,
} from "@/lib/mc-data/policy";
import { separationOfDutiesViolation } from "@/lib/compliance/approvals";
import type { ApprovalGate } from "@/lib/mc-data";

function gate(over: Partial<ApprovalGate> = {}): ApprovalGate {
  return {
    id: "apg_1",
    reason: "deploy to production?",
    requestedBy: "vince@petrasoap.com",
    requestedAt: "2026-07-23T00:00:00Z",
    status: "pending",
    ...over,
  };
}

const baseTask = {
  id: "TASK-700",
  accountableOwner: "vince",
  evidence: undefined,
  assignee: null,
  agentRunApproved: undefined,
};

describe("input-required stage freeze (TASK-629)", () => {
  it("a pending gate freezes the stage in both directions", () => {
    const task = { ...baseTask, approvalGates: [gate()] };
    expect(inputRequired(task)).toBe(true);
    expect(stageAdvanceViolation(task, "qa")).toContain("input-required");
    expect(stageAdvanceViolation(task, "backlog")).toContain("input-required");
  });

  it("decided gates release the freeze", () => {
    const task = {
      ...baseTask,
      approvalGates: [gate({ status: "approved", decidedBy: "greg@petrasoap.com" })],
    };
    expect(inputRequired(task)).toBe(false);
    expect(pendingApprovalGates(task)).toHaveLength(0);
    expect(stageAdvanceViolation(task, "qa")).toBeNull();
  });

  it("tasks without gates are unaffected", () => {
    expect(stageAdvanceViolation({ ...baseTask, approvalGates: undefined }, "qa")).toBeNull();
  });
});

describe("separation of duties (TASK-630)", () => {
  it("the requester cannot decide their own gate (case-insensitive)", () => {
    expect(separationOfDutiesViolation(gate(), "vince@petrasoap.com")).toContain(
      "separation of duties"
    );
    expect(separationOfDutiesViolation(gate(), "VINCE@petrasoap.com ")).toContain(
      "separation of duties"
    );
  });

  it("a different human may decide", () => {
    expect(separationOfDutiesViolation(gate(), "greg@petrasoap.com")).toBeNull();
  });
});

describe("approval capabilities", () => {
  it("MCP agent principals may request but never decide", () => {
    const agent = { kind: "service" as const, id: "sp_mcp_claude_code", status: "active" as const };
    expect(authorize({ actor: agent, capability: "approval.request" }).allowed).toBe(true);
    const decide = authorize({ actor: agent, capability: "approval.decide" });
    expect(decide.allowed).toBe(false);
  });

  it("service principals are context-denied approval.decide even with a rogue grant", () => {
    // Defense in depth: even if a registry mistake granted it, the predicate blocks.
    const decide = authorize({
      actor: { kind: "service", id: "sp_mcp_cursor", status: "active" },
      capability: "approval.decide",
    });
    expect(decide.allowed).toBe(false);
  });

  it("admin/owner humans decide; members do not; humans never request", () => {
    const admin = { kind: "human" as const, id: "u1", role: "admin" as const, status: "active" as const };
    const owner = { kind: "human" as const, id: "u2", role: "owner" as const, status: "active" as const };
    const member = { kind: "human" as const, id: "u3", role: "member" as const, status: "active" as const };
    expect(authorize({ actor: admin, capability: "approval.decide" }).allowed).toBe(true);
    expect(authorize({ actor: owner, capability: "approval.decide" }).allowed).toBe(true);
    expect(authorize({ actor: member, capability: "approval.decide" }).allowed).toBe(false);
    expect(authorize({ actor: admin, capability: "approval.request" }).allowed).toBe(false);
  });
});
