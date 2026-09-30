// Frontier P16 (D4): verifyPr in merge_group mode. The merge queue re-runs the
// gate on the PR head that already passed, so an expired stamp passes only on a
// prior pass for that repo, PR, head and task, and merge_group mode never reads
// GitHub (loadPrState). pull_request mode keeps the TASK-2011 open-PR rule.
// The mocks are those of tests/compliance-server.test.ts (the in-memory repo and
// sync seams), so this exercises the real stamp resolution.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Task } from "@/lib/mc-data";

const github = vi.hoisted(() => ({ loadPrState: vi.fn() }));
vi.mock("@/lib/compliance/github-pr", () => github);

const db = vi.hoisted(() => ({
  dispatches: new Map<string, { id: string; actorKind: "agent" | "operator"; runtime: string; taskId: string; accountableHuman: string; repo: string; revoked: boolean; expiresAt: string; releasedAt?: string | null; releasedReason?: string | null }>(),
  events: [] as { kind: string; actor: string; repo?: string | null; taskId?: string | null; pr?: string | null; payload?: Record<string, unknown> }[],
  checks: [] as { id: string; verdict: string; reasons: string[]; actorKind: string; taskId: string | null }[],
  tasks: new Map<string, Task>(),
  dedupKeys: new Set<string>(),
  reconcile: [] as { kind: string; payload: Record<string, unknown> }[],
  bucketsThrow: false,
  checksThrow: false,
  buckets: [
    { id: "BKT-WMS", name: "WMS", owner: "vince", health: "track" as const, target: "Jun 15", started: "2026.06.11", desc: "", repos: [], sync: { state: "synced" as const, ts: "—", sp: "—" }, prd: null as string | null, project: null },
    { id: "BKT-PRD", name: "With PRD", owner: "vince", health: "track" as const, target: "Jun 15", started: "2026.06.11", desc: "", repos: [], sync: { state: "synced" as const, ts: "—", sp: "—" }, prd: "https://example.com/prd.md", project: null },
  ],
}));

vi.mock("@/lib/compliance/repo", () => ({
  async releaseDispatches(ids: string[], input: { repo: string; pr: number; reason: string }) {
    for (const id of ids) {
      const d = db.dispatches.get(id)!;
      if (d.revoked || d.releasedAt || d.repo !== input.repo) continue;
      d.releasedAt = new Date().toISOString();
      d.releasedReason = input.reason;
      db.events.push({ kind: "checkout.released", actor: d.runtime, taskId: d.taskId });
    }
  },
  async unreleaseDispatches(ids: string[]) {
    for (const id of ids) {
      const d = db.dispatches.get(id)!;
      if (!d.revoked) { d.releasedAt = null; d.releasedReason = null; }
    }
  },
  async eventTaskIdByDedupKey(key: string) {
    return db.dedupKeys.has(key) ? "TASK-900" : null;
  },
  async insertDispatch(d: { id: string; actorKind: "agent" | "operator"; runtime: string; taskId: string; accountableHuman: string; repo: string }) {
    db.dispatches.set(d.id, { ...d, revoked: false, expiresAt: new Date(Date.now() + 3_600_000).toISOString() });
  },
  async getDispatch(id: string) {
    return db.dispatches.get(id) ?? null;
  },
  async appendEvent(e: { kind: string; actor: string; repo?: string | null; taskId?: string | null; pr?: string | null; payload?: Record<string, unknown>; dedupKey?: string | null }) {
    if (e.dedupKey) {
      if (db.dedupKeys.has(e.dedupKey)) return;
      db.dedupKeys.add(e.dedupKey);
    }
    db.events.push(e);
  },
  async recordCheck(c: { id: string; verdict: string; reasons: string[]; actorKind: string; taskId: string | null }) {
    if (db.checksThrow) throw new Error("db down");
    const i = db.checks.findIndex((x) => x.id === c.id);
    if (i >= 0) db.checks[i] = c;
    else db.checks.push(c);
  },
  async enqueueReconcile(kind: string, payload: Record<string, unknown>) {
    db.reconcile.push({ kind, payload });
  },
  async eventsAfter() {
    return db.events.map((e, i) => ({ seq: String(i + 1), ts: "t", pr: null, repo: null, taskId: null, payload: {}, ...e }));
  },
  async latestCheckoutDoor() {
    const last = [...db.events].reverse().find((e) => e.kind === "checkout");
    const door = last?.payload?.door;
    return typeof door === "string" && door.length > 0 ? door : null;
  },
}));

vi.mock("@/lib/sync/repo", () => ({
  async getEntity(type: string, id: string) {
    const t = db.tasks.get(id);
    return t ? { entity_type: type, id, data: t, sync_state: "synced", sp_item_id: null, dirty_fields: [] } : null;
  },
  async getBuckets() {
    if (db.bucketsThrow) throw new Error("db down");
    return db.buckets;
  },
}));

vi.mock("@/lib/sync", () => ({
  actorIdByEmail(email: string) {
    return email.toLowerCase() === "greg.m@petrasoap.com" ? "greg" : null;
  },
  async patchTask(taskId: string, patch: Partial<Task>) {
    const task = db.tasks.get(taskId);
    if (!task) return null;
    const updated = { ...task, ...patch };
    db.tasks.set(taskId, updated);
    return updated;
  },
  snapshot: vi.fn(),
}));

// Imported AFTER the mocks so the service's `import * as repo` + sync getEntity
// resolve to the mocked modules.
import { verifyPr, verifyPrOrQueue } from "@/lib/compliance/service";

const projection = vi.hoisted(() => ({ projectPullRequest: vi.fn() }));
vi.mock("@/lib/compliance/projection", () => ({
  projectionEnabled: () => true,
  projectPullRequest: projection.projectPullRequest,
}));

const taskish = (over: Partial<Task>): Task => ({
  id: "TASK-900",
  title: "t",
  bucket: "BKT-WMS",
  stage: "progress",
  priority: "medium",
  assignee: "vibes",
  coassignees: [],
  reporter: "vince",
  accountableOwner: "greg",
  reqs: [],
  repos: [],
  estimate: "M",
  labels: [],
  prs: [],
  due: "—",
  sync: { state: "pending", ts: "—", sp: "—" },
  subtasks: [],
  activity: [],
  ...over,
});

beforeEach(() => {
  projection.projectPullRequest.mockReset();
  github.loadPrState.mockReset().mockResolvedValue({ open: true, checkoutIds: ["dsp_old"] });
  db.dispatches.clear();
  db.events.length = 0;
  db.checks.length = 0;
  db.tasks.clear();
  db.dedupKeys.clear();
  db.reconcile.length = 0;
  db.bucketsThrow = false;
  db.checksThrow = false;
  const withPrd = db.buckets.find((bucket) => bucket.id === "BKT-PRD");
  if (withPrd) withPrd.prd = "https://example.com/prd.md";
  delete process.env.PLX_MC_COMPLIANCE_FULL_REPO_BINDING_ENABLED;
});

describe("verifyPr in merge_group mode (frontier P16)", () => {
  const pullRequest = { repo: "PLX_MC", repoFullName: "petralabx/PLX_MC", prNumber: 2011, headSha: "head", changedPaths: ["src/x.ts"], checkoutId: "dsp_old" };
  const queue = { ...pullRequest, event: "merge_group" as const };
  // The gate's pass key for this repo, PR, head and task (gateDedupKey in service.ts).
  const priorPass = "gate:PLX_MC:2011:head:TASK-900:pass";
  const live = () => new Date(Date.now() + 3_600_000).toISOString();

  beforeEach(() => {
    db.tasks.set("TASK-900", taskish({ evidence: { summary: "ok", items: [{ key: "test", label: "tests", done: true }], rollback: "revert" } }));
    db.dispatches.set("dsp_old", {
      id: "dsp_old", actorKind: "agent", runtime: "codex", taskId: "TASK-900",
      accountableHuman: "vince", repo: pullRequest.repoFullName, revoked: false,
      expiresAt: new Date(Date.now() - 1000).toISOString(), releasedAt: null,
    });
  });

  it("merge_group: an expired stamp with a prior pass on the same head passes without loadPrState", async () => {
    db.dedupKeys.add(priorPass);
    const result = await verifyPr(queue);
    expect(result).toMatchObject({ verdict: "pass", taskId: "TASK-900" });
    expect(github.loadPrState).not.toHaveBeenCalled();
  });

  it("merge_group: an expired stamp with no prior pass blocks without loadPrState", async () => {
    github.loadPrState.mockResolvedValue({ open: true, checkoutIds: ["dsp_old"] });
    const result = await verifyPr(queue);
    expect(result.verdict).toBe("block");
    expect(result.tasks[0].reasons).toEqual(["checkout expired — re-checkout"]);
    expect(github.loadPrState).not.toHaveBeenCalled();
  });

  it("merge_group: a prior pass on another head does not rescue an expired stamp", async () => {
    db.dedupKeys.add("gate:PLX_MC:2011:other:TASK-900:pass");
    db.dedupKeys.add("gate:PLX_MC:2011:head:TASK-900:block");
    const result = await verifyPr(queue);
    expect(result.tasks[0].reasons).toEqual(["checkout expired — re-checkout"]);
    expect(github.loadPrState).not.toHaveBeenCalled();
  });

  it("merge_group: a released stamp blocks as released without loadPrState", async () => {
    Object.assign(db.dispatches.get("dsp_old")!, { expiresAt: live(), releasedAt: new Date().toISOString() });
    db.dedupKeys.add(priorPass);
    const result = await verifyPr(queue);
    expect(result.verdict).toBe("block");
    expect(result.tasks[0].reasons).toEqual(["checkout released — re-checkout the task"]);
    expect(github.loadPrState).not.toHaveBeenCalled();
  });

  it.each([
    ["revoked", "checkout revoked — re-checkout the task"],
    ["repo", "checkout is bound to another repo"],
    ["unknown", "unknown checkout — re-checkout the task"],
  ])("merge_group: a %s stamp blocks before the prior-pass lookup", async (condition, reason) => {
    db.dedupKeys.add(priorPass);
    const d = db.dispatches.get("dsp_old")!;
    if (condition === "revoked") d.revoked = true;
    if (condition === "repo") d.repo = "foreign/PLX_MC";
    if (condition === "unknown") db.dispatches.delete("dsp_old");
    const result = await verifyPr(queue);
    expect(result.tasks[0].reasons).toEqual([reason]);
    expect(github.loadPrState).not.toHaveBeenCalled();
  });

  it.each([
    ["verified", "task is already verified"],
    ["deleted", "task deleted — re-register"],
  ])("merge_group: a %s task still blocks after a prior pass", async (condition, reason) => {
    db.dedupKeys.add(priorPass);
    if (condition === "verified") db.tasks.get("TASK-900")!.stage = "verified";
    if (condition === "deleted") db.tasks.delete("TASK-900");
    const result = await verifyPr(queue);
    expect(result.tasks[0].reasons).toEqual([reason]);
    expect(github.loadPrState).not.toHaveBeenCalled();
  });

  it("merge_group: a live stamp passes without loadPrState and replaces the check row", async () => {
    db.dispatches.get("dsp_old")!.expiresAt = live();
    expect((await verifyPr(pullRequest)).verdict).toBe("pass");
    expect((await verifyPr(queue)).verdict).toBe("pass");
    expect(db.checks).toHaveLength(1);
    expect(db.events.filter((e) => e.kind === "gate.passed")).toHaveLength(1);
    expect(github.loadPrState).not.toHaveBeenCalled();
  });

  it("merge_group support leaves the pull_request expiry rule unchanged", async () => {
    db.dedupKeys.add(priorPass);
    expect(await verifyPr(pullRequest)).toMatchObject({ verdict: "pass", taskId: "TASK-900" });
    expect(github.loadPrState).toHaveBeenCalledExactlyOnceWith(pullRequest.repoFullName, pullRequest.prNumber);

    github.loadPrState.mockResolvedValue({ open: false, checkoutIds: ["dsp_old"] });
    expect((await verifyPr({ ...pullRequest, event: "pull_request" })).tasks[0].reasons).toEqual(["pull request is not open"]);

    github.loadPrState.mockResolvedValue({ open: true, checkoutIds: ["dsp_other"] });
    expect((await verifyPr(pullRequest)).tasks[0].reasons).toEqual(["checkout stamp is not in the pull request body"]);
  });

  it("merge_group: a failed verify queues the whole input, so a replay keeps the mode", async () => {
    db.checksThrow = true;
    db.dedupKeys.add(priorPass);
    expect(await verifyPrOrQueue(queue)).toMatchObject({ verdict: "pending", queued: true });
    expect(db.reconcile).toEqual([{ kind: "verify", payload: queue }]);
  });
});
