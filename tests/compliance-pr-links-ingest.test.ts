// PR rows on tasks, end to end through ingestPullRequest and the real projection
// (TASK-3743 review fixes). A close or merge updates the row on every task that
// holds the PR, so a row never stays `open` after the PR closed: not when the
// checkout expired or was released, and not when the stamp moved to another task.
// The repo seams are mocked; transactions are serialized like a row lock.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PullRequest, Task } from "@/lib/mc-data";

type Dispatch = {
  id: string;
  actorKind: "agent";
  runtime: string;
  taskId: string;
  revoked: boolean;
  repo: string;
  expiresAt: string;
  releasedAt: string | null;
};

const h = vi.hoisted(() => ({
  rows: new Map<string, { entity_type: string; id: string; data: Record<string, unknown>; sync_state: string; sp_item_id: string | null; dirty_fields: string[] }>(),
  dispatches: new Map<string, Dispatch>(),
  events: [] as { kind: string; taskId?: string | null; dedupKey?: string | null; payload?: Record<string, unknown> }[],
  writes: [] as string[],
  tx: Promise.resolve() as Promise<unknown>,
}));

vi.mock("@/lib/permissions/enforcement", () => ({
  resolveStagedServicePrincipal: async (id: string) => ({
    actor: { kind: "service", id, status: "active" },
    missing: false,
    shadowActor: null,
    shadowMissing: false,
    mode: "off",
  }),
  authorizeStaged: () => ({ allowed: true, reasonCode: "allowed", policyVersion: "permissions.v2" }),
  recordUnresolvedActorDenial: () => {},
}));

vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  withTransaction: <T,>(fn: (q: never) => Promise<T>) => {
    const run = h.tx.then(() => fn((async () => []) as never));
    h.tx = run.catch(() => undefined);
    return run;
  },
}));

vi.mock("@/lib/sync/engine", () => ({
  ensureSeeded: vi.fn(async () => true),
  ensureReposSeeded: vi.fn(async () => true),
}));

vi.mock("@/lib/sync/repo", () => ({
  stamp: () => "2026.10.23 · 00:00",
  async getRepos() {
    return [{ id: "plx-mc", name: "PLX_MC", lang: "TypeScript", def: "main", owner: "petralabx", visibility: "public", scope: "" }];
  },
  async getEntity(type: string, id: string) {
    const row = h.rows.get(`${type}:${id}`);
    return row ? structuredClone(row) : null;
  },
  async updateEntity(type: string, id: string, opts: { patch?: Record<string, unknown> }) {
    const row = h.rows.get(`${type}:${id}`);
    if (!row) return;
    h.writes.push(id);
    row.data = { ...row.data, ...(opts.patch ?? {}) };
  },
  async taskIdsWithPr(repoName: string, prNumber: number) {
    return [...h.rows.values()]
      .filter((r) => r.entity_type === "task")
      .filter((r) => ((r.data.prs ?? []) as PullRequest[]).some((p) => p.repo.toLowerCase() === repoName.toLowerCase() && p.num === prNumber))
      .map((r) => r.id);
  },
  async appendAudit() {},
}));

vi.mock("@/lib/compliance/repo", () => ({
  async getDispatch(id: string) {
    const d = h.dispatches.get(id);
    return d ? { ...d } : null;
  },
  async renewDispatches() {},
  async unreleaseDispatches() {},
  async releaseDispatches(ids: string[]) {
    for (const id of ids) {
      const d = h.dispatches.get(id);
      if (d) d.releasedAt = new Date().toISOString();
    }
  },
  dispatchHeads: async () => [],
  recordDispatchHead: async () => true,
  openPrCandidatesForTask: async () => [],
  async appendEvent(e: { kind: string; taskId?: string | null; dedupKey?: string | null }) {
    h.events.push(e);
  },
  async eventTaskIdByDedupKey(key: string) {
    return h.events.find((e) => e.dedupKey === key)?.taskId ?? null;
  },
}));

import { ingestPullRequest } from "@/lib/compliance/service";
import { parsePullRequestEvent } from "@/lib/compliance/webhook";

const HOUR = 3_600_000;

function seedTask(id: string, over: Partial<Task> = {}): void {
  const data = { id, title: id, stage: "planned", repos: ["plx-mc"], prs: [], activity: [], ...over };
  h.rows.set(`task:${id}`, { entity_type: "task", id, data, sync_state: "synced", sp_item_id: "1", dirty_fields: [] });
}

function checkout(id: string, taskId: string): Dispatch {
  const d: Dispatch = {
    id,
    actorKind: "agent",
    runtime: "claude-code",
    taskId,
    revoked: false,
    repo: "petralabx/PLX_MC",
    expiresAt: new Date(Date.now() + HOUR).toISOString(),
    releasedAt: null,
  };
  h.dispatches.set(id, d);
  return d;
}

function pr(action: string, stamps: string[], over: Record<string, unknown> = {}) {
  return parsePullRequestEvent({
    action,
    repository: { name: "PLX_MC", full_name: "petralabx/PLX_MC" },
    pull_request: {
      number: 42,
      merged: false,
      title: "Add the thing",
      body: stamps.map((s) => `MC-Checkout: ${s}`).join("\n"),
      head: { sha: "abc123", ref: "feat/x" },
      user: { login: "greg" },
      labels: [],
      ...over,
    },
  })!;
}

const taskOf = (id: string) => h.rows.get(`task:${id}`)!.data as unknown as Task;
const statusOf = (id: string) => (taskOf(id).prs ?? []).map((p) => p.status);

beforeEach(() => {
  h.rows.clear();
  h.dispatches.clear();
  h.events.length = 0;
  h.writes.length = 0;
  delete process.env.COMPLIANCE_PROJECTION_ENABLED;
  delete process.env.COMPLIANCE_PR_TASK_LINK_ENABLED;
});

describe("ingestPullRequest — PR rows after close and merge", () => {
  it("(a) closes the row when the checkout expired before an unmerged close", async () => {
    seedTask("TASK-A");
    const d = checkout("dsp_a", "TASK-A");
    await ingestPullRequest(pr("opened", ["dsp_a"]));
    expect(statusOf("TASK-A")).toEqual(["open"]);

    d.expiresAt = new Date(Date.now() - 24 * HOUR).toISOString();
    await ingestPullRequest(pr("closed", ["dsp_a"]));
    expect(statusOf("TASK-A")).toEqual(["closed"]);
    expect(taskOf("TASK-A").stage).toBe("progress");
  });

  it("(b) closes the row when the checkout was released before an unmerged close", async () => {
    seedTask("TASK-A");
    const d = checkout("dsp_a", "TASK-A");
    await ingestPullRequest(pr("opened", ["dsp_a"]));
    d.releasedAt = new Date().toISOString();

    await ingestPullRequest(pr("closed", ["dsp_a"]));
    expect(statusOf("TASK-A")).toEqual(["closed"]);
    expect(taskOf("TASK-A").stage).toBe("progress");
  });

  it("(c) closes the rows of both tasks when the stamp moved from A to B before the close", async () => {
    seedTask("TASK-A");
    seedTask("TASK-B");
    checkout("dsp_a", "TASK-A");
    checkout("dsp_b", "TASK-B");
    await ingestPullRequest(pr("opened", ["dsp_a"]));
    await ingestPullRequest(pr("synchronize", ["dsp_b"], { head: { sha: "def456", ref: "feat/x" } }));
    expect(statusOf("TASK-A")).toEqual(["open"]);
    expect(statusOf("TASK-B")).toEqual(["open"]);

    await ingestPullRequest(pr("closed", ["dsp_b"], { head: { sha: "def456", ref: "feat/x" } }));
    expect(statusOf("TASK-A")).toEqual(["closed"]);
    expect(statusOf("TASK-B")).toEqual(["closed"]);
    expect([taskOf("TASK-A").stage, taskOf("TASK-B").stage]).toEqual(["progress", "progress"]);
  });

  it("(d) on merge, promotes only the stamped task; a stale row on another task turns closed, unpromoted", async () => {
    seedTask("TASK-A");
    seedTask("TASK-B");
    checkout("dsp_a", "TASK-A");
    checkout("dsp_b", "TASK-B");
    await ingestPullRequest(pr("opened", ["dsp_a"]));
    await ingestPullRequest(pr("synchronize", ["dsp_b"], { head: { sha: "def456", ref: "feat/x" } }));

    await ingestPullRequest(
      pr("closed", ["dsp_b"], { merged: true, merge_commit_sha: "m1", head: { sha: "def456", ref: "feat/x" } })
    );
    expect(statusOf("TASK-B")).toEqual(["merged"]);
    expect(taskOf("TASK-B").stage).toBe("merged");
    expect(statusOf("TASK-A")).toEqual(["closed"]);
    expect(taskOf("TASK-A").stage).toBe("progress");
    expect(taskOf("TASK-A").merge).toBeUndefined();
    expect(h.events.filter((e) => e.kind === "task.promoted").map((e) => e.taskId)).toEqual(["TASK-B"]);
  });

  it("never downgrades a merged row, never touches a cancelled task, and a replay writes nothing", async () => {
    seedTask("TASK-A");
    seedTask("TASK-M", { stage: "merged", prs: [{ repo: "PLX_MC", num: 42, status: "merged", title: "Add the thing" }] });
    seedTask("TASK-X", { stage: "cancelled", prs: [{ repo: "PLX_MC", num: 42, status: "open", title: "Add the thing" }] });
    checkout("dsp_a", "TASK-A");
    await ingestPullRequest(pr("opened", ["dsp_a"]));

    await ingestPullRequest(pr("closed", []));
    expect(statusOf("TASK-A")).toEqual(["closed"]);
    expect(statusOf("TASK-M")).toEqual(["merged"]);
    expect(statusOf("TASK-X")).toEqual(["open"]);
    expect(taskOf("TASK-X").stage).toBe("cancelled");

    const writes = h.writes.length;
    await ingestPullRequest(pr("closed", []));
    expect(h.writes.length).toBe(writes);
  });

  it("leaves every row alone when the projection kill switch is off", async () => {
    seedTask("TASK-A", { stage: "progress", prs: [{ repo: "PLX_MC", num: 42, status: "open", title: "Add the thing" }] });
    process.env.COMPLIANCE_PROJECTION_ENABLED = "0";
    await ingestPullRequest(pr("closed", []));
    expect(statusOf("TASK-A")).toEqual(["open"]);
    expect(h.writes).toEqual([]);
  });
});

// TASK-4004: a PR whose checkout resolves to no task links to the task its title,
// else its branch, names. The existing merge rule then moves that task to Merged.
describe("ingestPullRequest — link a PR to the task its title or branch names (TASK-4004)", () => {
  const titled = "Add the thing (TASK-4101)";
  const links = () => h.events.filter((e) => e.kind === "pr.task_link");
  const merge = (over: Record<string, unknown> = {}) => pr("closed", [], { merged: true, merge_commit_sha: "m1", ...over });

  it("links an unstamped PR to its title's task with no stage move, and the merge moves the task to Merged", async () => {
    seedTask("TASK-4101");
    await ingestPullRequest(pr("opened", [], { title: titled }));
    expect(statusOf("TASK-4101")).toEqual(["open"]);
    expect(taskOf("TASK-4101").stage).toBe("planned");
    expect(links()).toMatchObject([{ taskId: "TASK-4101", payload: { outcome: "resolved", source: "title", taskIds: ["TASK-4101"] } }]);

    await ingestPullRequest(merge({ title: titled }));
    expect(statusOf("TASK-4101")).toEqual(["merged"]);
    expect(taskOf("TASK-4101").stage).toBe("merged");
    expect(h.events.filter((e) => e.kind === "task.promoted").map((e) => e.taskId)).toEqual(["TASK-4101"]);

    // A replay of the merge still resolves to the task that now holds the PR.
    await ingestPullRequest(merge({ title: titled }));
    expect(taskOf("TASK-4101").stage).toBe("merged");
    expect(new Set(links().map((e) => e.dedupKey)).size).toBe(1);
  });

  it("never re-promotes a delivered task, or links a cancelled one, that a PR only names", async () => {
    const delivered = { sha: "d1", on: "2026-10-20" };
    seedTask("TASK-4104", { stage: "merged", merge: delivered, prs: [{ repo: "PLX_MC", num: 7, status: "merged", title: "Ship it", base: "main" }] });
    seedTask("TASK-4105", { stage: "cancelled" });
    await ingestPullRequest(merge({ title: "Follow-up to TASK-4104" }));
    await ingestPullRequest(pr("opened", [], { number: 43, title: "Retry TASK-4105" }));
    expect(taskOf("TASK-4104").merge).toEqual(delivered);
    expect(statusOf("TASK-4104")).toEqual(["merged"]);
    expect(statusOf("TASK-4105")).toEqual([]);
    expect(h.events.filter((e) => e.kind === "task.promoted")).toEqual([]);
    expect(links()).toMatchObject([
      { taskId: null, payload: { outcome: "task_closed", taskIds: ["TASK-4104"] } },
      { taskId: null, payload: { outcome: "task_closed", taskIds: ["TASK-4105"] } },
    ]);
  });

  it("records a revert that names a task and links nothing", async () => {
    seedTask("TASK-4101", { stage: "progress" });
    await ingestPullRequest(merge({ title: `Revert "${titled}"`, head: { sha: "abc123", ref: "revert-41-feat/x" } }));
    expect(statusOf("TASK-4101")).toEqual([]);
    expect(taskOf("TASK-4101").stage).toBe("progress");
    expect(links()).toMatchObject([{ taskId: null, payload: { outcome: "revert", source: "title", taskIds: ["TASK-4101"] } }]);
  });

  it("links nothing from a fork PR, and records the miss", async () => {
    seedTask("TASK-4101");
    await ingestPullRequest(pr("opened", [], { title: titled, head: { sha: "abc123", ref: "main", repo: { full_name: "outsider/PLX_MC" } } }));
    expect(statusOf("TASK-4101")).toEqual([]);
    expect(links()).toMatchObject([{ taskId: null, payload: { outcome: "fork", source: "title", taskIds: ["TASK-4101"] } }]);
  });

  it("on an unmerged close, adds no row to a task that never held the PR and closes the row it holds", async () => {
    seedTask("TASK-4101");
    await ingestPullRequest(pr("closed", [], { title: titled }));
    expect(statusOf("TASK-4101")).toEqual([]);
    expect(links()).toEqual([]);
    await ingestPullRequest(pr("reopened", [], { title: titled }));
    await ingestPullRequest(pr("closed", [], { title: titled }));
    expect(statusOf("TASK-4101")).toEqual(["closed"]);
    expect(taskOf("TASK-4101").stage).toBe("planned");
  });

  it("falls back to the branch when the title names no task", async () => {
    seedTask("TASK-4102");
    await ingestPullRequest(pr("opened", [], { head: { sha: "abc123", ref: "claude/task-4102-autolink" } }));
    expect(statusOf("TASK-4102")).toEqual(["open"]);
    expect(links()).toMatchObject([{ taskId: "TASK-4102", payload: { outcome: "resolved", source: "branch" } }]);
  });

  it("lets a resolving checkout win: the title's task stays unlinked and no link event is recorded", async () => {
    seedTask("TASK-A");
    seedTask("TASK-4101");
    checkout("dsp_a", "TASK-A");
    await ingestPullRequest(pr("opened", ["dsp_a"], { title: titled }));
    await ingestPullRequest(pr("closed", ["dsp_a"], { merged: true, merge_commit_sha: "m1", title: titled }));
    expect(taskOf("TASK-A").stage).toBe("merged");
    expect(statusOf("TASK-4101")).toEqual([]);
    expect(taskOf("TASK-4101").stage).toBe("planned");
    expect(links()).toEqual([]);
  });

  it("lets a stamp that resolves to no task still decide: the title's task is neither linked nor promoted", async () => {
    seedTask("TASK-4101");
    await ingestPullRequest(pr("opened", ["dsp_unknown"], { title: titled }));
    await ingestPullRequest(pr("closed", ["dsp_unknown"], { merged: true, merge_commit_sha: "m1", title: titled }));
    expect(statusOf("TASK-4101")).toEqual([]);
    expect(taskOf("TASK-4101").stage).toBe("planned");
    expect(links()).toEqual([]);
  });

  it("links nothing to a task of another repo, and records the miss", async () => {
    seedTask("TASK-4103", { repos: ["portal-web"] });
    await ingestPullRequest(pr("opened", [], { title: "Port the fix from TASK-4103" }));
    await ingestPullRequest(merge({ title: "Port the fix from TASK-4103" }));
    expect(statusOf("TASK-4103")).toEqual([]);
    expect(taskOf("TASK-4103").stage).toBe("planned");
    expect(links()[0]).toMatchObject({ taskId: null, payload: { outcome: "repo_mismatch", source: "title", taskIds: ["TASK-4103"] } });
  });

  it("links nothing for a title that names several tasks, records the miss, and the merge promotes neither", async () => {
    seedTask("TASK-4101");
    seedTask("TASK-4102");
    const title = "Add TASK-4101 and TASK-4102";
    await ingestPullRequest(pr("opened", [], { title, head: { sha: "abc123", ref: "feat/task-4101" } }));
    await ingestPullRequest(merge({ title }));
    expect([statusOf("TASK-4101"), statusOf("TASK-4102")]).toEqual([[], []]);
    expect([taskOf("TASK-4101").stage, taskOf("TASK-4102").stage]).toEqual(["planned", "planned"]);
    expect(links()[0]).toMatchObject({ taskId: null, payload: { outcome: "ambiguous", source: "title", taskIds: ["TASK-4101", "TASK-4102"] } });
    // One event: the replay carries the same dedup key, which mc_events stores once.
    expect(new Set(links().map((e) => e.dedupKey)).size).toBe(1);
  });

  it("links nothing for an unknown id, not even the branch's task, and records the miss", async () => {
    seedTask("TASK-4101");
    await ingestPullRequest(pr("opened", [], { title: "Add the thing (TASK-9999)", head: { sha: "abc123", ref: "feat/task-4101" } }));
    expect(statusOf("TASK-4101")).toEqual([]);
    expect(h.writes).toEqual([]);
    expect(links()).toMatchObject([{ taskId: null, payload: { outcome: "unknown_task", source: "title", taskIds: ["TASK-9999"] } }]);
  });

  it("is idempotent: a replayed open or a push to a linked PR writes nothing and keys its event the same", async () => {
    seedTask("TASK-4101");
    await ingestPullRequest(pr("opened", [], { title: titled }));
    const writes = h.writes.length;
    await ingestPullRequest(pr("opened", [], { title: titled }));
    await ingestPullRequest(pr("synchronize", [], { title: titled, head: { sha: "def456", ref: "feat/x" } }));
    expect(h.writes.length).toBe(writes);
    expect(statusOf("TASK-4101")).toEqual(["open"]);
    expect(new Set(links().map((e) => e.dedupKey)).size).toBe(1);
  });

  it("never passes a gate: a task waiting for creator approval gets no row and no promotion", async () => {
    seedTask("TASK-4101", { creatorApproval: { principal: "sp_bot", status: "pending", requestedAt: "2026-10-26T00:00:00Z" } });
    await ingestPullRequest(pr("opened", [], { title: titled }));
    await ingestPullRequest(merge({ title: titled }));
    expect(statusOf("TASK-4101")).toEqual([]);
    expect(taskOf("TASK-4101").stage).toBe("planned");
    expect(taskOf("TASK-4101").creatorApproval?.status).toBe("pending");
    expect(links()[0]).toMatchObject({ taskId: null, payload: { outcome: "creator_approval_pending", taskIds: ["TASK-4101"] } });
  });

  it.each(["COMPLIANCE_PROJECTION_ENABLED", "COMPLIANCE_PR_TASK_LINK_ENABLED"])(
    "links nothing and records nothing while %s=0",
    async (flag) => {
      seedTask("TASK-4101");
      process.env[flag] = "0";
      await ingestPullRequest(pr("opened", [], { title: titled }));
      await ingestPullRequest(merge({ title: titled }));
      expect(statusOf("TASK-4101")).toEqual([]);
      expect(taskOf("TASK-4101").stage).toBe("planned");
      expect(links()).toEqual([]);
    }
  );

  it("keeps stamped projection while only the link switch is off", async () => {
    seedTask("TASK-A");
    checkout("dsp_a", "TASK-A");
    process.env.COMPLIANCE_PR_TASK_LINK_ENABLED = "0";
    await ingestPullRequest(pr("opened", ["dsp_a"], { title: titled }));
    expect(statusOf("TASK-A")).toEqual(["open"]);
  });
});
