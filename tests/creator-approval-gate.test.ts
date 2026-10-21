// TASK-3530 — the creator-principal approval gate. A task created by a gated
// principal (sp_mcp_workbench_intake) cannot be checked out, launched or moved
// into progress until vince@ or cos@ approves it through the creator-approval
// action. The repo seams are in-memory; patchTask, checkout(), actionCheckout,
// the approvals service and the projection run for real.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Task } from "@/lib/mc-data";
import type { McpIdentity } from "@/lib/mcp/auth";

const db = vi.hoisted(() => ({
  tasks: new Map<string, Record<string, unknown>>(),
  events: [] as { kind: string; actor: string; taskId?: string | null; payload?: Record<string, unknown> }[],
  dispatches: [] as { id: string; taskId: string; launchId?: string | null }[],
  created: [] as Record<string, unknown>[],
  session: { oid: "", email: "" },
}));

vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  withTransaction: async <T,>(fn: (q: never) => Promise<T>) => fn((async () => []) as never),
}));

vi.mock("@/lib/sync/engine", () => ({
  ensureSeeded: async () => true,
  ensureReposSeeded: async () => true,
  ensureBucketsSeeded: async () => true,
  ensureProjectsSeeded: async () => true,
}));

vi.mock("@/lib/sync/repo", () => ({
  stamp: () => "2026.10.21 · 00:00",
  async getRepos() { return []; },
  async getBuckets() { return []; },
  async getProjects() { return []; },
  async getRegisterInboundCompletions() { return []; },
  async getEntity(type: string, id: string) {
    const data = db.tasks.get(id);
    return data ? { entity_type: type, id, data, sync_state: "synced", sp_item_id: null, dirty_fields: [] } : null;
  },
  async updateEntity(_type: string, id: string, opts: { patch?: Record<string, unknown> }) {
    const data = db.tasks.get(id);
    if (data) db.tasks.set(id, { ...data, ...(opts.patch ?? {}) });
  },
  async appendAudit() {},
}));

vi.mock("@/lib/compliance/repo", () => ({
  async appendEvent(e: (typeof db.events)[number]) {
    db.events.push(e);
    return String(db.events.length);
  },
  async liveDispatchesForTask() { return []; },
  async insertDispatch(d: (typeof db.dispatches)[number]) { db.dispatches.push(d); },
  async getDispatchCheckoutAgent() { return null; },
}));

vi.mock("@/lib/sync", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sync")>()),
  // Task-id allocation and the insert need Postgres; capture the input instead.
  async createTask(input: Record<string, unknown>) {
    db.created.push(input);
    return { id: "TASK-9001", ...input } as unknown as Task;
  },
}));

vi.mock("@/lib/permissions/project-acl-guard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/permissions/project-acl-guard")>()),
  assertTaskProjectAccess: async () => undefined,
  assertBucketProjectAccess: async () => undefined,
  assertProjectIdAccess: async () => undefined,
  isBucketInRestrictedProject: async () => false,
}));

vi.mock("@/lib/routing/mutations/actors", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/routing/mutations/actors")>()),
  requireMcpActor: (identity: McpIdentity) => ({ actor: identity.actor, actorId: identity.servicePrincipalId }),
  aclPrincipalFromMcp: () => ({ tokens: [] }),
  requireSessionActor: async () => ({ actorId: db.session.oid, auditLabel: db.session.email }),
}));

vi.mock("@/lib/mcp/sync-meta", () => ({ syncMetaForTask: async () => ({ status: "queued" }) }));

vi.mock("@/lib/api/route", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/route")>()),
  route: (handler: unknown) => handler,
}));

import { approveCreatorApproval, decideApprovalGate } from "@/lib/compliance/approvals";
import { projectPullRequest } from "@/lib/compliance/projection";
import { checkout } from "@/lib/compliance/service";
import { stageAdvanceViolation } from "@/lib/mc-data/policy";
import { actionCheckout, actionCreateTask } from "@/lib/mcp/actions";
import { actionUpdateTask } from "@/lib/mcp/task-update-actions";
import { isCreatorApprovalGated, isCreatorApprover } from "@/lib/permissions";
import { patchTask } from "@/lib/sync/state";
import { POST as approveRoute } from "@/app/api/tasks/[id]/creator-approval/route";

const VINCE_OID = "29e05178-0bd1-49b9-be6e-b01be1975f70";
const COS_OID = "a3d74eb5-f230-4335-a852-15fa2d7021b6";
const OTHER_OID = "11111111-2222-3333-4444-555555555555";

function identity(principal: string): McpIdentity {
  return {
    operatorEmail: "vince@petrasoap.com",
    runtime: "claude",
    workerId: "w1",
    repo: "petralabx/PLX_MC",
    agent: "claude/claude-cli",
    servicePrincipalId: principal,
    actor: { kind: "service", id: principal, status: "active" },
  } as unknown as McpIdentity;
}
const intake = identity("sp_mcp_workbench_intake");
const agent = identity("sp_mcp_claude_code");

function seed(id: string, over: Partial<Task> = {}): void {
  db.tasks.set(id, {
    id,
    title: "intake task",
    description: "",
    bucket: "BKT-INFRA",
    stage: "planned",
    priority: "medium",
    assignee: null,
    coassignees: [],
    reporter: "vince",
    accountableOwner: "vince",
    reqs: [],
    repos: [],
    estimate: "M",
    labels: [],
    prs: [],
    due: "—",
    sync: { state: "synced", ts: "—", sp: "—" },
    subtasks: [],
    activity: [],
    ...over,
  });
}
const pending = { principal: "sp_mcp_workbench_intake", status: "pending" as const, requestedAt: "2026-10-21T12:00:00.000Z" };
const gated = (over: Partial<Task> = {}) => seed("TASK-1", { creatorApproval: pending, ...over });
const task = (id = "TASK-1") => db.tasks.get(id) as unknown as Task;
const checkoutInput = (over: Record<string, unknown> = {}) => ({
  taskId: "TASK-1",
  runtime: "claude",
  accountableHuman: "vince@petrasoap.com",
  repo: "petralabx/PLX_MC",
  actor: agent.actor,
  door: "mcp" as const,
  ...over,
});
const blocked = () => db.events.filter((e) => e.kind === "creator_approval.blocked");

beforeEach(() => {
  db.tasks.clear();
  db.events.length = 0;
  db.dispatches.length = 0;
  db.created.length = 0;
  db.session = { oid: "", email: "" };
});
afterEach(() => {
  delete process.env.PLX_MC_LAUNCHER_PRINCIPALS;
});

describe("creator approval registry (grants.ts)", () => {
  it("gates sp_mcp_workbench_intake and no other principal", () => {
    expect(isCreatorApprovalGated("sp_mcp_workbench_intake")).toBe(true);
    expect(isCreatorApprovalGated("sp_mcp_claude_code")).toBe(false);
    expect(isCreatorApprovalGated("sp_mcp_portal")).toBe(false);
    expect(isCreatorApprovalGated(undefined)).toBe(false);
  });

  it("names exactly vince@ and cos@ as approvers, by Entra object id", () => {
    expect(isCreatorApprover(VINCE_OID)).toBe(true);
    expect(isCreatorApprover(COS_OID)).toBe(true);
    expect(isCreatorApprover(OTHER_OID)).toBe(false);
    expect(isCreatorApprover("vince@petrasoap.com")).toBe(false);
    expect(isCreatorApprover("")).toBe(false);
  });
});

describe("task create", () => {
  const input = { title: "intake", bucket: "BKT-INFRA", description: "Do the thing.", reporter: "ignored" };

  it("records the creator principal and a pending approval for a gated principal", async () => {
    await actionCreateTask(intake, input);
    expect(db.created[0].creatorApproval).toMatchObject({ principal: "sp_mcp_workbench_intake", status: "pending" });
  });

  it("ignores a caller-supplied creatorApproval", async () => {
    const forged = { ...input, creatorApproval: { principal: "x", status: "approved" } };
    await actionCreateTask(intake, forged as never);
    expect(db.created[0].creatorApproval).toMatchObject({ principal: "sp_mcp_workbench_intake", status: "pending" });
    await actionCreateTask(agent, forged as never);
    expect(db.created[1].creatorApproval).toBeUndefined();
  });

  it("refuses a gated create straight into progress, and allows planned", async () => {
    await expect(actionCreateTask(intake, { ...input, stage: "progress" })).rejects.toMatchObject({ code: "creator_approval_pending" });
    expect(db.created).toHaveLength(0);
    await actionCreateTask(intake, { ...input, stage: "planned" });
    expect(db.created).toHaveLength(1);
  });

  it("leaves a non-gated principal's task without a creator approval", async () => {
    await actionCreateTask(agent, { ...input, stage: "progress" });
    expect(db.created[0].creatorApproval).toBeUndefined();
  });
});

describe("while creator approval is pending", () => {
  beforeEach(() => gated());

  it("checkout() refuses with an audit event and mints no checkout", async () => {
    await expect(checkout(checkoutInput())).rejects.toMatchObject({ code: "creator_approval_pending", status: 409 });
    expect(db.dispatches).toHaveLength(0);
    expect(blocked()).toEqual([
      expect.objectContaining({ taskId: "TASK-1", payload: expect.objectContaining({ action: "checkout", creatorPrincipal: "sp_mcp_workbench_intake", actorId: "sp_mcp_claude_code" }) }),
    ]);
  });

  it("actionCheckout (MCP) refuses with an audit event", async () => {
    await expect(actionCheckout(agent, "TASK-1")).rejects.toMatchObject({ code: "creator_approval_pending" });
    expect(db.dispatches).toHaveLength(0);
    expect(blocked()[0].payload).toMatchObject({ action: "checkout", door: "mcp" });
  });

  it("a launch checkout refuses too", async () => {
    process.env.PLX_MC_LAUNCHER_PRINCIPALS = "sp_mcp_claude_code";
    await expect(checkout(checkoutInput({ launchId: "launch-1" }))).rejects.toMatchObject({ code: "creator_approval_pending" });
    expect(db.dispatches).toHaveLength(0);
  });

  it.each(["progress", "qa", "review", "merged", "verified"] as const)("a stage move to %s refuses with an audit event", async (stage) => {
    await expect(patchTask("TASK-1", { stage }, "someone@petrasoap.com")).rejects.toMatchObject({ code: "creator_approval_pending" });
    expect(task().stage).toBe("planned");
    expect(blocked()[0].payload).toMatchObject({ action: "stage", requestedStage: stage });
  });

  it("the compliance projection's stage move refuses too", async () => {
    await expect(patchTask("TASK-1", { stage: "progress" }, "projection", { complianceProjection: true }))
      .rejects.toMatchObject({ code: "creator_approval_pending" });
  });

  it("a stage move before progress, or a cancel, stays allowed", async () => {
    await patchTask("TASK-1", { stage: "specced" }, "someone@petrasoap.com");
    expect(task().stage).toBe("specced");
    expect(stageAdvanceViolation(task(), "cancelled")).toBeNull();
  });

  it("the shared stage policy names the gate for the client store", () => {
    expect(stageAdvanceViolation(task(), "progress")).toMatch(/waits for creator approval/);
    expect(stageAdvanceViolation(task(), "approved")).toBeNull();
  });

  it("a PR opened against the task does not promote it", async () => {
    await projectPullRequest(
      { action: "opened", merged: false, repo: "PLX_MC", prNumber: 7, headSha: "abc", branch: "b", title: "t" } as never,
      { actorKind: "agent", actorIdentity: "claude", taskIds: ["TASK-1"], sparse: false }
    );
    expect(task().stage).toBe("planned");
    expect(db.events.find((e) => e.kind === "task.promotion_skipped")?.payload).toMatchObject({ reason: "creator_approval_pending" });
  });
});

describe("no bypass", () => {
  beforeEach(() => gated());
  const approved = { ...pending, status: "approved" as const, approvedBy: "x", approvedAt: "now" };

  it("a generic patchTask cannot clear or forge the creator approval", async () => {
    await expect(patchTask("TASK-1", { creatorApproval: approved }, "someone")).rejects.toMatchObject({ code: "creator_approval_required", status: 403 });
    expect(task().creatorApproval?.status).toBe("pending");
  });

  it("mc_update_task (task.update) rejects a creatorApproval field", async () => {
    await expect(actionUpdateTask(agent, { taskId: "TASK-1", patch: { creatorApproval: approved } })).rejects.toMatchObject({ code: "invalid_request" });
    expect(task().creatorApproval?.status).toBe("pending");
  });

  it("approval.decide on a runtime gate leaves the creator approval pending", async () => {
    gated({
      approvalGates: [{ id: "apg_1", reason: "go?", requestedBy: "agent@x", requestedByPrincipal: "sp_mcp_claude_code", requestedAt: "t", status: "pending" }],
    });
    await decideApprovalGate({ taskId: "TASK-1", gateId: "apg_1", decision: "approved", decidedBy: "vince@petrasoap.com" });
    expect(task().approvalGates?.[0].status).toBe("approved");
    expect(task().creatorApproval?.status).toBe("pending");
    await expect(checkout(checkoutInput())).rejects.toMatchObject({ code: "creator_approval_pending" });
  });
});

describe("creator approval action", () => {
  beforeEach(() => gated());

  it.each([
    ["vince@", VINCE_OID, "vince@petrasoap.com"],
    ["cos@", COS_OID, "cos@petrasoap.com"],
  ])("%s approves; checkout and the move to progress then go through", async (_who, oid, email) => {
    const { task: updated } = await approveCreatorApproval({ taskId: "TASK-1", approverOid: oid, approverLabel: email });
    expect(updated.creatorApproval).toMatchObject({ status: "approved", approvedBy: email, approvedByOid: oid, principal: "sp_mcp_workbench_intake" });
    expect(updated.creatorApproval?.approvedAt).toEqual(expect.any(String));
    expect(db.events.find((e) => e.kind === "creator_approval.approved")).toMatchObject({ actor: email, taskId: "TASK-1" });

    const { checkoutId } = await checkout(checkoutInput());
    expect(checkoutId).toMatch(/^dsp_/);
    await patchTask("TASK-1", { stage: "progress" }, email);
    expect(task().stage).toBe("progress");
    expect(blocked()).toHaveLength(0);
  });

  it("refuses anyone else, audits the attempt, and keeps the gate", async () => {
    await expect(approveCreatorApproval({ taskId: "TASK-1", approverOid: OTHER_OID, approverLabel: "greg.m@petrasoap.com" }))
      .rejects.toMatchObject({ code: "creator_approver_not_allowed", status: 403 });
    expect(db.events.find((e) => e.kind === "creator_approval.denied")).toMatchObject({ actor: "greg.m@petrasoap.com", taskId: "TASK-1" });
    expect(task().creatorApproval?.status).toBe("pending");
    await expect(checkout(checkoutInput())).rejects.toMatchObject({ code: "creator_approval_pending" });
  });

  it("refuses a second approval and a task with no gate", async () => {
    await approveCreatorApproval({ taskId: "TASK-1", approverOid: VINCE_OID, approverLabel: "vince@petrasoap.com" });
    await expect(approveCreatorApproval({ taskId: "TASK-1", approverOid: COS_OID, approverLabel: "cos@petrasoap.com" }))
      .rejects.toMatchObject({ code: "creator_approval_already_decided" });
    seed("TASK-2");
    await expect(approveCreatorApproval({ taskId: "TASK-2", approverOid: VINCE_OID, approverLabel: "vince@petrasoap.com" }))
      .rejects.toMatchObject({ code: "creator_approval_not_required" });
  });

  it("the route takes the approver from the session oid, never the body", async () => {
    const call = (body: unknown) =>
      (approveRoute as unknown as (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<unknown>)(
        new Request("http://mc/api/tasks/TASK-1/creator-approval", { method: "POST", body: JSON.stringify(body) }),
        { params: Promise.resolve({ id: "TASK-1" }) }
      );
    db.session = { oid: OTHER_OID, email: "greg.m@petrasoap.com" };
    await expect(call({ approverOid: VINCE_OID })).rejects.toMatchObject({ code: "invalid_request" });
    await expect(call({})).rejects.toMatchObject({ code: "creator_approver_not_allowed" });
    db.session = { oid: COS_OID, email: "cos@petrasoap.com" };
    expect(await call({ note: "ok" })).toMatchObject({ taskId: "TASK-1", creatorApproval: { status: "approved", approvedBy: "cos@petrasoap.com" } });
  });
});

describe("non-gated tasks behave as before", () => {
  beforeEach(() => seed("TASK-1"));

  it("checkout and the move to progress go through with no creator event", async () => {
    const { checkoutId } = await checkout(checkoutInput());
    expect(checkoutId).toMatch(/^dsp_/);
    await patchTask("TASK-1", { stage: "progress" }, "someone");
    expect(task().stage).toBe("progress");
    expect(db.events.some((e) => e.kind.startsWith("creator_approval."))).toBe(false);
  });
});
