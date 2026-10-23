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
    completedAtArgs: [] as (string | undefined)[],
    enforcement: false,
    principalStatus: "active" as "active" | "revoked",
    principalPresent: true,
    authorizeAllowed: true,
    authorizeReason: "allowed" as string,
    authorizeCalls: [] as { capability: string; actorId: string }[],
  };
});

vi.mock("@/lib/permissions/enforcement", () => ({
  resolveStagedServicePrincipal: async (id: string) => {
    if (!store.enforcement) {
      return {
        actor: { kind: "service", id, status: "active" },
        missing: false,
        shadowActor: null,
        shadowMissing: false,
        mode: "off",
      };
    }
    if (!store.principalPresent || id !== COMPLIANCE_PROJECTION_SERVICE_PRINCIPAL_ID) {
      return { actor: null, missing: true, shadowActor: null, shadowMissing: false, mode: "enforce" };
    }
    return {
      actor: { kind: "service", id, status: store.principalStatus },
      missing: false,
      shadowActor: null,
      shadowMissing: false,
      mode: "enforce",
    };
  },
  authorizeStaged: (input: { capability: string; appliedActor: { id: string } }) => {
    store.authorizeCalls.push({
      capability: input.capability,
      actorId: input.appliedActor.id,
    });
    return {
      allowed: store.authorizeAllowed,
      reasonCode: store.authorizeAllowed ? "allowed" : store.authorizeReason,
      policyVersion: "permissions.v2",
    };
  },
  recordUnresolvedActorDenial: () => {},
}));

// patchTask runs in a row-locked transaction; the repo seam is mocked, so the
// transaction hands through a query function. Transactions run one at a time,
// the way the task row lock serializes concurrent writers.
const tx = vi.hoisted(() => ({ chain: Promise.resolve() as Promise<unknown> }));
vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  withTransaction: <T,>(fn: (q: never) => Promise<T>) => {
    const run = tx.chain.then(() => fn((async () => []) as never));
    tx.chain = run.catch(() => undefined);
    return run;
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
    opts: { patch?: Record<string, unknown>; syncState?: string; dirtyFields?: string[]; completedAt?: string }
  ) {
    const row = store.rows.get(`${type}:${id}`);
    if (!row) return;
    store.completedAtArgs.push(opts.completedAt);
    row.data = { ...row.data, ...(opts.patch ?? {}) };
    if (opts.syncState !== undefined) row.sync_state = opts.syncState;
    if (opts.dirtyFields !== undefined) row.dirty_fields = opts.dirtyFields;
  },
  async appendAudit() {},
  async taskIdsWithPr(repoName: string, prNumber: number) {
    return [...store.rows.values()]
      .filter((r) => r.entity_type === "task")
      .filter((r) => ((r.data.prs ?? []) as { repo: string; num: number }[]).some((p) => p.repo.toLowerCase() === repoName.toLowerCase() && p.num === prNumber))
      .map((r) => r.id);
  },
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
  store.completedAtArgs.length = 0;
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

  it("never promotes or reopens a cancelled task; it records task.promotion_skipped instead (TASK-2529)", async () => {
    seedTask({ id: "TASK-210", stage: "cancelled" });
    await projectPullRequest(prEvt({ action: "opened" }), { actorKind: "agent", actorIdentity: "dsp_abc", taskIds: ["TASK-210"], sparse: false });
    await projectPullRequest(
      prEvt({ action: "closed", merged: true, headSha: "deadbeef", mergeSha: "deadbeef" }),
      { actorKind: "agent", actorIdentity: "dsp_abc", taskIds: ["TASK-210"], sparse: false }
    );
    const task = store.rows.get("task:TASK-210")!.data as unknown as Task;
    expect(task.stage).toBe("cancelled");
    expect(task.prs).toEqual([]);
    expect(store.completedAtArgs).toEqual([]);
    expect(store.events.filter((e) => e.kind === "task.promotion_skipped").map((e) => e.taskId)).toEqual(["TASK-210", "TASK-210"]);
    expect(store.events.some((e) => e.kind === "task.promoted")).toBe(false);
  });

  it("stamps completed_at with the PR merge time, not the projection run time", async () => {
    seedTask({ id: "TASK-201", stage: "progress" });
    await projectPullRequest(
      prEvt({ action: "closed", merged: true, mergeSha: "cafe", mergedAt: "2026-07-23T15:04:05Z" }),
      { actorKind: "agent", actorIdentity: "dsp_abc", taskIds: ["TASK-201"], sparse: false }
    );
    expect(store.completedAtArgs).toEqual(["2026-07-23T15:04:05.000Z"]);
    const promoted = store.events.find((e) => e.kind === "task.promoted");
    expect(promoted?.payload).toMatchObject({ stage: "merged", completionSource: "pr_merge" });
  });

  it("does not pass a completion time on PR open", async () => {
    seedTask({ id: "TASK-202", stage: "planned" });
    await projectPullRequest(prEvt({ action: "opened", mergedAt: "2026-07-23T15:04:05Z" }), {
      actorKind: "agent",
      actorIdentity: "dsp_abc",
      taskIds: ["TASK-202"],
      sparse: false,
    });
    // Open writes the stage and then the PR link (TASK-3743); neither carries a completion time.
    expect(store.completedAtArgs).toEqual([undefined, undefined]);
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

// TASK-3743: a task shows its open PRs before merge, one row per repo and PR.
describe("projectPullRequest — open PR links", () => {
  const agent = { actorKind: "agent" as const, actorIdentity: "dsp_abc", sparse: false };
  const taskOf = (id: string) => store.rows.get(`task:${id}`)!.data as unknown as Task;
  const row = (status: string) => ({ repo: "PLX_MC", num: 42, status, title: "Add the thing" });

  it("shows an opened draft PR as draft, then as open once marked ready", async () => {
    seedTask({ id: "TASK-600", stage: "planned" });
    await projectPullRequest(prEvt({ action: "opened", draft: true }), { ...agent, taskIds: ["TASK-600"] });
    expect(taskOf("TASK-600").prs).toEqual([row("draft")]);
    expect(taskOf("TASK-600").stage).toBe("progress");

    await projectPullRequest(prEvt({ action: "ready_for_review", draft: false }), { ...agent, taskIds: ["TASK-600"] });
    expect(taskOf("TASK-600").prs).toEqual([row("open")]);
    expect(store.authorizeCalls.some((c) => c.capability === "task.link")).toBe(true);
  });

  it("links the PR on a task that is already in progress", async () => {
    seedTask({ id: "TASK-601", stage: "progress" });
    await projectPullRequest(prEvt({ action: "opened" }), { ...agent, taskIds: ["TASK-601"] });
    expect(taskOf("TASK-601").prs).toEqual([row("open")]);
  });

  it("keeps one row per repo and PR number, and an unchanged replay writes nothing", async () => {
    seedTask({ id: "TASK-602", stage: "planned" });
    for (const action of ["opened", "synchronize", "reopened", "synchronize"]) {
      await projectPullRequest(prEvt({ action }), { ...agent, taskIds: ["TASK-602"] });
    }
    expect(taskOf("TASK-602").prs).toEqual([row("open")]);
    const writes = store.completedAtArgs.length;
    await projectPullRequest(prEvt({ action: "synchronize", headSha: "def456" }), { ...agent, taskIds: ["TASK-602"] });
    expect(store.completedAtArgs.length).toBe(writes);
  });

  it("shows a merged PR once as merged, with no stale open row, even after late replays", async () => {
    seedTask({ id: "TASK-603", stage: "planned" });
    await projectPullRequest(prEvt({ action: "opened" }), { ...agent, taskIds: ["TASK-603"] });
    await projectPullRequest(prEvt({ action: "closed", merged: true, mergeSha: "m1" }), { ...agent, taskIds: ["TASK-603"] });
    await projectPullRequest(prEvt({ action: "synchronize" }), { ...agent, taskIds: ["TASK-603"] });
    await projectPullRequest(prEvt({ action: "closed" }), { ...agent, taskIds: ["TASK-603"] });
    expect(taskOf("TASK-603").prs).toEqual([row("merged")]);
    expect(taskOf("TASK-603").stage).toBe("merged");
  });

  it("shows a closed unmerged PR as closed and leaves the stage alone", async () => {
    seedTask({ id: "TASK-604", stage: "planned" });
    await projectPullRequest(prEvt({ action: "opened" }), { ...agent, taskIds: ["TASK-604"] });
    await projectPullRequest(prEvt({ action: "closed" }), { ...agent, taskIds: ["TASK-604"] });
    expect(taskOf("TASK-604").prs).toEqual([row("closed")]);
    expect(taskOf("TASK-604").stage).toBe("progress");
  });

  it("treats the repo name case-insensitively, so a merge replaces the open row", async () => {
    seedTask({ id: "TASK-605", stage: "progress", prs: [{ repo: "plx_mc", num: 42, status: "open", title: "Add the thing" }] });
    await projectPullRequest(prEvt({ action: "closed", merged: true, mergeSha: "m1" }), { ...agent, taskIds: ["TASK-605"] });
    expect(taskOf("TASK-605").prs).toEqual([row("merged")]);
  });

  it("keeps other PRs on the task and links a new PR on a merged task without moving it", async () => {
    seedTask({ id: "TASK-606", stage: "merged", prs: [{ repo: "PLX_MC", num: 41, status: "merged", title: "prior" }] });
    await projectPullRequest(prEvt({ action: "opened" }), { ...agent, taskIds: ["TASK-606"] });
    expect(taskOf("TASK-606").prs).toEqual([{ repo: "PLX_MC", num: 41, status: "merged", title: "prior" }, row("open")]);
    expect(taskOf("TASK-606").stage).toBe("merged");
  });

  it("keeps both writes when a merge and another PR's ready land at the same time", async () => {
    seedTask({ id: "TASK-607", stage: "progress", prs: [{ repo: "PLX_MC", num: 42, status: "open", title: "Add the thing" }] });
    await Promise.all([
      projectPullRequest(prEvt({ action: "closed", merged: true, mergeSha: "m1" }), { ...agent, taskIds: ["TASK-607"] }),
      projectPullRequest(prEvt({ action: "ready_for_review", prNumber: 43, title: "Other" }), { ...agent, taskIds: ["TASK-607"] }),
    ]);
    expect(taskOf("TASK-607").prs).toEqual([row("merged"), { repo: "PLX_MC", num: 43, status: "open", title: "Other" }]);
    expect(taskOf("TASK-607").stage).toBe("merged");
  });
});
