// mc_report_progress guards: no-op bare call, merged/verified regression refusal,
// and an active checkout held by the authenticated principal. In-memory fakes
// for the task store and the dispatch ledger; no database.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { McpIdentity } from "@/lib/mcp/auth";

const h = vi.hoisted(() => ({
  task: {} as Record<string, unknown>,
  patches: [] as Record<string, unknown>[],
  events: [] as { kind: string; payload: Record<string, unknown> }[],
  // active checkouts: taskId held by principalId
  active: [] as { taskId: string; principalId: string }[],
  activeQueries: [] as { taskId: string; principalId: string }[],
}));

vi.mock("@/lib/permissions/decision-log", () => ({ recordPermissionDecision: vi.fn(async () => true) }));
vi.mock("@/lib/permissions/project-acl-guard", () => ({
  assertTaskProjectAccess: vi.fn(async () => undefined),
  assertBucketProjectAccess: vi.fn(async () => undefined),
  assertProjectIdAccess: vi.fn(async () => undefined),
  loadProjectAclMaps: vi.fn(async () => ({})),
}));
vi.mock("@/lib/mcp/sync-meta", () => ({ syncMetaForTask: vi.fn(async () => ({})) }));
vi.mock("@/lib/sync/repo", () => ({
  getEntity: vi.fn(async (_type: string, id: string) =>
    id === h.task.id ? { data: structuredClone(h.task) } : null
  ),
}));
vi.mock("@/lib/sync", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sync")>()),
  patchTask: vi.fn(async (_id: string, patch: Record<string, unknown>) => {
    h.patches.push(patch);
    h.task = { ...h.task, ...patch };
    return structuredClone(h.task);
  }),
}));
vi.mock("@/lib/compliance/repo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/compliance/repo")>()),
  hasActiveCheckoutForPrincipal: vi.fn(async (taskId: string, principalId: string) => {
    h.activeQueries.push({ taskId, principalId });
    return h.active.some((a) => a.taskId === taskId && a.principalId === principalId);
  }),
  appendEvent: vi.fn(async (e: { kind: string; payload: Record<string, unknown> }) => {
    h.events.push(e);
    return "1";
  }),
}));

import { actionProgress } from "@/lib/mcp/actions";

const identity: McpIdentity = {
  operatorEmail: "cos@petrasoap.com",
  runtime: "cursor",
  workerId: "unknown-worker",
  repo: "petralabx/PLX_MC",
  servicePrincipalId: "sp_mcp_cursor",
  actor: { kind: "service", id: "sp_mcp_cursor", status: "active" },
} as McpIdentity;

function seed(stage: string) {
  h.task = { id: "TASK-1", stage, comments: [{ id: "c0", body: "old" }] };
}

async function expectRefused(promise: Promise<unknown>, status: number, code: string) {
  await expect(promise).rejects.toMatchObject({ status, code });
}

beforeEach(() => {
  h.patches.length = 0;
  h.events.length = 0;
  h.active = [{ taskId: "TASK-1", principalId: "sp_mcp_cursor" }];
  h.activeQueries.length = 0;
  seed("progress");
});

describe("bare call is a no-op", () => {
  for (const stage of ["merged", "verified", "progress"]) {
    it(`returns the current stage on a ${stage} task and writes nothing`, async () => {
      seed(stage);
      h.active = []; // a no-op needs no checkout: it changes nothing
      const result = await actionProgress(identity, { taskId: "TASK-1" });
      expect(result).toMatchObject({ ok: true, noop: true, taskId: "TASK-1", stage });
      expect(h.patches).toEqual([]);
      expect(h.events).toEqual([]);
      expect(h.task.comments).toEqual([{ id: "c0", body: "old" }]);
    });
  }
});

describe("merged/verified regression", () => {
  for (const current of ["merged", "verified"]) {
    for (const lower of ["progress", "qa", "review", "planned", "backlog"]) {
      it(`${current} -> ${lower} is 409 stage_regression and writes nothing`, async () => {
        seed(current);
        await expectRefused(actionProgress(identity, { taskId: "TASK-1", stage: lower as never }), 409, "stage_regression");
        expect(h.patches).toEqual([]);
        expect(h.events).toEqual([]);
      });
    }
  }

  it("refuses a merged task moved back even with notes (a reason does not unlock it)", async () => {
    seed("merged");
    await expectRefused(
      actionProgress(identity, { taskId: "TASK-1", stage: "progress", notes: "reopening because reasons" }),
      409,
      "stage_regression"
    );
    expect(h.patches).toEqual([]);
    expect(h.events).toEqual([]);
    expect(h.task.comments).toEqual([{ id: "c0", body: "old" }]);
  });

  it("refuses the regression even when the principal holds an active checkout", async () => {
    seed("merged");
    await expectRefused(actionProgress(identity, { taskId: "TASK-1", stage: "qa" }), 409, "stage_regression");
    expect(h.patches).toEqual([]);
  });
});

describe("checkout authorization", () => {
  it("returns 403 and writes nothing without an active checkout", async () => {
    h.active = [];
    await expectRefused(actionProgress(identity, { taskId: "TASK-1", stage: "qa" }), 403, "forbidden");
    await expectRefused(actionProgress(identity, { taskId: "TASK-1", notes: "hi" }), 403, "forbidden");
    expect(h.patches).toEqual([]);
    expect(h.events).toEqual([]);
  });

  it("does not accept a checkout held by a different principal", async () => {
    h.active = [{ taskId: "TASK-1", principalId: "sp_mcp_claude_code" }];
    await expectRefused(actionProgress(identity, { taskId: "TASK-1", stage: "qa" }), 403, "forbidden");
    expect(h.patches).toEqual([]);
  });

  it("does not accept a checkout of a different task", async () => {
    h.active = [{ taskId: "TASK-2", principalId: "sp_mcp_cursor" }];
    await expectRefused(actionProgress(identity, { taskId: "TASK-1", stage: "qa" }), 403, "forbidden");
  });

  it("binds on the authenticated principal, never the operator header", async () => {
    h.active = [{ taskId: "TASK-1", principalId: "cos@petrasoap.com" }];
    await expectRefused(actionProgress(identity, { taskId: "TASK-1", stage: "qa" }), 403, "forbidden");
    expect(h.activeQueries.every((q) => q.principalId === "sp_mcp_cursor")).toBe(true);
  });

  it("unknown task is 404", async () => {
    await expectRefused(actionProgress(identity, { taskId: "TASK-404", stage: "qa" }), 404, "not_found");
  });
});

describe("normal progress is unchanged", () => {
  it("moves forward with an active checkout and records task.progress", async () => {
    const result = await actionProgress(identity, { taskId: "TASK-1", stage: "qa" });
    expect(result).toMatchObject({ ok: true, taskId: "TASK-1", stage: "qa" });
    expect(result).not.toHaveProperty("noop");
    expect(h.patches).toEqual([{ stage: "qa" }]);
    expect(h.events).toEqual([expect.objectContaining({ kind: "task.progress", payload: expect.objectContaining({ stage: "qa" }) })]);
  });

  it("notes still append a comment", async () => {
    const result = await actionProgress(identity, { taskId: "TASK-1", notes: "tests green" });
    expect(result.stage).toBe("progress");
    const comments = h.task.comments as { body: string; author: string }[];
    expect(comments).toHaveLength(2);
    expect(comments[1]).toMatchObject({ body: "tests green", author: "cos@petrasoap.com" });
    expect(h.patches[0]).not.toHaveProperty("stage");
  });

  it("notes on a merged task append without moving the stage", async () => {
    seed("merged");
    await actionProgress(identity, { taskId: "TASK-1", notes: "post-merge note" });
    expect(h.task.stage).toBe("merged");
  });
});
