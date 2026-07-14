// P6 — PR lifecycle projection: progress/merge + sparse-task retirement +
// compliance-projection authorize gate.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Task } from "@/lib/mc-data";
import { ApiError } from "@/lib/api/route";
import { COMPLIANCE_PROJECTION_SERVICE_PRINCIPAL_ID } from "@/lib/permissions";

const store = vi.hoisted(() => {
  const rows = new Map<
    string,
    { entity_type: string; id: string; data: Record<string, unknown>; sync_state: string; sp_item_id: string | null; dirty_fields: string[] }
  >();
  const events: { kind: string; taskId?: string | null; dedupKey?: string | null; payload?: Record<string, unknown> }[] = [];
  const dedupTaskIds = new Map<string, string>();
  return {
    rows,
    events,
    dedupTaskIds,
    taskSeq: 0,
    enforcement: false,
    principalStatus: "active" as "active" | "revoked",
    principalPresent: true,
    authorizeAllowed: true,
    authorizeReason: "allowed" as string,
    authorizeCalls: [] as { capability: string; actorId: string }[],
  };
});

vi.mock("@/lib/auth", () => ({
  permissionsEnforcementEnabled: () => store.enforcement,
}));

vi.mock("@/lib/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/permissions")>();
  return {
    ...actual,
    authorize: (input: { actor: { id: string }; capability: string }) => {
      store.authorizeCalls.push({
        capability: input.capability,
        actorId: input.actor.id,
      });
      return {
        allowed: store.authorizeAllowed,
        reasonCode: store.authorizeAllowed ? "allowed" : store.authorizeReason,
        policyVersion: "permissions.v1",
      };
    },
  };
});

vi.mock("@/lib/permissions/repository", () => ({
  findServicePrincipalById: async (id: string) => {
    if (!store.principalPresent) return null;
    if (id !== COMPLIANCE_PROJECTION_SERVICE_PRINCIPAL_ID) return null;
    return {
      id: COMPLIANCE_PROJECTION_SERVICE_PRINCIPAL_ID,
      name: "PLX MC Compliance Projection",
      status: store.principalStatus,
    };
  },
}));

vi.mock("@/lib/sync/engine", () => ({
  ensureSeeded: vi.fn(async () => true),
  ensureReposSeeded: vi.fn(async () => true),
}));

vi.mock("@/lib/sync/repo", () => ({
  stamp: () => "2026.07.08 · 00:00",
  async getRepos() {
    return [{ id: "plx-mc", name: "PLX_MC", lang: "TypeScript", def: "main", owner: "taylorvalton", visibility: "private", scope: "" }];
  },
  async getEntity(type: string, id: string) {
    return store.rows.get(`${type}:${id}`) ?? null;
  },
  async getEntities(type: string) {
    return [...store.rows.entries()]
      .filter(([k]) => k.startsWith(`${type}:`))
      .map(([, row]) => row);
  },
  async insertEntity(type: string, id: string, data: Record<string, unknown>, syncState: string, dirtyFields: string[]) {
    store.rows.set(`${type}:${id}`, {
      entity_type: type,
      id,
      data,
      sync_state: syncState,
      sp_item_id: null,
      dirty_fields: dirtyFields,
    });
  },
  async updateEntity(
    type: string,
    id: string,
    opts: { patch?: Record<string, unknown>; syncState?: string; dirtyFields?: string[] }
  ) {
    const row = store.rows.get(`${type}:${id}`);
    if (!row) return;
    row.data = { ...row.data, ...(opts.patch ?? {}) };
    if (opts.syncState !== undefined) row.sync_state = opts.syncState;
    if (opts.dirtyFields !== undefined) row.dirty_fields = opts.dirtyFields;
  },
  async appendAudit() {},
}));

vi.mock("@/lib/compliance/repo", () => ({
  async appendEvent(e: { kind: string; taskId?: string | null; dedupKey?: string | null; payload?: Record<string, unknown> }) {
    store.events.push(e);
    if (e.dedupKey && e.taskId) store.dedupTaskIds.set(e.dedupKey, e.taskId);
  },
  async eventTaskIdByDedupKey(dedupKey: string) {
    return store.dedupTaskIds.get(dedupKey) ?? null;
  },
}));

import { projectPullRequest, projectionEnabled, requireProjectionAuthorized } from "@/lib/compliance/projection";
import type { PrEvent } from "@/lib/compliance/webhook";

function seedTask(over: Partial<Task> = {}): Task {
  const base: Task = {
    id: "TASK-100",
    title: "seed task",
    description: "",
    bucket: "BKT-INFRA",
    stage: "planned",
    priority: "medium",
    assignee: null,
    coassignees: [],
    reporter: "vince",
    accountableOwner: "vince",
    reqs: [],
    repos: ["plx-mc"],
    estimate: "M",
    labels: [],
    prs: [],
    due: "Jul 8",
    sync: { state: "synced", ts: "—", sp: "ToDos · item 100" },
    subtasks: [],
    activity: [],
    ...over,
  };
  store.rows.set("task:" + base.id, {
    entity_type: "task",
    id: base.id,
    data: base as unknown as Record<string, unknown>,
    sync_state: "synced",
    sp_item_id: "1",
    dirty_fields: [],
  });
  return base;
}

function prEvt(over: Partial<PrEvent> = {}): PrEvent {
  return {
    action: "opened",
    merged: false,
    repo: "PLX_MC",
    repoFullName: "petralabx/PLX_MC",
    repositoryId: "12345",
    prNumber: 42,
    headSha: "abc123",
    mergeSha: null,
    branch: "feat/x",
    baseBranch: "main",
    title: "Add the thing",
    author: "greg",
    labels: [],
    checkoutId: null,
    checkoutIds: [],
    body: "",
    changedPaths: [],
    ...over,
  };
}

beforeEach(() => {
  store.rows.clear();
  store.events.length = 0;
  store.dedupTaskIds.clear();
  store.taskSeq = 0;
  store.enforcement = false;
  store.principalStatus = "active";
  store.principalPresent = true;
  store.authorizeAllowed = true;
  store.authorizeReason = "allowed";
  store.authorizeCalls.length = 0;
  delete process.env.COMPLIANCE_PROJECTION_ENABLED;
});

afterEach(() => {
  delete process.env.COMPLIANCE_PROJECTION_ENABLED;
});

describe("projectionEnabled", () => {
  it("is on by default and respects COMPLIANCE_PROJECTION_ENABLED=0", () => {
    expect(projectionEnabled()).toBe(true);
    process.env.COMPLIANCE_PROJECTION_ENABLED = "0";
    expect(projectionEnabled()).toBe(false);
  });
});

describe("requireProjectionAuthorized", () => {
  it("allows task.progress for the durable compliance-projection SP", async () => {
    const actor = await requireProjectionAuthorized("task.progress", {
      type: "task",
      id: "TASK-1",
    });
    expect(actor.id).toBe(COMPLIANCE_PROJECTION_SERVICE_PRINCIPAL_ID);
    expect(store.authorizeCalls.some((c) => c.capability === "task.progress")).toBe(true);
  });

  it("denies when authorize rejects the projection principal", async () => {
    store.authorizeAllowed = false;
    store.authorizeReason = "capability_not_granted";
    await expect(
      requireProjectionAuthorized("task.link", { type: "task", id: "TASK-1" })
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("denies when enforcement is on and the principal row is missing", async () => {
    store.enforcement = true;
    store.principalPresent = false;
    await expect(
      requireProjectionAuthorized("task.progress", { type: "task", id: "TASK-1" })
    ).rejects.toMatchObject({ code: "forbidden", status: 403 });
  });
});

describe("projectPullRequest", () => {
  it("moves a checked-out task to progress on open", async () => {
    seedTask({ id: "TASK-100", stage: "planned" });
    await projectPullRequest(prEvt({ action: "opened" }), {
      actorKind: "agent",
      actorIdentity: "dsp_abc",
      taskIds: ["TASK-100"],
      sparse: false,
    });
    const row = store.rows.get("task:TASK-100")!;
    expect((row.data as unknown as Task).stage).toBe("progress");
    expect(store.authorizeCalls.some((c) => c.capability === "task.progress")).toBe(true);
  });

  it("promotes merged tasks with pr + merge metadata", async () => {
    seedTask({ id: "TASK-200", stage: "progress" });
    await projectPullRequest(
      prEvt({ action: "closed", merged: true, headSha: "deadbeef", mergeSha: "deadbeef" }),
      { actorKind: "agent", actorIdentity: "dsp_abc", taskIds: ["TASK-200"], sparse: false }
    );
    const task = store.rows.get("task:TASK-200")!.data as unknown as Task;
    expect(task.stage).toBe("merged");
    expect(task.prs).toMatchObject([{ repo: "PLX_MC", num: 42, status: "merged", title: "Add the thing" }]);
    expect(task.merge).toMatchObject({ sha: "deadbeef" });
    expect(store.events.some((e) => e.kind === "task.promoted" && e.taskId === "TASK-200")).toBe(true);
    expect(store.authorizeCalls.some((c) => c.capability === "task.link")).toBe(true);
  });

  it("does NOT create a sparse task for operator PRs with no checkout (retired)", async () => {
    await projectPullRequest(prEvt({ action: "opened" }), {
      actorKind: "operator",
      actorIdentity: "greg",
      taskIds: [],
      sparse: true,
    });
    expect(store.events.some((e) => e.kind === "task.sparse_created")).toBe(false);
    expect([...store.rows.keys()].filter((k) => k.startsWith("task:")).length).toBe(0);
  });

  it("skips Task mutation when projection authorize denies", async () => {
    seedTask({ id: "TASK-100", stage: "planned" });
    store.authorizeAllowed = false;
    store.authorizeReason = "actor_revoked";
    await expect(
      projectPullRequest(prEvt({ action: "opened" }), {
        actorKind: "agent",
        actorIdentity: "dsp_abc",
        taskIds: ["TASK-100"],
        sparse: false,
      })
    ).rejects.toBeInstanceOf(ApiError);
    expect((store.rows.get("task:TASK-100")!.data as unknown as Task).stage).toBe("planned");
  });

  it("is a no-op when projection is disabled", async () => {
    process.env.COMPLIANCE_PROJECTION_ENABLED = "0";
    seedTask({ id: "TASK-300", stage: "planned" });
    await projectPullRequest(prEvt(), {
      actorKind: "agent",
      actorIdentity: "dsp_abc",
      taskIds: ["TASK-300"],
      sparse: false,
    });
    expect((store.rows.get("task:TASK-300")!.data as unknown as Task).stage).toBe("planned");
  });

  it("does not regress tasks already in merged on synchronize", async () => {
    seedTask({ id: "TASK-400", stage: "merged", prs: [{ repo: "PLX_MC", num: 41, status: "merged", title: "prior" }] });
    await projectPullRequest(prEvt({ action: "synchronize" }), {
      actorKind: "agent",
      actorIdentity: "dsp_abc",
      taskIds: ["TASK-400"],
      sparse: false,
    });
    expect((store.rows.get("task:TASK-400")!.data as unknown as Task).stage).toBe("merged");
  });
});
