// TASK-629/630 — approvals service: gate lifecycle, audit events, separation
// of duties, and the pending-approvals inbox source.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/route";
import type { ApprovalGate, Task } from "@/lib/mc-data";
import { principalFromTokens } from "@/lib/permissions/project-acl";

const h = vi.hoisted(() => ({
  tasks: new Map<string, Record<string, unknown>>(),
  patches: [] as { id: string; patch: Record<string, unknown>; actor: string }[],
  events: [] as Record<string, unknown>[],
  stored: [] as unknown[],
  buckets: [] as unknown[],
  projects: [] as unknown[],
  session: null as { user?: { oid?: string | null; email?: string | null } } | null,
}));

// Gates are raised and decided under the task row lock (TASK-3796); run the transaction in memory.
vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  withTransaction: async (fn: (q: unknown) => unknown) => fn({}),
}));

vi.mock("@/lib/sync", () => ({
  ensureSeeded: async () => true,
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
  getBuckets: async () => h.buckets,
  getProjects: async () => h.projects,
}));

vi.mock("@/lib/compliance/repo", () => ({
  appendEvent: async (e: Record<string, unknown>) => {
    h.events.push(e);
  },
  appendEventTx: async (_q: unknown, e: Record<string, unknown>) => {
    h.events.push(e);
  },
  eventsByKinds: async () => h.stored,
}));

// Route seams (as in tests/task-questions-access.test.ts): the real
// requireSessionActor → authorize path and the real ACL guard run; only the
// session and the identity row (an admin, who holds approval.decide) are faked.
vi.mock("@/lib/auth", () => ({
  auth: async () => h.session,
  oidcEnabled: () => true,
}));
vi.mock("@/lib/permissions/repository", () => ({
  findMcUserByEntraOid: async (oid: string) => ({
    id: "u1",
    entraOid: oid,
    email: h.session?.user?.email ?? "",
    accessRole: "admin",
    status: "active",
  }),
  findServicePrincipalById: async () => null,
}));
vi.mock("@/lib/permissions/decision-log", () => ({ recordPermissionDecision: vi.fn(async () => true) }));
vi.mock("@/lib/permissions/shadow-mismatch", () => ({ recordShadowMismatch: vi.fn(async () => undefined) }));

import {
  decideApprovalGate,
  listApprovalAudit,
  pairApprovalEvents,
  listPendingApprovals,
  listPendingCreatorApprovals,
  requestApprovalGate,
} from "@/lib/compliance/approvals";
import * as approvalsRoute from "@/app/api/approvals/route";
import * as decideRoute from "@/app/api/approvals/decide/route";

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
  h.stored = [];
  h.buckets = [];
  h.projects = [];
  h.session = null;
});

describe("requestApprovalGate", () => {
  it("mints a pending apg_* gate and appends approval.requested", async () => {
    seedTask("TASK-700");
    const { gate } = await requestApprovalGate({
      taskId: "TASK-700",
      reason: "prod deploy needs a human",
      requestedBy: "vince@petrasoap.com",
      requestedByPrincipal: "sp_mcp_claude_code",
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
      requestApprovalGate({
        taskId: "TASK-999",
        reason: "x",
        requestedBy: "a@b.c",
        requestedByPrincipal: "sp_mcp_claude_code",
      })
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

  it("signs an approval and stamps its expiry; a rejection stays unsigned (TASK-3408)", async () => {
    process.env.PLX_MC_APPROVAL_SIGNING_KEY = "k";
    try {
      seedTask("TASK-700", { approvalGates: [{ ...pending, scope: { kind: "flags", flags: ["PLX_ALLOW_GATE_PENDING"] } }] });
      const { gate } = await decideApprovalGate({ taskId: "TASK-700", gateId: "apg_1", decision: "approved", decidedBy: "greg@petrasoap.com", renderedScope: JSON.stringify({ kind: "flags", flags: ["PLX_ALLOW_GATE_PENDING"] }, null, 2) });
      expect(gate.signature).toMatch(/^[0-9a-f]{64}$/);
      expect(Date.parse(gate.expiresAt!) - Date.parse(gate.decidedAt!)).toBe(24 * 3_600_000);
      expect(h.events[0].payload).toMatchObject({ signed: true, expiresAt: gate.expiresAt });
      seedTask("TASK-701", { approvalGates: [pending] });
      const { gate: no } = await decideApprovalGate({ taskId: "TASK-701", gateId: "apg_1", decision: "rejected", decidedBy: "greg@petrasoap.com" });
      expect(no.signature).toBeUndefined();
      expect(no.expiresAt).toBeUndefined();
    } finally {
      delete process.env.PLX_MC_APPROVAL_SIGNING_KEY;
    }
  });

  it.each([
    {},
    { renderedScope: JSON.stringify({ kind: "flags", flags: ["different"] }, null, 2), renderedSourceRef: "ticket/1" },
    { renderedScope: JSON.stringify({ kind: "flags", flags: ["override"] }, null, 2) },
    { renderedScope: JSON.stringify({ kind: "flags", flags: ["override"] }, null, 2), renderedSourceRef: "ticket/old" },
  ])("refuses scoped approval without the exact displayed scope and source: %j", async (review) => {
    seedTask("TASK-700", { approvalGates: [{ ...pending, scope: { kind: "flags", flags: ["override"] }, sourceRef: "ticket/1" }] });
    await expect(decideApprovalGate({ taskId: "TASK-700", gateId: pending.id, decision: "approved", decidedBy: "greg@petrasoap.com", ...review }))
      .rejects.toMatchObject({ code: "approval_scope_not_reviewed", status: 409 });
    expect(h.patches).toHaveLength(0);
    expect(h.events).toHaveLength(0);
  });

  it("accepts the exact displayed scope and source and still permits rejection without review", async () => {
    const scope = { kind: "merge" as const, repo: "petralabx/PLX_MC", pr: 385, headSha: "a".repeat(40) };
    seedTask("TASK-700", { approvalGates: [{ ...pending, scope, sourceRef: "ticket/1" }] });
    await expect(decideApprovalGate({ taskId: "TASK-700", gateId: pending.id, decision: "approved", decidedBy: "greg@petrasoap.com", renderedScope: JSON.stringify(scope, null, 2), renderedSourceRef: "ticket/1" }))
      .resolves.toMatchObject({ gate: { status: "approved", scope, sourceRef: "ticket/1" } });
    seedTask("TASK-701", { approvalGates: [{ ...pending, scope }] });
    await expect(decideApprovalGate({ taskId: "TASK-701", gateId: pending.id, decision: "rejected", decidedBy: "greg@petrasoap.com" }))
      .resolves.toMatchObject({ gate: { status: "rejected" } });
  });

  it("refuses an approval from a decider off the allowlist and audits it (TASK-3408)", async () => {
    process.env.PLX_MC_APPROVAL_DECIDERS = "vince@petrasoap.com";
    try {
      seedTask("TASK-700", { approvalGates: [{ ...pending, requestedBy: "cos@petrasoap.com" }] });
      await expect(decideApprovalGate({ taskId: "TASK-700", gateId: "apg_1", decision: "approved", decidedBy: "greg@petrasoap.com" }))
        .rejects.toMatchObject({ code: "decider_not_allowed", status: 403 });
      expect(h.events[0]).toMatchObject({ kind: "approval.denied", payload: { reasonCode: "decider_not_allowed" } });
      await expect(decideApprovalGate({ taskId: "TASK-700", gateId: "apg_1", decision: "approved", decidedBy: "vince@petrasoap.com" }))
        .resolves.toMatchObject({ gate: { status: "approved" } });
    } finally {
      delete process.env.PLX_MC_APPROVAL_DECIDERS;
    }
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
    // Exactly one audit denial, attributed to the attempter; the gate is unchanged.
    expect(h.events).toHaveLength(1);
    expect(h.events[0]).toMatchObject({
      kind: "approval.denied",
      actor: "vince@petrasoap.com",
      taskId: "TASK-700",
      payload: { gateId: "apg_1", reasonCode: "separation_of_duties", attemptedDecision: "approved" },
    });
    expect(h.patches).toHaveLength(0);
    expect((h.tasks.get("TASK-700")!.data as Task).approvalGates).toEqual([pending]);
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
    const rows = await listPendingApprovals(principalFromTokens());
    expect(rows.map((r) => r.gate.id)).toEqual(["apg_b", "apg_a"]);
    expect(rows[0]).toMatchObject({ taskId: "TASK-2", stage: "progress", evidence: null });
  });

  it("projects the task's existing evidence bundle and leaves it null when there is none", async () => {
    seedTask("TASK-1", {
      evidence: {
        summary: "  ",
        items: [],
      },
      approvalGates: [
        { id: "apg_empty", reason: "blank", requestedBy: "x", requestedAt: "2026-07-23T00:00:00Z", status: "pending" },
      ],
    });
    seedTask("TASK-2", {
      evidence: {
        summary: "Shipped the gate",
        items: [{ key: "qa", label: "QA", done: true }],
      },
      approvalGates: [
        { id: "apg_ev", reason: "look", requestedBy: "x", requestedAt: "2026-07-23T01:00:00Z", status: "pending" },
      ],
    });
    seedTask("TASK-3", {
      approvalGates: [
        { id: "apg_none", reason: "none", requestedBy: "x", requestedAt: "2026-07-23T02:00:00Z", status: "pending" },
      ],
    });
    const rows = await listPendingApprovals(principalFromTokens());
    expect(rows.find((r) => r.taskId === "TASK-1")?.evidence).toBeNull();
    expect(rows.find((r) => r.taskId === "TASK-2")?.evidence).toEqual({
      summary: "Shipped the gate",
      itemKeys: ["qa"],
    });
    expect(rows.find((r) => r.taskId === "TASK-3")?.evidence).toBeNull();
  });
});

// TASK-3713: a gate is as private as its task. On a restricted project only
// members see it in the inbox or decide it — an admin who is not a member
// gets neither, though approval.decide alone would let them.
describe("restricted-project ACL on the inbox and decide (TASK-3713)", () => {
  const GREG = { user: { oid: "oid-greg", email: "greg@petrasoap.com" } };
  const VINCE = { user: { oid: "oid-vince", email: "vince@petrasoap.com" } };
  const noCtx = { params: Promise.resolve({} as Record<string, string>) };
  const pending = (id: string): ApprovalGate => ({
    id,
    reason: "ship?",
    requestedBy: "cos@petrasoap.com",
    requestedAt: "2026-10-22T00:00:00Z",
    status: "pending",
  });
  const decide = (body: Record<string, unknown>) =>
    decideRoute.POST(
      new Request("http://test/api/approvals/decide", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      noCtx
    );
  const secretGate = () => (h.tasks.get("TASK-SECRET")?.data as Task).approvalGates?.[0];

  beforeEach(() => {
    vi.stubEnv("PLX_MC_PERMISSIONS_ENFORCEMENT_MODE", "enforce");
    h.buckets = [
      { id: "BKT-OPEN", project: "PRJ-OPEN" },
      { id: "BKT-SECRET", project: "PRJ-SECRET" },
    ];
    h.projects = [
      { id: "PRJ-OPEN" },
      { id: "PRJ-SECRET", visibility: "restricted", members: ["vince@petrasoap.com"] },
    ];
    seedTask("TASK-OPEN", { bucket: "BKT-OPEN", approvalGates: [pending("apg_open")] });
    seedTask("TASK-SECRET", {
      bucket: "BKT-SECRET",
      approvalGates: [{ ...pending("apg_secret"), proposal: { summary: "secret acquisition plan" } }],
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("listPendingApprovals returns a restricted project's gates to members only", async () => {
    const outsider = await listPendingApprovals(principalFromTokens("greg@petrasoap.com"));
    expect(outsider.map((r) => r.gate.id)).toEqual(["apg_open"]);
    const member = await listPendingApprovals(principalFromTokens("vince@petrasoap.com"));
    expect(member.map((r) => r.gate.id).sort()).toEqual(["apg_open", "apg_secret"]);
  });

  it("GET /api/approvals filters under the session's ACL principal", async () => {
    h.session = GREG;
    const resp = await approvalsRoute.GET(new Request("http://test/api/approvals"), noCtx);
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { data: { approvals: { gate: ApprovalGate }[] } };
    expect(body.data.approvals.map((r) => r.gate.id)).toEqual(["apg_open"]);
    expect(JSON.stringify(body)).not.toContain("secret acquisition plan");

    h.session = VINCE;
    const memberResp = await approvalsRoute.GET(new Request("http://test/api/approvals"), noCtx);
    const memberBody = (await memberResp.json()) as { data: { approvals: { gate: ApprovalGate }[] } };
    expect(memberBody.data.approvals.map((r) => r.gate.id).sort()).toEqual(["apg_open", "apg_secret"]);
  });

  it("POST /api/approvals/decide refuses a non-member admin and leaves the gate pending", async () => {
    h.session = GREG;
    const resp = await decide({ taskId: "TASK-SECRET", gateId: "apg_secret", decision: "approved" });
    expect(resp.status).toBe(403);
    expect(((await resp.json()) as { error: { code: string } }).error.code).toBe("project_acl_denied");
    expect(h.patches).toEqual([]);
    expect(h.events).toEqual([]);
    expect(secretGate()?.status).toBe("pending");
  });

  it("a member admin still decides the restricted gate", async () => {
    h.session = VINCE;
    const resp = await decide({ taskId: "TASK-SECRET", gateId: "apg_secret", decision: "approved" });
    expect(resp.status).toBe(200);
    expect(secretGate()?.status).toBe("approved");
    expect(h.events[0]).toMatchObject({ kind: "approval.decided", actor: "vince@petrasoap.com" });
  });
});

// TASK-3629: tasks from a gated creator show in the inbox for creator approvers only.
describe("creator approvals in the inbox source (TASK-3629)", () => {
  const noCtx = { params: Promise.resolve({} as Record<string, string>) };
  // The creator approver oids are reviewed code in permissions/grants.ts.
  const VINCE_APPROVER = { user: { oid: "29e05178-0bd1-49b9-be6e-b01be1975f70", email: "vince@petrasoap.com" } };
  const GREG = { user: { oid: "oid-greg", email: "greg@petrasoap.com" } };
  const creator = (status: "pending" | "approved", requestedAt: string) => ({
    creatorApproval: { principal: "sp_mcp_workbench_intake", status, requestedAt },
  });
  const get = async () => {
    const resp = await approvalsRoute.GET(new Request("http://test/api/approvals"), noCtx);
    expect(resp.status).toBe(200);
    return ((await resp.json()) as { data: { creatorApprovals: { taskId: string }[] } }).data.creatorApprovals;
  };

  beforeEach(() => {
    vi.stubEnv("PLX_MC_PERMISSIONS_ENFORCEMENT_MODE", "enforce");
    seedTask("TASK-NEW2", { stage: "backlog", ...creator("pending", "2026-10-26T21:00:00Z") });
    seedTask("TASK-NEW1", { stage: "backlog", ...creator("pending", "2026-10-26T20:00:00Z") });
    seedTask("TASK-DONE", { stage: "backlog", ...creator("approved", "2026-10-26T19:00:00Z") });
    seedTask("TASK-GONE", { stage: "cancelled", ...creator("pending", "2026-10-26T18:00:00Z") });
    seedTask("TASK-PLAIN", { stage: "backlog" });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("lists pending creator approvals oldest first, without approved, cancelled or ungated tasks", async () => {
    const rows = await listPendingCreatorApprovals(principalFromTokens("vince@petrasoap.com"));
    expect(rows).toEqual([
      { taskId: "TASK-NEW1", taskTitle: "Task TASK-NEW1", stage: "backlog", principal: "sp_mcp_workbench_intake", requestedAt: "2026-10-26T20:00:00Z" },
      { taskId: "TASK-NEW2", taskTitle: "Task TASK-NEW2", stage: "backlog", principal: "sp_mcp_workbench_intake", requestedAt: "2026-10-26T21:00:00Z" },
    ]);
  });

  it("GET /api/approvals returns them to a creator approver and an empty list to anyone else", async () => {
    h.session = VINCE_APPROVER;
    expect((await get()).map((r) => r.taskId)).toEqual(["TASK-NEW1", "TASK-NEW2"]);
    h.session = GREG;
    expect(await get()).toEqual([]);
  });

  it("keeps a restricted project's creator approvals from a creator approver who is not a member", async () => {
    h.buckets = [{ id: "BKT-SECRET", project: "PRJ-SECRET" }];
    h.projects = [{ id: "PRJ-SECRET", visibility: "restricted", members: ["greg@petrasoap.com"] }];
    seedTask("TASK-SECRET-NEW", { stage: "backlog", bucket: "BKT-SECRET", ...creator("pending", "2026-10-26T17:00:00Z") });
    h.session = VINCE_APPROVER;
    expect((await get()).map((r) => r.taskId)).not.toContain("TASK-SECRET-NEW");
  });
});

describe("approval audit export (TASK-630)", () => {
  const ev = (seq: string, kind: string, actor: string, payload: Record<string, unknown>) => ({
    seq, ts: `2026-10-11T00:00:0${seq}.000Z`, kind, actor, repo: null, taskId: "TASK-700", pr: null, payload,
  });

  it("pairs proposal and decision by gateId with distinct actors; undecided is pending", () => {
    const rows = pairApprovalEvents([
      ev("3", "approval.decided", "greg@petrasoap.com", { gateId: "apg_1", decision: "rejected", note: "no" }),
      ev("1", "approval.requested", "agent-a", { gateId: "apg_1", reason: "deploy", runtime: "claude" }),
      ev("2", "approval.requested", "agent-b", { gateId: "apg_2", reason: "spend" }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      gateId: "apg_1", taskId: "TASK-700", proposer: "agent-a", decider: "greg@petrasoap.com",
      decision: "rejected", reason: "deploy", note: "no", runtime: "claude",
      requestedAt: "2026-10-11T00:00:01.000Z", decidedAt: "2026-10-11T00:00:03.000Z",
    });
    expect(rows[1]).toMatchObject({ gateId: "apg_2", proposer: "agent-b", decider: null, decision: "pending", decidedAt: null });
  });

  it("surfaces a self-approval denial with its reasonCode on the gate's row", () => {
    const [row] = pairApprovalEvents([
      ev("1", "approval.requested", "vince@petrasoap.com", { gateId: "apg_1", reason: "x" }),
      ev("2", "approval.denied", "vince@petrasoap.com", { gateId: "apg_1", reasonCode: "separation_of_duties", attemptedDecision: "approved" }),
    ]);
    expect(row.decision).toBe("pending");
    expect(row.denials).toEqual([
      { actor: "vince@petrasoap.com", ts: "2026-10-11T00:00:02.000Z", reasonCode: "separation_of_duties", attemptedDecision: "approved" },
    ]);
  });

  it("listApprovalAudit applies the caller's ACL filter before pairing", async () => {
    h.stored = [ev("1", "approval.requested", "agent-a", { gateId: "apg_1", reason: "x" })];
    expect(await listApprovalAudit({ filter: async () => [] })).toEqual([]);
    expect(await listApprovalAudit()).toHaveLength(1);
  });
});
