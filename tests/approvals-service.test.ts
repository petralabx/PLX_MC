// TASK-629/630 — approvals service: gate lifecycle, audit events, separation
// of duties, and the pending-approvals inbox source.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/route";
import type { ApprovalGate, Task } from "@/lib/mc-data";

const h = vi.hoisted(() => ({
  tasks: new Map<string, Record<string, unknown>>(),
  patches: [] as { id: string; patch: Record<string, unknown>; actor: string }[],
  events: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/sync", () => ({
  patchTask: async (id: string, patch: Record<string, unknown>, actor: string) => {
    const row = h.tasks.get(id);
    if (!row) return null;
    h.patches.push({ id, patch, actor });
    const { activityLine: _activity, ...dataPatch } = patch;
    row.data = { ...(row.data as Record<string, unknown>), ...dataPatch };
    return row.data;
  },
}));

vi.mock("@/lib/sync/repo", () => ({
  getEntity: async (_type: string, id: string) => h.tasks.get(id) ?? null,
  getEntities: async () => [...h.tasks.values()],
}));

vi.mock("@/lib/compliance/repo", () => ({
  appendEvent: async (e: Record<string, unknown>) => {
    h.events.push(e);
  },
}));

import {
  decideApprovalGate,
  listPendingApprovals,
  requestApprovalGate,
} from "@/lib/compliance/approvals";

function seedTask(id: string, over: Partial<Task> = {}): void {
  h.tasks.set(id, {
    entity_type: "task",
    id,
    data: { id, title: `Task ${id}`, stage: "progress", approvalGates: [], ...over },
  });
}

beforeEach(() => {
  h.tasks.clear();
  h.patches.length = 0;
  h.events.length = 0;
});

describe("requestApprovalGate", () => {
  it("mints a pending apg_* gate and appends approval.requested", async () => {
    seedTask("TASK-700");
    const { gate } = await requestApprovalGate({
      taskId: "TASK-700",
      reason: "prod deploy needs a human",
      requestedBy: "vince@petrasoap.com",
      runtime: "claude-code",
    });
    expect(gate.id).toMatch(/^apg_/);
    expect(gate.status).toBe("pending");
    expect(h.patches[0]?.patch.approvalGates).toEqual([gate]);
    expect(h.events[0]).toMatchObject({
      kind: "approval.requested",
      actor: "vince@petrasoap.com",
      taskId: "TASK-700",
    });
  });

  it("404s an unknown task", async () => {
    await expect(
      requestApprovalGate({ taskId: "TASK-999", reason: "x", requestedBy: "a@b.c" })
    ).rejects.toMatchObject({ code: "not_found", status: 404 });
  });
});

describe("decideApprovalGate", () => {
  const pending: ApprovalGate = {
    id: "apg_1",
    reason: "deploy?",
    requestedBy: "vince@petrasoap.com",
    requestedAt: "2026-07-23T00:00:00Z",
    status: "pending",
  };

  it("approves with a different human and appends approval.decided", async () => {
    seedTask("TASK-700", { approvalGates: [pending] });
    const { gate } = await decideApprovalGate({
      taskId: "TASK-700",
      gateId: "apg_1",
      decision: "approved",
      decidedBy: "greg@petrasoap.com",
      note: "ship it",
    });
    expect(gate).toMatchObject({
      status: "approved",
      decidedBy: "greg@petrasoap.com",
      note: "ship it",
    });
    expect(h.events[0]).toMatchObject({
      kind: "approval.decided",
      actor: "greg@petrasoap.com",
      taskId: "TASK-700",
    });
    expect((h.events[0].payload as Record<string, unknown>).requestedBy).toBe(
      "vince@petrasoap.com"
    );
  });

  it("separation of duties: requester deciding own gate is 403", async () => {
    seedTask("TASK-700", { approvalGates: [pending] });
    await expect(
      decideApprovalGate({
        taskId: "TASK-700",
        gateId: "apg_1",
        decision: "approved",
        decidedBy: "vince@petrasoap.com",
      })
    ).rejects.toMatchObject({ code: "separation_of_duties", status: 403 });
    expect(h.events).toHaveLength(0);
  });

  it("an already-decided gate is a 409, not a silent overwrite", async () => {
    seedTask("TASK-700", {
      approvalGates: [{ ...pending, status: "approved", decidedBy: "greg@petrasoap.com" }],
    });
    await expect(
      decideApprovalGate({
        taskId: "TASK-700",
        gateId: "apg_1",
        decision: "rejected",
        decidedBy: "sam@petrasoap.com",
      })
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("404s an unknown gate", async () => {
    seedTask("TASK-700");
    await expect(
      decideApprovalGate({
        taskId: "TASK-700",
        gateId: "apg_nope",
        decision: "approved",
        decidedBy: "greg@petrasoap.com",
      })
    ).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("listPendingApprovals", () => {
  it("returns only pending gates, oldest first", async () => {
    seedTask("TASK-1", {
      approvalGates: [
        { id: "apg_a", reason: "later", requestedBy: "x", requestedAt: "2026-07-23T02:00:00Z", status: "pending" },
      ],
    });
    seedTask("TASK-2", {
      approvalGates: [
        { id: "apg_b", reason: "earlier", requestedBy: "x", requestedAt: "2026-07-23T01:00:00Z", status: "pending" },
        { id: "apg_c", reason: "done", requestedBy: "x", requestedAt: "2026-07-23T00:00:00Z", status: "approved" },
      ],
    });
    const rows = await listPendingApprovals();
    expect(rows.map((r) => r.gate.id)).toEqual(["apg_b", "apg_a"]);
    expect(rows[0]).toMatchObject({ taskId: "TASK-2", stage: "progress" });
  });
});
