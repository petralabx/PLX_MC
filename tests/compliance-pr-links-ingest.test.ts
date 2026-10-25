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
  events: [] as { kind: string; taskId?: string | null; dedupKey?: string | null }[],
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
