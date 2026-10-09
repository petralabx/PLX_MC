// TASK-629/630 — runtime approval gates: input-required stage freeze,
// separation of duties, and the approval capability wiring.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { authorize } from "@/lib/permissions";
import {
  APPROVAL_WAIT_MAX_MS,
  inputRequired,
  pendingApprovalGates,
  stageAdvanceViolation,
} from "@/lib/mc-data/policy";
import {
  decideApprovalGate,
  getApprovalGateState,
  listPendingApprovals,
  separationOfDutiesViolation,
} from "@/lib/compliance/approvals";
import { complete } from "@/lib/compliance/service";
import type { ApprovalGate } from "@/lib/mc-data";
import {
  actionGetApprovalGate,
  actionRequestApproval,
  approvalProposalSchema,
  getApprovalGateSchema,
  PROPOSAL_MAX_BYTES,
  requestApprovalSchema,
} from "@/lib/mcp/approval-actions";
import type { McpIdentity } from "@/lib/mcp/auth";
import { actionGetContext } from "@/lib/mcp/actions";
import { actionGetTask, checkoutRef } from "@/lib/mcp/read-actions";

// In-memory seams (same technique as tests/compliance-server.test.ts): the real
// approvals/service/action code runs; only persistence is faked.
const mem = vi.hoisted(() => ({
  tasks: new Map<string, Record<string, unknown>>(),
  dispatches: new Map<string, Record<string, unknown>>(),
  events: [] as { kind: string; payload?: Record<string, unknown> }[],
  /** Runs after each getDispatch read: lets a test change the lease between two reads. */
  afterGetDispatch: undefined as undefined | ((reads: number) => void),
  dispatchReads: 0,
}));

vi.mock("@/lib/sync/repo", () => ({
  getEntity: async (_t: string, id: string) =>
    mem.tasks.has(id) ? { id, data: mem.tasks.get(id) } : null,
  getEntities: async () => [...mem.tasks.values()].map((data) => ({ id: data.id, data })),
}));
vi.mock("@/lib/sync", () => ({
  snapshot: async () => ({
    tasks: [...mem.tasks.values()],
    projects: [],
    buckets: [],
    conflicts: [],
    errors: [],
    lastSweep: null,
  }),
  patchTask: async (id: string, patch: Record<string, unknown>) => {
    const next = { ...mem.tasks.get(id), ...patch };
    delete next.activityLine;
    mem.tasks.set(id, next);
    return next;
  },
}));
vi.mock("@/lib/compliance/repo", () => ({
  appendEvent: async (e: { kind: string; payload?: Record<string, unknown> }) => {
    mem.events.push(e);
    return "1";
  },
  getDispatch: async (id: string) => {
    const d = mem.dispatches.get(id) ?? null;
    const snapshot = d ? { ...d } : null;
    mem.afterGetDispatch?.(++mem.dispatchReads);
    return snapshot;
  },
  eventsForTask: async () => mem.events,
  listDispatches: async () => [],
  blockDispatchOnApproval: async (id: string, gateId: string | null, expected: string | null) => {
    const d = mem.dispatches.get(id);
    if (!d || d.releasedAt || d.revoked || (d.approvalGateId ?? null) !== expected) return false;
    d.approvalGateId = gateId;
    return true;
  },
}));
vi.mock("@/lib/permissions/project-acl-guard", () => ({
  assertTaskProjectAccess: async () => undefined,
}));

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

// ─── TASK-629 gaps: checkout gate, structured proposal, resume tool ──────────

const IDENTITY: McpIdentity = {
  operatorEmail: "agent-op@petrasoap.com",
  runtime: "claude-code",
  workerId: "w1",
  repo: "petralabx/PLX_MC",
  servicePrincipalId: "sp_mcp_claude_code",
  actor: { kind: "service", id: "sp_mcp_claude_code", status: "active" },
};
// Same allowlisted operator email, different authenticated principal: the header is caller-controlled.
const OTHER_PRINCIPAL: McpIdentity = {
  ...IDENTITY,
  servicePrincipalId: "sp_mcp_cursor",
  actor: { kind: "service", id: "sp_mcp_cursor", status: "active" },
};
const FULL_ID = "dsp_a";
const FULL_REF = checkoutRef(FULL_ID);
const PROPOSAL = {
  summary: "Rotate the staging key",
  action: "run scripts/rotate.sh",
  plan: "1. rotate\n2. verify",
  risk: "medium" as const,
};

function seedCheckout(over: Record<string, unknown> = {}) {
  mem.dispatches.set("dsp_a", {
    id: "dsp_a",
    taskId: "TASK-700",
    runtime: "claude-code",
    repo: "petralabx/PLX_MC",
    revoked: false,
    releasedAt: null,
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    approvalGateId: null,
    ...over,
  });
}

beforeEach(() => {
  mem.tasks.clear();
  mem.dispatches.clear();
  mem.events.length = 0;
  mem.afterGetDispatch = undefined;
  mem.dispatchReads = 0;
  mem.tasks.set("TASK-700", { id: "TASK-700", title: "t", stage: "progress", approvalGates: [] });
  seedCheckout();
});

describe("checkout-level approval gate (TASK-629 gap 1)", () => {
  it("blocks the checkout, freezes the task and stores the structured proposal", async () => {
    const res = await actionRequestApproval(IDENTITY, {
      taskId: "TASK-700",
      reason: "rotate key?",
      checkoutId: "dsp_a",
      proposal: PROPOSAL,
    });
    expect(res).toMatchObject({ checkoutRef: FULL_REF, status: "pending", inputRequired: true });
    expect(mem.dispatches.get("dsp_a")?.approvalGateId).toBe(res.gateId);
    const stored = (mem.tasks.get("TASK-700")!.approvalGates as ApprovalGate[])[0];
    expect(stored.checkoutRef).toBe(FULL_REF);
    expect(stored.requestedByPrincipal).toBe("sp_mcp_claude_code");
    expect(stored.proposal).toEqual(PROPOSAL);
    expect(inputRequired({ approvalGates: [stored] })).toBe(true);
    expect(mem.events.find((e) => e.kind === "approval.requested")?.payload).toMatchObject({
      checkoutRef: FULL_REF,
      hasProposal: true,
    });
  });

  it("a request without checkout or proposal still works (backward compatible)", async () => {
    const res = await actionRequestApproval(IDENTITY, { taskId: "TASK-700", reason: "ok?" });
    expect(res).toMatchObject({ checkoutRef: null, status: "pending", inputRequired: true });
    const stored = (mem.tasks.get("TASK-700")!.approvalGates as ApprovalGate[])[0];
    expect(stored.checkoutRef).toBeUndefined();
    expect(stored.proposal).toBeUndefined();
  });

  it("refuses a released checkout and a checkout bound to another task", async () => {
    seedCheckout({ releasedAt: new Date().toISOString() });
    await expect(
      actionRequestApproval(IDENTITY, { taskId: "TASK-700", reason: "x", checkoutId: "dsp_a" })
    ).rejects.toMatchObject({ code: "invalid_checkout", status: 409 });
    seedCheckout({ taskId: "TASK-999" });
    await expect(
      actionRequestApproval(IDENTITY, { taskId: "TASK-700", reason: "x", checkoutId: "dsp_a" })
    ).rejects.toMatchObject({ code: "checkout_mismatch", status: 409 });
    expect(mem.tasks.get("TASK-700")!.approvalGates).toEqual([]);
  });
});

describe("structured proposal validation (TASK-629 gap 2)", () => {
  it("rejects non-object proposals", () => {
    for (const bad of ["just text", 42, ["a"], null]) {
      expect(requestApprovalSchema.safeParse({ taskId: "T", reason: "r", proposal: bad }).success).toBe(false);
    }
  });

  it("rejects over-cap payloads and unknown fields", () => {
    const over = { summary: "s", diff: "x".repeat(PROPOSAL_MAX_BYTES), plan: "y".repeat(10) };
    const res = approvalProposalSchema.safeParse(over);
    expect(res.success).toBe(false);
    expect(approvalProposalSchema.safeParse({ summary: "s", diff: "x".repeat(PROPOSAL_MAX_BYTES + 1) }).success).toBe(false);
    expect(approvalProposalSchema.safeParse({ summary: "s", extra: 1 }).success).toBe(false);
    expect(approvalProposalSchema.safeParse({ summary: "s", risk: "apocalyptic" }).success).toBe(false);
  });

  it("round-trips a valid payload exactly and keeps reason capped at 500", () => {
    const parsed = requestApprovalSchema.parse({ taskId: "T", reason: "r", proposal: PROPOSAL });
    expect(parsed.proposal).toEqual(PROPOSAL);
    expect(requestApprovalSchema.safeParse({ taskId: "T", reason: "r".repeat(501) }).success).toBe(false);
  });
});

describe("blocked checkout cannot complete (TASK-629 acceptance 3)", () => {
  async function raise() {
    return actionRequestApproval(IDENTITY, {
      taskId: "TASK-700",
      reason: "ship?",
      checkoutId: "dsp_a",
      proposal: PROPOSAL,
    });
  }

  it("refuses with approval_pending while the gate is pending", async () => {
    await raise();
    await expect(complete({ checkoutId: "dsp_a", summary: "done" })).rejects.toMatchObject({
      code: "approval_pending",
      status: 409,
    });
    expect(mem.events.some((e) => e.kind === "task.completed")).toBe(false);
  });

  it("stays refused (approval_rejected) after a rejection", async () => {
    const { gateId } = await raise();
    await decideApprovalGate({ taskId: "TASK-700", gateId, decision: "rejected", decidedBy: "greg@petrasoap.com" });
    await expect(complete({ checkoutId: "dsp_a", summary: "done" })).rejects.toMatchObject({
      code: "approval_rejected",
    });
  });

  it("completes once the gate is approved; unblocked checkouts are unaffected", async () => {
    const { gateId } = await raise();
    await decideApprovalGate({ taskId: "TASK-700", gateId, decision: "approved", decidedBy: "greg@petrasoap.com" });
    await expect(complete({ checkoutId: "dsp_a", summary: "done" })).resolves.toEqual({ ok: true });
    seedCheckout({ id: "dsp_b" });
    mem.dispatches.set("dsp_b", { ...mem.dispatches.get("dsp_a"), id: "dsp_b", approvalGateId: null });
    await expect(complete({ checkoutId: "dsp_b", summary: "done" })).resolves.toEqual({ ok: true });
  });
});

describe("mc_get_approval_gate resume signal (TASK-629 gap 3)", () => {
  async function raise() {
    return actionRequestApproval(IDENTITY, {
      taskId: "TASK-700",
      reason: "ship?",
      checkoutId: "dsp_a",
      proposal: PROPOSAL,
    });
  }

  async function raiseUnchecked() {
    const gateId = "apg_x";
    mem.tasks.set("TASK-700", {
      id: "TASK-700",
      stage: "progress",
      approvalGates: [{ ...gate({ id: gateId }), requestedByPrincipal: IDENTITY.servicePrincipalId }],
    });
    (mem.dispatches.get("dsp_a") as Record<string, unknown>).approvalGateId = gateId;
  }

  it("returns pending, then approved with decider, decidedAt and note", async () => {
    const { gateId } = await raise();
    const pending = await actionGetApprovalGate(IDENTITY, { checkoutId: "dsp_a" });
    expect(pending).toMatchObject({ gateId, status: "pending", decidedBy: null, decidedAt: null, proposal: PROPOSAL });
    await decideApprovalGate({ taskId: "TASK-700", gateId, decision: "approved", decidedBy: "greg@petrasoap.com", note: "go" });
    const approved = await actionGetApprovalGate(IDENTITY, { taskId: "TASK-700" });
    expect(approved).toMatchObject({ status: "approved", decidedBy: "greg@petrasoap.com", note: "go" });
    expect(approved.decidedAt).toEqual(expect.any(String));
  });

  it("reports a rejection", async () => {
    const { gateId } = await raise();
    await decideApprovalGate({ taskId: "TASK-700", gateId, decision: "rejected", decidedBy: "greg@petrasoap.com", note: "no" });
    expect(await actionGetApprovalGate(IDENTITY, { checkoutId: "dsp_a", gateId })).toMatchObject({
      status: "rejected",
      note: "no",
    });
  });

  it("wait returns early on a decision", async () => {
    const { gateId } = await raise();
    setTimeout(() => {
      void decideApprovalGate({ taskId: "TASK-700", gateId, decision: "approved", decidedBy: "greg@petrasoap.com" });
    }, 30);
    const started = Date.now();
    const state = await getApprovalGateState({ taskId: "TASK-700", gateId, waitMs: 5000, pollIntervalMs: 10 });
    expect(state.status).toBe("approved");
    expect(state.timedOut).toBe(false);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("wait never exceeds its cap, however large the request", async () => {
    vi.useFakeTimers();
    try {
      const { gateId } = await raise();
      const t0 = Date.now();
      const p = getApprovalGateState({ taskId: "TASK-700", gateId, waitMs: 10 * 60_000 });
      await vi.advanceTimersByTimeAsync(APPROVAL_WAIT_MAX_MS + 1);
      const state = await p;
      expect(state).toMatchObject({ status: "pending", timedOut: true });
      expect(Date.now() - t0).toBeLessThanOrEqual(APPROVAL_WAIT_MAX_MS + 1);
    } finally {
      vi.useRealTimers();
    }
    expect(getApprovalGateSchema.safeParse({ taskId: "T", waitSeconds: 26 }).success).toBe(false);
    expect(getApprovalGateSchema.safeParse({ taskId: "T", waitSeconds: 25 }).success).toBe(true);
    expect(getApprovalGateSchema.safeParse({ taskId: "T", checkoutId: "d" }).success).toBe(false);
  });

  it("the same operator-email header from a different principal is refused; the original principal reads", async () => {
    await raise();
    await expect(actionGetApprovalGate(OTHER_PRINCIPAL, { checkoutId: "dsp_a" })).rejects.toMatchObject({
      code: "forbidden",
      status: 403,
    });
    await expect(actionGetApprovalGate(OTHER_PRINCIPAL, { taskId: "TASK-700" })).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(OTHER_PRINCIPAL.operatorEmail).toBe(IDENTITY.operatorEmail);
    await expect(actionGetApprovalGate(IDENTITY, { checkoutId: "dsp_a" })).resolves.toMatchObject({
      status: "pending",
    });
  });

  it("a checkout in a repo outside the allowlist is refused", async () => {
    seedCheckout({ repo: "evil/not-allowlisted" });
    await raiseUnchecked();
    await expect(actionGetApprovalGate(IDENTITY, { checkoutId: "dsp_a" })).rejects.toMatchObject({ status: 403 });
  });

  it("reads and requests a checkout created with a Hub repo override", async () => {
    seedCheckout({ repo: "petralabx/plx-customer-portal" });
    const { gateId } = await raise();
    expect(await actionGetApprovalGate(IDENTITY, { checkoutId: "dsp_a" })).toMatchObject({ gateId });
  });

  it("a principal without task.read is refused", async () => {
    await raise();
    const noRead: McpIdentity = {
      ...IDENTITY,
      actor: { kind: "service", id: "sp_unknown", status: "active" },
    };
    await expect(actionGetApprovalGate(noRead, { checkoutId: "dsp_a" })).rejects.toMatchObject({ status: 403 });
  });

  it("404s on a checkout with no gate", async () => {
    await expect(actionGetApprovalGate(IDENTITY, { checkoutId: "dsp_a" })).rejects.toMatchObject({ status: 404 });
  });
});

describe("checkout credential stays out of task-read surfaces (TASK-629 credential boundary)", () => {
  it("the full checkout id is absent from the task, events, responses and every read surface", async () => {
    const res = await actionRequestApproval(IDENTITY, {
      taskId: "TASK-700",
      reason: "ship?",
      checkoutId: FULL_ID,
      proposal: PROPOSAL,
    });
    const decided = await decideApprovalGate({
      taskId: "TASK-700",
      gateId: res.gateId,
      decision: "approved",
      decidedBy: "greg@petrasoap.com",
    });
    const surfaces = {
      request: res,
      storedTask: mem.tasks.get("TASK-700"),
      events: mem.events,
      decide: decided,
      inbox: await listPendingApprovals(),
      gate: await actionGetApprovalGate(IDENTITY, { checkoutId: FULL_ID }),
      gateByTask: await actionGetApprovalGate(IDENTITY, { taskId: "TASK-700" }),
      contextFull: await actionGetContext({ depth: "full", taskIds: ["TASK-700"] }),
      getTask: await actionGetTask(IDENTITY, "TASK-700"),
    };
    for (const [name, value] of Object.entries(surfaces)) {
      expect(JSON.stringify(value), name).not.toContain(FULL_ID);
    }
    expect(surfaces.gate.checkoutRef).toBe(FULL_REF);
    // The binding still works: only mc_dispatch holds it.
    expect(mem.dispatches.get(FULL_ID)?.approvalGateId).toBe(res.gateId);
  });
});

describe("re-blocking a checkout (TASK-629)", () => {
  const raise = () =>
    actionRequestApproval(IDENTITY, { taskId: "TASK-700", reason: "again?", checkoutId: FULL_ID });

  it("refuses a second gate while the checkout's gate is pending (409), keeping one gate", async () => {
    const first = await raise();
    await expect(raise()).rejects.toMatchObject({ code: "approval_pending", status: 409 });
    expect(mem.dispatches.get(FULL_ID)?.approvalGateId).toBe(first.gateId);
    expect(mem.tasks.get("TASK-700")!.approvalGates).toHaveLength(1);
  });

  it("allows superseding a rejected gate; completion then waits on the new one", async () => {
    const first = await raise();
    await decideApprovalGate({ taskId: "TASK-700", gateId: first.gateId, decision: "rejected", decidedBy: "greg@petrasoap.com" });
    const second = await raise();
    expect(mem.dispatches.get(FULL_ID)?.approvalGateId).toBe(second.gateId);
    await expect(complete({ checkoutId: FULL_ID, summary: "done" })).rejects.toMatchObject({ code: "approval_pending" });
  });
});

describe("gate and checkout block are persisted together (TASK-629)", () => {
  it("a checkout released mid-request leaves no gate and no frozen task", async () => {
    // Both validation reads see an active checkout; it is released before the block is recorded.
    mem.afterGetDispatch = (reads) => {
      if (reads === 2) mem.dispatches.get(FULL_ID)!.releasedAt = new Date().toISOString();
    };
    await expect(
      actionRequestApproval(IDENTITY, { taskId: "TASK-700", reason: "x", checkoutId: FULL_ID })
    ).rejects.toMatchObject({ code: "invalid_checkout", status: 409 });
    expect(mem.dispatchReads).toBe(2);
    expect(mem.tasks.get("TASK-700")!.approvalGates).toEqual([]);
    expect(mem.events.some((e) => e.kind === "approval.requested")).toBe(false);
  });

  it("restores the prior block when the task write fails", async () => {
    const sync = await import("@/lib/sync");
    const patch = vi.spyOn(sync, "patchTask").mockRejectedValueOnce(new Error("db down"));
    await expect(
      actionRequestApproval(IDENTITY, { taskId: "TASK-700", reason: "x", checkoutId: FULL_ID })
    ).rejects.toThrow("db down");
    patch.mockRestore();
    expect(mem.dispatches.get(FULL_ID)?.approvalGateId ?? null).toBeNull();
    expect(mem.tasks.get("TASK-700")!.approvalGates).toEqual([]);
  });
});
