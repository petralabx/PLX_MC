// TASK-4055 — mc_save_evidence saves the task evidence on a live checkout before
// merge, so the compliance gate can pass on the open PR, without completing the
// task. It never changes stage, completedAt or the checkout. mc_complete_task
// later keeps the saved evidence where it sends nothing.
// All seams are mocked in-memory (same technique as mcp-complete-evidence.test.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/route";
import { complete } from "@/lib/compliance/service";
import * as complianceRepo from "@/lib/compliance/repo";
import type { Evidence, Task } from "@/lib/mc-data";

type Dispatch = {
  id: string;
  taskId: string;
  accountableHuman: string;
  repo: string;
  revoked: boolean;
  releasedAt: string | null;
  expiresAt: string;
};

const db = vi.hoisted(() => ({
  dispatches: new Map<string, Dispatch>(),
  principals: new Map<string, string>(),
  tasks: new Map<string, Record<string, unknown>>(),
  patches: [] as { taskId: string; patch: Record<string, unknown> }[],
  events: [] as { kind: string; taskId?: string | null }[],
  denyProjectAccess: false,
}));

vi.mock("@/lib/compliance/service", () => ({
  complete: vi.fn(async () => ({ ok: true })),
  checkout: vi.fn(async () => ({ checkoutId: "dsp_test" })),
}));

vi.mock("@/lib/db", () => ({ withTransaction: vi.fn(async (fn: (q: unknown) => unknown) => fn({})) }));

vi.mock("@/lib/compliance/repo", () => ({
  getDispatch: vi.fn(async (id: string) => db.dispatches.get(id) ?? null),
  getDispatchCheckoutPrincipal: vi.fn(async (id: string) => db.principals.get(id) ?? null),
  appendEvent: vi.fn(async (e: { kind: string; taskId?: string | null }) => {
    db.events.push(e);
    return "1";
  }),
  appendEventTx: vi.fn(async (_q: unknown, e: { kind: string; taskId?: string | null }) => {
    db.events.push(e);
    return "1";
  }),
}));

vi.mock("@/lib/sync", () => ({
  patchTask: vi.fn(async (taskId: string, patch: Record<string, unknown>) => {
    db.patches.push({ taskId, patch });
    const next = { ...db.tasks.get(taskId), ...patch };
    db.tasks.set(taskId, next);
    return next as unknown as Task;
  }),
  createTask: vi.fn(),
  snapshot: vi.fn(),
}));

vi.mock("@/lib/sync/repo", () => ({
  getEntity: vi.fn(async (_kind: string, id: string) => {
    const data = db.tasks.get(id);
    return data ? { data: structuredClone(data) } : null;
  }),
  getBuckets: vi.fn(async () => [{ id: "BKT-OPEN", project: null }]),
  getProjects: vi.fn(async () => []),
}));

vi.mock("@/lib/permissions/project-acl-guard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/permissions/project-acl-guard")>()),
  assertTaskProjectAccess: vi.fn(async (taskId: string) => {
    if (db.denyProjectAccess) throw new ApiError("forbidden", `no access to ${taskId}`, 403);
  }),
}));

vi.mock("@/lib/mcp/sync-meta", () => ({
  syncMetaForTask: vi.fn(async () => ({ status: "queued" })),
}));

vi.mock("@/lib/routing/mutations/actors", () => ({
  requireMcpActor: vi.fn(() => ({
    actor: { kind: "service", id: "sp_mcp_claude_code", status: "active" },
    actorId: "sp_mcp_claude_code",
    actorKind: "service",
    auditLabel: "vince@example.com",
  })),
  aclPrincipalFromMcp: () => ({ tokens: ["sp_mcp_claude_code"] }),
}));

import { verifyCompliance, evidenceCompleteForTier } from "@/lib/compliance";
import { actionComplete, actionSaveEvidence } from "@/lib/mcp/actions";
import type { McpIdentity } from "@/lib/mcp/auth";

const identity: McpIdentity = {
  operatorEmail: "vince@example.com",
  runtime: "claude-code",
  workerId: "test",
  repo: "petralabx/PLX_MC",
  servicePrincipalId: "sp_mcp_claude_code",
  actor: { kind: "service", id: "sp_mcp_claude_code", status: "active" },
};

const HOUR = 3_600_000;

function addDispatch(id: string, over: Partial<Dispatch> = {}, principal = "sp_mcp_claude_code") {
  db.dispatches.set(id, {
    id,
    taskId: "TASK-900",
    accountableHuman: "vince",
    repo: "petralabx/PLX_MC",
    revoked: false,
    releasedAt: null,
    expiresAt: new Date(Date.now() + HOUR).toISOString(),
    ...over,
  });
  db.principals.set(id, principal);
}

function addTask(stage: string, over: Record<string, unknown> = {}) {
  db.tasks.set("TASK-900", {
    id: "TASK-900",
    title: "Save evidence",
    bucket: "BKT-OPEN",
    stage,
    accountableOwner: "vince",
    labels: [],
    ...over,
  });
}

const task = () => db.tasks.get("TASK-900") as unknown as Task;
const withoutEvidence = (t: Record<string, unknown> | undefined) =>
  Object.fromEntries(Object.entries(t ?? {}).filter(([key]) => key !== "evidence"));

const fullSave = {
  checkoutId: "dsp_live",
  summary: "Adds mc_save_evidence.",
  verificationCommands: ["npx vitest run tests/mcp-save-evidence.test.ts"],
  rollback: "Revert the PR.",
};

beforeEach(() => {
  db.dispatches.clear();
  db.principals.clear();
  db.tasks.clear();
  db.patches.length = 0;
  db.events.length = 0;
  db.denyProjectAccess = false;
  vi.mocked(complete).mockClear();
  addDispatch("dsp_live");
  addTask("progress");
});

afterEach(() => vi.useRealTimers());

describe("mc_save_evidence never completes the task", () => {
  it.each([
    ["backlog", {}],
    ["progress", {}],
    ["progress", { completedAt: "2026-10-01T00:00:00.000Z", approvalGates: [] }],
  ])("on a %s task: only evidence changes and the checkout stays live", async (stage, over) => {
    addTask(stage, over);
    const before = structuredClone(db.tasks.get("TASK-900"));
    const dispatchBefore = structuredClone(db.dispatches.get("dsp_live"));

    const res = await actionSaveEvidence(identity, fullSave);

    expect(res).toMatchObject({ ok: true, taskId: "TASK-900", checkoutId: "dsp_live" });
    expect(db.patches).toHaveLength(1);
    expect(Object.keys(db.patches[0].patch)).toEqual(["evidence"]);
    expect(withoutEvidence(db.tasks.get("TASK-900"))).toEqual(withoutEvidence(before));
    expect(task().stage).toBe(stage);
    expect(complete).not.toHaveBeenCalled();
    expect(db.dispatches.get("dsp_live")).toEqual(dispatchBefore);
    expect(db.events.map((e) => e.kind)).toEqual(["task.evidence.saved"]);
    expect(task().evidence).toMatchObject({
      summary: "Adds mc_save_evidence.",
      rollback: "Revert the PR.",
      items: [
        { key: "summary", done: true },
        { key: "verification", done: true },
        { key: "rollback", done: true },
      ],
    });
  });

  it("does not run the autonomy approval check that gates completion", async () => {
    // A pending approval gate refuses mc_complete_task on an approval-required
    // scope; saving evidence completes nothing, so it is not asked.
    addTask("progress", { bucket: "BKT-NO-SUCH", approvalGates: [{ id: "apg_1", status: "pending" }] });
    await expect(actionSaveEvidence(identity, fullSave)).resolves.toMatchObject({ ok: true });
  });

  it("keeps uploaded artifacts and merges a second save", async () => {
    const artifacts = [{ kind: "diagram", driveItemId: "item-1", url: "https://sp/item-1" }];
    addTask("progress", { evidence: { summary: "old", items: [], artifacts } });
    await actionSaveEvidence(identity, { ...fullSave, testRun: { suite: "vitest", passed: 9, failed: 0 } });
    await actionSaveEvidence(identity, { checkoutId: "dsp_live", summary: "Second save.", rollback: "  " });
    const ev = task().evidence!;
    expect(ev.summary).toBe("Second save.");
    expect(ev.rollback).toBe("Revert the PR.");
    expect(ev.items.every((i) => i.done)).toBe(true);
    expect(ev.qa).toMatchObject({ pass: 9, fail: 0, total: 9, suite: "vitest" });
    expect(ev.artifacts).toEqual(artifacts);
  });
});

describe("the compliance gate reads saved evidence", () => {
  const verify = (tier: "low" | "standard") =>
    verifyCompliance({ task: task(), actor: "agent", tier, bucketPrd: "present" });

  it.each(["low", "standard"] as const)("passes the %s tier after a save", async (tier) => {
    await actionSaveEvidence(identity, fullSave);
    expect(evidenceCompleteForTier(task().evidence, tier)).toEqual({ ok: true, missing: [] });
    expect(verify(tier).verdict).toBe("pass");
  });

  it("passes the low (minimal) tier with a summary alone", async () => {
    await actionSaveEvidence(identity, { checkoutId: "dsp_live", summary: "Docs only." });
    expect(verify("low").verdict).toBe("pass");
  });

  it("blocks without saved evidence", () => {
    const res = verify("standard");
    expect(res.verdict).toBe("block");
    expect(res.reasons).toEqual(
      expect.arrayContaining([
        "missing an evidence summary (send `summary`)",
        expect.stringMatching(/^missing a complete evidence checklist .*mc_save_evidence/),
        "missing a rollback plan (send `rollback`)",
      ])
    );
  });

  it("blocks the standard (note) tier when the save has no rollback or verification", async () => {
    await actionSaveEvidence(identity, { checkoutId: "dsp_live", summary: "Half a bundle." });
    const res = verify("standard");
    expect(res.verdict).toBe("block");
    expect(res.reasons).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^missing a complete evidence checklist/),
        "missing a rollback plan (send `rollback`)",
      ])
    );
    expect(res.reasons).not.toContain("missing an evidence summary (send `summary`)");
  });
});

describe("mc_save_evidence refusals write nothing", () => {
  const refused = async (input: typeof fullSave, code: string, status: number) => {
    await expect(actionSaveEvidence(identity, input)).rejects.toMatchObject({ code, status });
    expect(db.patches).toHaveLength(0);
    expect(db.events).toHaveLength(0);
  };

  it("refuses an unknown checkout", () => refused({ ...fullSave, checkoutId: "dsp_none" }, "invalid_checkout", 409));

  it("refuses a released checkout", () => {
    addDispatch("dsp_released", { releasedAt: new Date().toISOString() });
    return refused({ ...fullSave, checkoutId: "dsp_released" }, "invalid_checkout", 409);
  });

  it("refuses an expired checkout", () => {
    addDispatch("dsp_expired", { expiresAt: new Date(Date.now() - HOUR).toISOString() });
    return refused({ ...fullSave, checkoutId: "dsp_expired" }, "invalid_checkout", 409);
  });

  it("refuses a revoked checkout", () => {
    addDispatch("dsp_revoked", { revoked: true });
    return refused({ ...fullSave, checkoutId: "dsp_revoked" }, "invalid_checkout", 409);
  });

  it("refuses another principal's checkout", () => {
    addDispatch("dsp_other", {}, "sp_mcp_cursor");
    return refused({ ...fullSave, checkoutId: "dsp_other" }, "forbidden", 403);
  });

  it("refuses a checkout with no recorded principal", () => {
    addDispatch("dsp_unknown");
    db.principals.delete("dsp_unknown");
    return refused({ ...fullSave, checkoutId: "dsp_unknown" }, "forbidden", 403);
  });

  it("refuses without project access", () => {
    db.denyProjectAccess = true;
    return refused(fullSave, "forbidden", 403);
  });

  it("holds a summary a person must verify to STE-lite after the warn week", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-27T12:00:00Z"));
    addDispatch("dsp_live");
    addTask("progress", { labels: ["verify:human"] });
    const longSummary = `${Array.from({ length: 30 }, (_, i) => `word${i}`).join(" ")}.`;
    await refused({ ...fullSave, summary: longSummary }, "evidence_standard", 400);
    await expect(actionSaveEvidence(identity, fullSave)).resolves.toMatchObject({
      evidenceStandard: { applies: true, findings: [] },
    });
  });
});

describe("mc_complete_task after mc_save_evidence", () => {
  const artifacts = [{ kind: "diagram", driveItemId: "item-1", url: "https://sp/item-1" }];

  beforeEach(async () => {
    addTask("progress", { evidence: { summary: "", items: [], artifacts } });
    await actionSaveEvidence(identity, {
      ...fullSave,
      testRun: { suite: "vitest", passed: 12, failed: 0 },
      shots: [{ label: "after", cap: "new tool" }],
    });
  });

  it("its own fields win and the artifacts are kept", async () => {
    await actionComplete(identity, {
      checkoutId: "dsp_live",
      summary: "Merged and handed in.",
      verificationCommands: ["npm test"],
      rollback: "Revert the merge commit.",
    });
    const ev = task().evidence as Evidence;
    expect(ev.summary).toBe("Merged and handed in.");
    expect(ev.rollback).toBe("Revert the merge commit.");
    expect(ev.items.every((i) => i.done)).toBe(true);
    expect(ev.artifacts).toEqual(artifacts);
    // Not sent: the saved proof stays.
    expect(ev.qa).toMatchObject({ pass: 12, suite: "vitest" });
    expect(ev.shots).toEqual([{ label: "after", cap: "new tool" }]);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("falls back to the saved rollback and verification when they are blank or missing", async () => {
    await actionComplete(identity, {
      checkoutId: "dsp_live",
      summary: "Handed in.",
      verificationCommands: [],
      rollback: "   ",
    });
    const ev = task().evidence as Evidence;
    expect(ev.rollback).toBe("Revert the PR.");
    expect(ev.items.find((i) => i.key === "verification")?.done).toBe(true);
    expect(ev.items.find((i) => i.key === "rollback")?.done).toBe(true);
    expect(ev.artifacts).toEqual(artifacts);
  });

  it("sent testRun replaces the saved one", async () => {
    await actionComplete(identity, {
      ...fullSave,
      testRun: { suite: "vitest", passed: 20, failed: 1 },
    });
    expect(task().evidence?.qa).toMatchObject({ pass: 20, fail: 1, total: 21 });
  });
});

// The repo seam the action uses for the principal check (keeps the mock honest).
it("uses the checkout event's principal", async () => {
  await actionSaveEvidence(identity, fullSave);
  expect(complianceRepo.getDispatchCheckoutPrincipal).toHaveBeenCalledWith("dsp_live");
});
