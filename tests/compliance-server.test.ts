// EN-007 P1b — the compliance service (checkout / verify / complete) proven
// without a live database. The repo + sync seams are mocked in-memory (the same
// technique as tests/mc-patch.test.ts), so this exercises the real orchestration:
// tier classification, actor/task resolution from the dispatch ledger, the
// verdict, and the recorded check + emitted events.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Task } from "@/lib/mc-data";
import type { PrEvent } from "@/lib/compliance/webhook";

const github = vi.hoisted(() => ({ loadPrState: vi.fn(), loadPrCommits: vi.fn(), githubHeadDescendsFrom: vi.fn() }));
vi.mock("@/lib/compliance/github-pr", () => github);

const db = vi.hoisted(() => ({
  dispatches: new Map<string, { id: string; actorKind: "agent" | "operator"; runtime: string; taskId: string; accountableHuman: string; repo: string; revoked: boolean; expiresAt: string; launcherId?: string | null; releasedAt?: string | null; releasedReason?: string | null }>(),
  events: [] as { kind: string; actor: string; repo?: string | null; taskId?: string | null; pr?: string | null; payload?: Record<string, unknown> }[],
  checks: [] as { id: string; verdict: string; reasons: string[]; actorKind: string; taskId: string | null }[],
  tasks: new Map<string, Task>(),
  dedupKeys: new Set<string>(),
  heads: new Map<string, { headSha: string; beforeSha: string | null; pr: number | null; source: "launcher" | "webhook" | "gate"; recordedBy: string; recordedAt: string }[]>(),
  /** Another PR that binds the head between the gate's read and its bind (a race). */
  bindRace: null as number | null,
  bucketsThrow: false,
  buckets: [
    { id: "BKT-WMS", name: "WMS", owner: "vince", health: "track" as const, target: "Jun 15", started: "2026.06.11", desc: "", repos: [], sync: { state: "synced" as const, ts: "—", sp: "—" }, prd: null as string | null, project: null },
    { id: "BKT-PRD", name: "With PRD", owner: "vince", health: "track" as const, target: "Jun 15", started: "2026.06.11", desc: "", repos: [], sync: { state: "synced" as const, ts: "—", sp: "—" }, prd: "https://example.com/prd.md", project: null },
  ],
}));

vi.mock("@/lib/compliance/repo", () => ({
  async liveDispatchesForTask(taskId: string, repoSlug: string) {
    return [...db.dispatches.values()].filter((d) => d.taskId === taskId && d.repo.toLowerCase() === repoSlug.toLowerCase() && !d.revoked && !(d as { releasedAt?: string | null }).releasedAt && new Date(d.expiresAt).getTime() > Date.now());
  },
  async renewDispatches(ids: string[], input: { repo: string; ttlMinutes: number }) {
    for (const id of ids) {
      const d = db.dispatches.get(id);
      if (!d || d.revoked || (d as { releasedAt?: string | null }).releasedAt || d.repo.toLowerCase() !== input.repo.toLowerCase()) continue;
      d.expiresAt = new Date(Math.max(new Date(d.expiresAt).getTime(), Date.now() + input.ttlMinutes * 60_000)).toISOString();
      db.events.push({ kind: "checkout.renewed", actor: d.runtime, taskId: d.taskId, payload: { checkoutId: id } });
    }
  },
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
  async dispatchHeads(id: string) {
    return [...(db.heads.get(id) ?? [])];
  },
  async recordDispatchHead(h: { dispatchId: string; headSha: string; beforeSha: string | null; pr: number | null; source: "launcher" | "webhook" | "gate"; recordedBy: string }) {
    const chain = db.heads.get(h.dispatchId) ?? [];
    if (!db.dispatches.has(h.dispatchId) || chain.some((x) => x.headSha === h.headSha)) return false;
    chain.push({ headSha: h.headSha, beforeSha: h.beforeSha, pr: h.pr, source: h.source, recordedBy: h.recordedBy, recordedAt: new Date().toISOString() });
    db.heads.set(h.dispatchId, chain);
    db.events.push({ kind: "checkout.head", actor: h.recordedBy, payload: { checkoutId: h.dispatchId, headSha: h.headSha, source: h.source } });
    return true;
  },
  async bindDispatchHeadPr(b: { dispatchId: string; headSha: string; pr: number; recordedBy: string }) {
    const row = (db.heads.get(b.dispatchId) ?? []).find((x) => x.headSha === b.headSha);
    if (!row) return null;
    if (db.bindRace !== null && row.pr === null) row.pr = db.bindRace;
    if (row.pr !== null) return row.pr;
    row.pr = b.pr;
    db.events.push({ kind: "checkout.head_bound", actor: b.recordedBy, payload: { checkoutId: b.dispatchId, headSha: b.headSha } });
    return row.pr;
  },
  async appendEvent(e: { kind: string; actor: string; repo?: string | null; taskId?: string | null; pr?: string | null; payload?: Record<string, unknown>; dedupKey?: string | null }) {
    if (e.dedupKey) {
      if (db.dedupKeys.has(e.dedupKey)) return;
      db.dedupKeys.add(e.dedupKey);
    }
    db.events.push(e);
  },
  async recordCheck(c: { id: string; verdict: string; reasons: string[]; actorKind: string; taskId: string | null }) {
    const i = db.checks.findIndex((x) => x.id === c.id);
    if (i >= 0) db.checks[i] = c;
    else db.checks.push(c);
  },
  async eventsAfter() {
    return db.events.map((e, i) => ({ seq: String(i + 1), ts: "t", pr: null, repo: null, taskId: null, payload: {}, ...e }));
  },
  async getDispatchCheckoutAgent(id: string) {
    const agent = db.events.find((e) => e.kind === "checkout" && e.payload?.checkoutId === id)?.payload?.agent;
    return typeof agent === "string" ? agent : null;
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
import { checkout, complete, dispatchRepoMatches, ingestPullRequest, recordCheckoutHead, verifyPr } from "@/lib/compliance/service";

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
  github.loadPrCommits.mockReset().mockResolvedValue([]);
  github.githubHeadDescendsFrom.mockReset().mockResolvedValue(false);
  db.dispatches.clear();
  db.events.length = 0;
  db.checks.length = 0;
  db.tasks.clear();
  db.dedupKeys.clear();
  db.heads.clear();
  db.bindRace = null;
  db.bucketsThrow = false;
  const withPrd = db.buckets.find((bucket) => bucket.id === "BKT-PRD");
  if (withPrd) withPrd.prd = "https://example.com/prd.md";
  delete process.env.PLX_MC_COMPLIANCE_FULL_REPO_BINDING_ENABLED;
});

describe("open PR checkout lifetime (TASK-2011)", () => {
  const input = { repo: "petralabx/PLX_MC", repoFullName: "petralabx/PLX_MC", prNumber: 2011, headSha: "head", changedPaths: ["src/x.ts"], checkoutId: "dsp_old" };
  const event = (over: Partial<PrEvent> = {}): PrEvent => ({
    ...input, action: "synchronize", merged: false, branch: "fix", title: "fix",
    author: "agent", labels: [], checkoutIds: ["dsp_old"], ...over,
  });
  beforeEach(() => {
    db.tasks.set("TASK-900", taskish({ evidence: { summary: "ok", items: [{ key: "test", label: "tests", done: true }], rollback: "revert" } }));
    db.dispatches.set("dsp_old", {
      id: "dsp_old", actorKind: "agent", runtime: "codex", taskId: "TASK-900",
      accountableHuman: "vince", repo: input.repoFullName, revoked: false,
      expiresAt: new Date(Date.now() - 1000).toISOString(), releasedAt: null,
    });
  });

  it.each(["progress", "merged"] as const)("accepts expired attachments for a %s task", async (stage) => {
    db.tasks.get("TASK-900")!.stage = stage;
    expect(await verifyPr(input)).toMatchObject({ verdict: "pass", taskId: "TASK-900" });
    expect(github.loadPrState).toHaveBeenCalledExactlyOnceWith(input.repoFullName, input.prNumber);
  });

  it.each([
    ["revoked", "checkout revoked — re-checkout the task"],
    ["released", "checkout released — re-checkout the task"],
    ["repo", "checkout requires matching full owner/name identities; bare names are rejected"],
    ["closed", "pull request is not open"],
    ["stamp", "checkout stamp is not in the pull request body"],
    ["verified", "task is already verified"],
    ["deleted", "task deleted — re-register"],
  ])("blocks %s with its distinct reason", async (condition, reason) => {
    const d = db.dispatches.get("dsp_old")!;
    if (condition === "revoked") d.revoked = true;
    if (condition === "released") d.releasedAt = new Date().toISOString();
    if (condition === "repo") d.repo = "foreign/PLX_MC";
    if (condition === "closed") github.loadPrState.mockResolvedValue({ open: false, checkoutIds: [d.id] });
    if (condition === "stamp") github.loadPrState.mockResolvedValue({ open: true, checkoutIds: ["dsp_other"] });
    if (condition === "verified") db.tasks.get("TASK-900")!.stage = "verified";
    if (condition === "deleted") db.tasks.delete("TASK-900");
    const result = await verifyPr(input);
    expect(result.verdict).toBe("block");
    expect(result.tasks[0].reasons).toEqual([reason]);
    if (["revoked", "released", "repo"].includes(condition)) expect(github.loadPrState).not.toHaveBeenCalled();
  });

  it("fails closed on GitHub outage only for expired checkouts", async () => {
    github.loadPrState.mockRejectedValue(new Error("GitHub down"));
    await expect(verifyPr(input)).rejects.toThrow("GitHub down");
    await expect(ingestPullRequest(event())).rejects.toThrow("GitHub down");
    expect(db.checks).toHaveLength(0);
    github.loadPrState.mockClear();
    db.dispatches.get("dsp_old")!.expiresAt = new Date(Date.now() + 3600000).toISOString();
    expect((await verifyPr(input)).verdict).toBe("pass");
    expect(github.loadPrState).not.toHaveBeenCalled();
  });

  it("blocks released unexpired checkouts without a GitHub read", async () => {
    Object.assign(db.dispatches.get("dsp_old")!, { expiresAt: new Date(Date.now() + 3600000).toISOString(), releasedAt: new Date().toISOString() });
    expect((await verifyPr(input)).tasks[0].reasons).toEqual(["checkout released — re-checkout the task"]);
    expect(github.loadPrState).not.toHaveBeenCalled();
  });

  it("names a deleted task on a live checkout", async () => {
    db.dispatches.get("dsp_old")!.expiresAt = new Date(Date.now() + 3_600_000).toISOString();
    db.tasks.delete("TASK-900");
    const result = await verifyPr(input);
    expect(result.verdict).toBe("block");
    expect(result.tasks[0]).toMatchObject({
      taskId: "TASK-900",
      reasons: ["task deleted — re-register"],
    });
    expect(result.reasons.join(" ")).not.toMatch(/no checked-out/);
    expect(github.loadPrState).not.toHaveBeenCalled();
  });

  it("loads live state once for all expired stamps", async () => {
    db.tasks.set("TASK-901", taskish({ ...db.tasks.get("TASK-900"), id: "TASK-901" }));
    db.dispatches.set("dsp_second", { ...db.dispatches.get("dsp_old")!, id: "dsp_second", taskId: "TASK-901" });
    github.loadPrState.mockResolvedValue({ open: true, checkoutIds: ["dsp_old", "dsp_second"] });
    const result = await verifyPr({ ...input, checkoutIds: ["dsp_old", "dsp_second"] });
    expect(result.verdict).toBe("pass");
    expect(result.tasks.map((t) => t.taskId)).toEqual(["TASK-900", "TASK-901"]);
    expect(github.loadPrState).toHaveBeenCalledTimes(1);
  });

  it("attributes synchronize with an expired open attachment", async () => {
    expect(await ingestPullRequest(event())).toMatchObject({ taskId: "TASK-900" });
    expect(db.events.find((e) => e.kind === "pr.synchronized")?.taskId).toBe("TASK-900");
  });

  it.each([true, false])("releases closed merged=%s after attribution and projection", async (merged) => {
    await verifyPr(input);
    projection.projectPullRequest.mockImplementation(async () => {
      expect(db.dispatches.get("dsp_old")!.releasedAt).toBeNull();
      if (merged) expect(db.events.find((e) => e.kind === "task.promotion.requested")?.taskId).toBe("TASK-900");
    });
    github.loadPrState.mockClear();
    const result = await ingestPullRequest(event({ action: "closed", merged }));
    if (merged) expect(result.taskId).toBe("TASK-900");
    expect(db.dispatches.get("dsp_old")).toMatchObject({ revoked: false, releasedReason: merged ? "merged" : "closed", releasedAt: expect.any(String) });
    expect(db.events.at(-1)?.kind).toBe("checkout.released");
    expect(github.loadPrState).not.toHaveBeenCalled();
  });

  it("retains exact-head merge attribution after release, but rejects a different head", async () => {
    await verifyPr(input);
    await ingestPullRequest(event({ action: "closed", merged: true }));
    expect((await ingestPullRequest(event({ action: "closed", merged: true }))).taskId).toBe("TASK-900");
    expect((await ingestPullRequest(event({ action: "closed", merged: true, headSha: "other" }))).taskId).toBeNull();
    db.dispatches.get("dsp_old")!.revoked = true;
    expect((await ingestPullRequest(event({ action: "closed", merged: true }))).taskId).toBeNull();
  });

  it("un-releases on reopen and releases again on another close", async () => {
    await ingestPullRequest(event({ action: "closed" }));
    expect((await ingestPullRequest(event({ action: "reopened" }))).taskId).toBe("TASK-900");
    expect(db.dispatches.get("dsp_old")).toMatchObject({ releasedAt: null, releasedReason: null });
    expect((await verifyPr(input)).verdict).toBe("pass");
    await ingestPullRequest(event({ action: "closed" }));
    expect(db.events.filter((e) => e.kind === "checkout.released")).toHaveLength(2);
  });

  it.each(["revoked", "repo"])("does not un-release a %s checkout", async (condition) => {
    const d = db.dispatches.get("dsp_old")!;
    d.releasedAt = "2026-09-27T00:00:00Z";
    if (condition === "revoked") d.revoked = true;
    else d.repo = "foreign/PLX_MC";
    await ingestPullRequest(event({ action: "reopened" }));
    expect(d.releasedAt).toBe("2026-09-27T00:00:00Z");
    expect(github.loadPrState).not.toHaveBeenCalled();
  });
});

describe("checkout", () => {
  it("mints a dispatch credential and emits a checkout event", async () => {
    const { checkoutId } = await checkout({
      taskId: "TASK-900",
      runtime: "cursor-cloud",
      accountableHuman: "vince",
      repo: "petralabx/PLX_MC",
    });
    expect(checkoutId).toMatch(/^dsp_/);
    expect(db.dispatches.get(checkoutId)).toMatchObject({ taskId: "TASK-900", actorKind: "agent", accountableHuman: "vince" });
    expect(db.events.some((e) => e.kind === "checkout")).toBe(true);
  });

  it("records door provenance on the checkout audit payload (P5)", async () => {
    await checkout({
      taskId: "TASK-900",
      runtime: "cursor",
      accountableHuman: "vince",
      repo: "petralabx/PLX_MC",
      door: "mcp",
    });
    expect(db.events.at(-1)?.payload).toMatchObject({ door: "mcp", actorKind: "agent" });

    await checkout({
      taskId: "TASK-900",
      runtime: "cursor",
      accountableHuman: "vince",
      repo: "petralabx/PLX_MC",
      door: "compliance",
    });
    expect(db.events.at(-1)?.payload).toMatchObject({ door: "compliance" });
  });

  it("backfills a null accountable owner from the dispatching human", async () => {
    db.tasks.set("TASK-900", taskish({ accountableOwner: null }));

    await checkout({
      taskId: "TASK-900",
      runtime: "cursor",
      accountableHuman: "greg.m@petrasoap.com",
      repo: "petralabx/PLX_MC",
    });

    expect(db.tasks.get("TASK-900")?.accountableOwner).toBe("greg");
  });

  it("preserves an existing accountable owner", async () => {
    db.tasks.set("TASK-900", taskish({ accountableOwner: "stephen" }));

    await checkout({
      taskId: "TASK-900",
      runtime: "cursor",
      accountableHuman: "greg.m@petrasoap.com",
      repo: "petralabx/PLX_MC",
    });

    expect(db.tasks.get("TASK-900")?.accountableOwner).toBe("stephen");
  });

  it("defaults COS dispatches to Vince instead of treating COS as human", async () => {
    db.tasks.set("TASK-900", taskish({ accountableOwner: null }));

    await checkout({
      taskId: "TASK-900",
      runtime: "cursor",
      accountableHuman: "cos@petrasoap.com",
      repo: "petralabx/PLX_MC",
    });

    expect(db.tasks.get("TASK-900")?.accountableOwner).toBe("vince");
  });
});

describe("verifyPr — resolves actor/task from the checkout, not git", () => {
  it("blocks an agent PR whose task has an incomplete bundle, and records it", async () => {
    db.tasks.set("TASK-900", taskish({ accountableOwner: "greg", evidence: { summary: "x", items: [{ key: "a", label: "a", done: false }] } }));
    const { checkoutId } = await checkout({ taskId: "TASK-900", runtime: "cursor-cloud", accountableHuman: "vince", repo: "petralabx/PLX_MC" });

    const r = await verifyPr({ repo: "petralabx/PLX_MC", prNumber: 7, headSha: "abc", changedPaths: ["src/lib/x.ts"], checkoutId });
    expect(r.actorKind).toBe("agent");
    expect(r.tier).toBe("standard");
    expect(r.verdict).toBe("block");
    expect(db.checks.at(-1)).toMatchObject({ verdict: "block", actorKind: "agent" });
    expect(db.events.some((e) => e.kind === "gate.blocked")).toBe(true);
  });

  it("passes an agent PR with a complete standard bundle + human owner", async () => {
    db.tasks.set("TASK-900", taskish({ accountableOwner: "greg", evidence: { summary: "ok", items: [{ key: "a", label: "a", done: true }], rollback: "revert the PR" } }));
    const { checkoutId } = await checkout({ taskId: "TASK-900", runtime: "cursor-cloud", accountableHuman: "vince", repo: "petralabx/PLX_MC" });

    const r = await verifyPr({ repo: "petralabx/PLX_MC", prNumber: 8, headSha: "def", changedPaths: ["src/lib/x.ts"], checkoutId });
    expect(r.verdict).toBe("pass");
    expect(db.events.some((e) => e.kind === "gate.passed")).toBe(true);
  });

  it("rejects a gate that supplies only a bare repo name", async () => {
    db.tasks.set("TASK-900", taskish({ accountableOwner: "greg", evidence: { summary: "ok", items: [{ key: "a", label: "a", done: true }], rollback: "revert the PR" } }));
    const { checkoutId } = await checkout({ taskId: "TASK-900", runtime: "cursor", accountableHuman: "vince", repo: "petralabx/PLX_MC" });

    const r = await verifyPr({ repo: "PLX_MC", prNumber: 11, headSha: "slug", changedPaths: ["src/lib/x.ts"], checkoutId });
    expect(r.taskId).toBeNull();
    expect(r.verdict).toBe("block");
    expect(r.reasons.join(" ")).toContain("bare names are rejected");
  });

  it.each([
    ["evil/PLX_MC", "petralabx/PLX_MC"],
    ["petralabx/PLX_MC", "evil/PLX_MC"],
  ])("rejects a same-name checkout from %s for %s", async (dispatchRepo, callerRepo) => {
    process.env.PLX_MC_COMPLIANCE_FULL_REPO_BINDING_ENABLED = "1";
    db.tasks.set("TASK-900", taskish({ accountableOwner: "greg", evidence: { summary: "ok", items: [{ key: "a", label: "a", done: true }], rollback: "revert the PR" } }));
    const { checkoutId } = await checkout({
      taskId: "TASK-900",
      runtime: "cursor",
      accountableHuman: "vince",
      repo: dispatchRepo,
    });

    const result = await verifyPr({
      repo: "PLX_MC",
      repoFullName: callerRepo,
      prNumber: 12,
      headSha: "full-slug",
      changedPaths: ["src/lib/x.ts"],
      checkoutId,
    });
    expect(result.taskId).toBeNull();
    expect(result.verdict).toBe("block");
  });

  it("rejects legacy bare checkout records when a full slug is supplied", async () => {
    process.env.PLX_MC_COMPLIANCE_FULL_REPO_BINDING_ENABLED = "1";
    db.tasks.set("TASK-900", taskish({ accountableOwner: "greg", evidence: { summary: "ok", items: [{ key: "a", label: "a", done: true }], rollback: "revert the PR" } }));
    const { checkoutId } = await checkout({
      taskId: "TASK-900",
      runtime: "cursor",
      accountableHuman: "vince",
      repo: "PLX_MC",
    });

    const result = await verifyPr({
      repo: "petralabx/PLX_MC",
      repoFullName: "petralabx/PLX_MC",
      prNumber: 13,
      headSha: "legacy-bare",
      changedPaths: ["src/lib/x.ts"],
      checkoutId,
    });
    expect(result.taskId).toBeNull();
    expect(result.verdict).toBe("block");
  });

  it("blocks a high-risk agent PR when the task bucket has no PRD", async () => {
    db.tasks.set("TASK-900", taskish({ accountableOwner: "greg", evidence: { summary: "ok", items: [{ key: "a", label: "a", done: true }], rollback: "revert", shots: [{ label: "ui", cap: "x" }] } }));
    const { checkoutId } = await checkout({ taskId: "TASK-900", runtime: "cursor-cloud", accountableHuman: "vince", repo: "petralabx/PLX_MC" });

    const r = await verifyPr({ repo: "petralabx/PLX_MC", prNumber: 9, headSha: "ghi", changedPaths: ["db/migrations/006_x.sql"], checkoutId });
    expect(r.tier).toBe("high");
    expect(r.verdict).toBe("block");
    expect(r.reasons.some((x) => /bucket PRD/.test(x))).toBe(true);
  });

  it("passes a high-risk agent PR when the bucket has a PRD and bundle is complete", async () => {
    db.tasks.set("TASK-900", taskish({ bucket: "BKT-PRD", accountableOwner: "greg", evidence: { summary: "ok", items: [{ key: "a", label: "a", done: true }], rollback: "revert", shots: [{ label: "ui", cap: "x" }] } }));
    const { checkoutId } = await checkout({ taskId: "TASK-900", runtime: "cursor-cloud", accountableHuman: "vince", repo: "petralabx/PLX_MC" });

    const r = await verifyPr({ repo: "petralabx/PLX_MC", prNumber: 91, headSha: "ghi2", changedPaths: ["db/migrations/006_x.sql"], checkoutId });
    expect(r.tier).toBe("high");
    expect(r.verdict).toBe("pass");
  });

  it("blocks a high-risk agent PR when the PRD value is not a link", async () => {
    const bucket = db.buckets.find((row) => row.id === "BKT-PRD");
    if (bucket) bucket.prd = "PRD-001";
    db.tasks.set("TASK-900", taskish({ bucket: "BKT-PRD", accountableOwner: "greg", evidence: { summary: "ok", items: [{ key: "a", label: "a", done: true }], rollback: "revert", shots: [{ label: "ui", cap: "x" }] } }));
    const { checkoutId } = await checkout({ taskId: "TASK-900", runtime: "cursor-cloud", accountableHuman: "vince", repo: "petralabx/PLX_MC" });
    const r = await verifyPr({ repo: "petralabx/PLX_MC", prNumber: 92, headSha: "junk", changedPaths: ["db/migrations/006_x.sql"], checkoutId });
    expect(r.verdict).toBe("block");
    expect(r.reasons.some((reason) => reason.includes("linked bucket PRD"))).toBe(true);
    expect(r.reasons.join(" ")).not.toMatch(/approved/);
  });

  it("blocks a high-risk agent PR when the task has no initiative", async () => {
    db.tasks.set("TASK-900", taskish({ bucket: "", accountableOwner: "greg", evidence: { summary: "ok", items: [{ key: "a", label: "a", done: true }], rollback: "revert", shots: [{ label: "ui", cap: "x" }] } }));
    const { checkoutId } = await checkout({ taskId: "TASK-900", runtime: "cursor-cloud", accountableHuman: "vince", repo: "petralabx/PLX_MC" });
    const r = await verifyPr({ repo: "petralabx/PLX_MC", prNumber: 93, headSha: "nobucket", changedPaths: ["db/migrations/006_x.sql"], checkoutId });
    expect(r.verdict).toBe("block");
    expect(r.reasons.some((reason) => reason.includes("on an initiative"))).toBe(true);
  });

  it("keeps the PRD check advisory when the bucket store cannot be read", async () => {
    db.bucketsThrow = true;
    db.tasks.set("TASK-900", taskish({ bucket: "BKT-PRD", accountableOwner: "greg", evidence: { summary: "ok", items: [{ key: "a", label: "a", done: true }], rollback: "revert", shots: [{ label: "ui", cap: "x" }] } }));
    const { checkoutId } = await checkout({ taskId: "TASK-900", runtime: "cursor-cloud", accountableHuman: "vince", repo: "petralabx/PLX_MC" });
    const r = await verifyPr({ repo: "petralabx/PLX_MC", prNumber: 94, headSha: "storedown", changedPaths: ["db/migrations/006_x.sql"], checkoutId });
    expect(r.verdict).toBe("pass");
    expect(r.reasons.some((reason) => reason.includes("advisory"))).toBe(true);
  });

  it("is idempotent on replay — same (repo, pr, sha) yields one check + one gate event (S3)", async () => {
    db.tasks.set("TASK-900", taskish({ accountableOwner: "greg", evidence: { summary: "ok", items: [{ key: "a", label: "a", done: true }], rollback: "revert the PR" } }));
    const { checkoutId } = await checkout({ taskId: "TASK-900", runtime: "cursor-cloud", accountableHuman: "vince", repo: "petralabx/PLX_MC" });
    const args = { repo: "petralabx/PLX_MC", prNumber: 20, headSha: "sha20", changedPaths: ["src/x.ts"], checkoutId };
    await verifyPr(args);
    await verifyPr(args); // reconciliation replay of the same work
    expect(db.checks.filter((c) => c.id.includes("_20_")).length).toBe(1);
    expect(db.events.filter((e) => e.kind === "gate.passed").length).toBe(1);
  });

  it("computes the same verdict without writing the ledger when record is false (mc_verify_pr)", async () => {
    db.tasks.set("TASK-900", taskish({ accountableOwner: "greg", evidence: { summary: "ok", items: [{ key: "a", label: "a", done: true }], rollback: "revert the PR" } }));
    const { checkoutId } = await checkout({ taskId: "TASK-900", runtime: "cursor-cloud", accountableHuman: "vince", repo: "petralabx/PLX_MC" });
    const checksBefore = db.checks.length;
    const eventsBefore = db.events.length;

    const agent = await verifyPr(
      { repo: "petralabx/PLX_MC", prNumber: 21, headSha: "sha21", changedPaths: ["src/x.ts"], checkoutId },
      { record: false }
    );
    const operator = await verifyPr(
      { repo: "petralabx/PLX_MC", prNumber: 22, headSha: "sha22", changedPaths: ["src/x.ts"] },
      { record: false }
    );

    expect(agent).toMatchObject({ verdict: "pass", actorKind: "agent", taskId: "TASK-900" });
    expect(operator).toMatchObject({ verdict: "pass", actorKind: "operator" });
    expect(db.checks.length).toBe(checksBefore);
    expect(db.events.length).toBe(eventsBefore);
  });

  it("treats a PR with no checkout as operator work and passes it", async () => {
    const r = await verifyPr({ repo: "petralabx/PLX_MC", prNumber: 10, headSha: "jkl", changedPaths: ["db/migrations/007_x.sql"] });
    expect(r.actorKind).toBe("operator");
    expect(r.verdict).toBe("pass");
  });

  // Hardening (security review): a present checkoutId is always an agent run; an
  // expired or repo-mismatched credential must BLOCK, never downgrade to operator.
  it("passes an expired checkout attached to the live open PR", async () => {
    db.tasks.set("TASK-900", taskish({ accountableOwner: "greg", evidence: { summary: "ok", items: [{ key: "a", label: "a", done: true }], rollback: "revert" } }));
    db.dispatches.set("dsp_old", {
      id: "dsp_old", actorKind: "agent", runtime: "cursor", taskId: "TASK-900",
      accountableHuman: "vince", repo: "petralabx/PLX_MC", revoked: false,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    const r = await verifyPr({ repo: "petralabx/PLX_MC", prNumber: 11, headSha: "x", changedPaths: ["src/x.ts"], checkoutId: "dsp_old" });
    expect(r.actorKind).toBe("agent");
    expect(r.verdict).toBe("pass");
    expect(r.taskId).toBe("TASK-900");
  });

  it("blocks an agent PR whose checkout is bound to a different repo", async () => {
    db.tasks.set("TASK-900", taskish({ accountableOwner: "greg", evidence: { summary: "ok", items: [{ key: "a", label: "a", done: true }], rollback: "revert" } }));
    db.dispatches.set("dsp_other", {
      id: "dsp_other", actorKind: "agent", runtime: "cursor", taskId: "TASK-900",
      accountableHuman: "vince", repo: "agentic-swarm", revoked: false,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    const r = await verifyPr({ repo: "petralabx/PLX_MC", prNumber: 12, headSha: "y", changedPaths: ["src/x.ts"], checkoutId: "dsp_other" });
    expect(r.actorKind).toBe("agent");
    expect(r.verdict).toBe("block");
  });
});

describe("complete", () => {
  it("emits a task.completed event tied to the dispatch", async () => {
    const { checkoutId } = await checkout({ taskId: "TASK-900", runtime: "cursor-cloud", accountableHuman: "vince", repo: "petralabx/PLX_MC" });
    await complete({ checkoutId, summary: "shipped", commitSha: "deadbeef", prUrl: "https://github.com/x/y/pull/1" });
    const ev = db.events.find((e) => e.kind === "task.completed");
    expect(ev).toBeTruthy();
    expect(ev!.payload).toMatchObject({ summary: "shipped", commitSha: "deadbeef" });
  });

  it.each(["blocked", "failed"] as const)("records the explicit %s outcome in the completion audit", async (outcome) => {
    const { checkoutId } = await checkout({ taskId: "TASK-900", runtime: "cursor-cloud", accountableHuman: "vince", repo: "petralabx/PLX_MC" });
    await complete({ checkoutId, summary: "Work could not finish.", outcome });
    expect(db.events.find((e) => e.kind === "task.completed")?.payload).toMatchObject({ outcome, prUrl: null });
  });

  it("rejects completion for an unknown or expired checkout (S4)", async () => {
    await expect(complete({ checkoutId: "dsp_bogus", summary: "x" })).rejects.toMatchObject({ code: "invalid_checkout" });
    db.dispatches.set("dsp_exp", {
      id: "dsp_exp", actorKind: "agent", runtime: "cursor", taskId: "TASK-900",
      accountableHuman: "vince", repo: "petralabx/PLX_MC", revoked: false,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    await expect(complete({ checkoutId: "dsp_exp", summary: "x" })).rejects.toMatchObject({ code: "invalid_checkout" });
    expect(db.events.some((e) => e.kind === "task.completed")).toBe(false);
  });
});


describe("strict dispatch repository identity", () => {
  it.each([undefined, "1", "0"])("requires full slugs with binding flag %s", (flag) => {
    if (flag !== undefined) process.env.PLX_MC_COMPLIANCE_FULL_REPO_BINDING_ENABLED = flag;
    expect(dispatchRepoMatches("x", "x", "a/x")).toBe(false);
    expect(dispatchRepoMatches("a/x", "x")).toBe(false);
    expect(dispatchRepoMatches("a/x", "a/x", "x")).toBe(flag === "0");
    expect(dispatchRepoMatches("a/x/y", "a/x/y")).toBe(false);
    expect(dispatchRepoMatches("a/x", "a/x")).toBe(true);
    expect(dispatchRepoMatches("A/X", "a/x", "a/x")).toBe(true);
    expect(dispatchRepoMatches("a/x", "b/x", "b/x")).toBe(false);
    expect(dispatchRepoMatches("b/x", "a/x", "a/x")).toBe(false);
    expect(dispatchRepoMatches("a/x", "x", "a/x")).toBe(flag !== "0");
  });
});

// TASK-3336: the PR's head commits, not the PR author, decide whether agent work
// is in it. Today's human-opened PRs carried agent commits and passed unstamped.
describe("verifyPr — agent commits and their trailers (TASK-3336)", () => {
  const human = { authorName: "Taylor Alton", authorEmail: "taylor@petralabx.com", authorLogin: "taylorvalton", committerName: "GitHub", committerEmail: "noreply@github.com", committerLogin: "web-flow" };
  const agentIdentity = { authorName: "PLX Agent", authorEmail: "uat@petrasoap.com", authorLogin: "", committerName: "PLX Agent", committerEmail: "uat@petrasoap.com", committerLogin: "" };
  const commit = (sha: string, message: string, who: typeof human = agentIdentity) => ({ sha, message, ...who });
  const trailers = (checkoutId: string, agent = "claude/claude-uat", onBehalfOf = "cos@petrasoap.com") =>
    `TASK-900: change\n\nCo-Authored-By: Claude <noreply@anthropic.com>\nAgent: ${agent}\nOn-Behalf-Of: ${onBehalfOf}\nMC-Checkout: ${checkoutId}`;
  const pr = { repo: "PLX_MC", repoFullName: "petralabx/PLX_MC", prNumber: 2621, headSha: "h1", changedPaths: ["src/lib/x.ts"] };
  const stamped = async (agent?: string, runtime = "cursor") => {
    db.tasks.set("TASK-900", taskish({ accountableOwner: "greg", evidence: { summary: "ok", items: [{ key: "a", label: "a", done: true }], rollback: "revert the PR" } }));
    const { checkoutId } = await checkout({ taskId: "TASK-900", runtime, accountableHuman: "cos@petrasoap.com", repo: "petralabx/PLX_MC", agent });
    return checkoutId;
  };

  it("blocks a human-opened PR with no stamp whose commits carry agent signals", async () => {
    github.loadPrCommits.mockResolvedValue([
      commit("aaaaaaa1", "human fix", human),
      commit("bbbbbbb2", "agent fix\n\nCo-Authored-By: Claude <noreply@anthropic.com>", human),
      commit("ccccccc3", "agent fix", agentIdentity),
    ]);
    const r = await verifyPr(pr);
    expect(github.loadPrCommits).toHaveBeenCalledExactlyOnceWith("petralabx/PLX_MC", 2621);
    expect(r.verdict).toBe("block");
    expect(r.reasons).toHaveLength(1);
    expect(r.reasons[0]).toContain("no MC-Checkout stamp in the pull request body");
    expect(r.reasons[0]).toContain("bbbbbbb (agent Co-Authored-By trailer)");
    expect(r.reasons[0]).toContain("ccccccc (PLX Agent identity, lane email uat@petrasoap.com)");
    expect(r.reasons[0]).not.toContain("aaaaaaa");
    expect(db.checks.at(-1)).toMatchObject({ verdict: "block", actorKind: "operator", taskId: null });
    expect(db.events.some((e) => e.kind === "gate.blocked")).toBe(true);
  });

  it("keeps the operator pass for a PR with no stamp and no agent signal", async () => {
    github.loadPrCommits.mockResolvedValue([commit("aaaaaaa1", "human fix", human)]);
    const r = await verifyPr(pr);
    expect(r).toMatchObject({ verdict: "pass", actorKind: "operator" });
  });

  it("holds (throws) when the commits cannot be read, never passing unread", async () => {
    github.loadPrCommits.mockRejectedValue(new Error("GitHub down"));
    await expect(verifyPr(pr)).rejects.toThrow("GitHub down");
  });

  it("passes a stamped PR whose agent commits carry matching trailers", async () => {
    const cid = await stamped("claude/claude-uat");
    github.loadPrCommits.mockResolvedValue([commit("ddddddd4", trailers(cid)), commit("aaaaaaa1", "human fix", human)]);
    const r = await verifyPr({ ...pr, checkoutIds: [cid] });
    expect(r.verdict).toBe("pass");
    expect(r.reasons.join(" ")).not.toContain("warning: commit");
  });

  it("blocks a commit whose MC-Checkout trailer does not match the body stamp", async () => {
    const cid = await stamped("claude/claude-uat");
    github.loadPrCommits.mockResolvedValue([commit("eeeeeee5", trailers("dsp_other"))]);
    const r = await verifyPr({ ...pr, checkoutIds: [cid] });
    expect(r.verdict).toBe("block");
    expect(r.reasons).toContain("TASK-900: commit eeeeeee: MC-Checkout trailer dsp_other does not match a stamp in the PR body");
  });

  it("blocks a commit whose MC-Checkout trailer is not the last line", async () => {
    const cid = await stamped("claude/claude-uat");
    github.loadPrCommits.mockResolvedValue([commit("fffffff6", `${trailers(cid)}\nCo-Authored-By: Codex <codex@openai.com>`)]);
    const r = await verifyPr({ ...pr, checkoutIds: [cid] });
    expect(r.verdict).toBe("block");
    expect(r.reasons).toContain("TASK-900: commit fffffff: MC-Checkout trailer is not the last line");
  });

  it("blocks an agent commit with no trailers on a stamped PR", async () => {
    const cid = await stamped("claude/claude-uat");
    github.loadPrCommits.mockResolvedValue([commit("1111111a", "agent fix")]);
    const r = await verifyPr({ ...pr, checkoutIds: [cid] });
    expect(r.verdict).toBe("block");
    expect(r.reasons).toEqual(expect.arrayContaining([
      "TASK-900: commit 1111111: missing Agent trailer",
      "TASK-900: commit 1111111: missing On-Behalf-Of trailer",
      "TASK-900: commit 1111111: missing MC-Checkout trailer",
    ]));
  });

  it("blocks Agent and On-Behalf-Of that do not match the checkout record", async () => {
    const cid = await stamped("claude/claude-uat");
    github.loadPrCommits.mockResolvedValue([commit("2222222b", trailers(cid, "claude/claude-cos", "vince@petrasoap.com"))]);
    const r = await verifyPr({ ...pr, checkoutIds: [cid] });
    expect(r.verdict).toBe("block");
    expect(r.reasons).toEqual(expect.arrayContaining([
      "TASK-900: commit 2222222: Agent claude/claude-cos does not match the checkout's agent claude/claude-uat",
      "TASK-900: commit 2222222: On-Behalf-Of vince@petrasoap.com does not match the checkout's accountable person (greg.m@petrasoap.com or cos@petrasoap.com)",
    ]));
  });

  // TASK-3483 (Vince, 2026-10-20): a checkout minted through a shared service key
  // records the operator alias (cos@), which is not a person; the task's human
  // accountable owner is then also accepted as its accountable person.
  it("accepts On-Behalf-Of naming the task's human owner on a service-alias checkout (TASK-3483)", async () => {
    const cid = await stamped("claude/claude-uat");
    github.loadPrCommits.mockResolvedValue([commit("6666666f", trailers(cid, "claude/claude-uat", "greg.m@petrasoap.com"))]);
    expect((await verifyPr({ ...pr, checkoutIds: [cid] })).verdict).toBe("pass");
  });

  it("names both accepted people when On-Behalf-Of matches neither (TASK-3483)", async () => {
    const cid = await stamped("claude/claude-uat");
    github.loadPrCommits.mockResolvedValue([commit("7777777a", trailers(cid, "claude/claude-uat", "ross@petrasoap.com"))]);
    const r = await verifyPr({ ...pr, checkoutIds: [cid] });
    expect(r.verdict).toBe("block");
    expect(r.reasons).toContain(
      "TASK-900: commit 7777777: On-Behalf-Of ross@petrasoap.com does not match the checkout's accountable person (greg.m@petrasoap.com or cos@petrasoap.com)"
    );
  });

  it("keeps a checkout minted by a known person strict to that person (TASK-3483)", async () => {
    db.tasks.set("TASK-900", taskish({ accountableOwner: "greg", evidence: { summary: "ok", items: [{ key: "a", label: "a", done: true }], rollback: "revert the PR" } }));
    const { checkoutId: cid } = await checkout({ taskId: "TASK-900", runtime: "cursor", accountableHuman: "stephen@petrasoap.com", repo: "petralabx/PLX_MC", agent: "claude/claude-uat" });
    github.loadPrCommits.mockResolvedValue([commit("8888888b", trailers(cid, "claude/claude-uat", "greg.m@petrasoap.com"))]);
    const r = await verifyPr({ ...pr, checkoutIds: [cid] });
    expect(r.verdict).toBe("block");
    expect(r.reasons).toContain(
      "TASK-900: commit 8888888: On-Behalf-Of greg.m@petrasoap.com does not match the checkout's accountable person (stephen@petrasoap.com)"
    );
  });

  it("returns the resolved accountable person from checkout (TASK-3483)", async () => {
    db.tasks.set("TASK-900", taskish({ accountableOwner: "greg" }));
    const r = await checkout({ taskId: "TASK-900", runtime: "cursor", accountableHuman: "cos@petrasoap.com", repo: "petralabx/PLX_MC" });
    expect(r.accountablePerson).toBe("greg.m@petrasoap.com");
    const own = await checkout({ taskId: "TASK-900", runtime: "cursor", accountableHuman: "Stephen@PetraSoap.com", repo: "petralabx/PLX_MC" });
    expect(own.accountablePerson).toBe("stephen@petrasoap.com");
  });

  it("compares On-Behalf-Of case-insensitively", async () => {
    const cid = await stamped("claude/claude-uat");
    github.loadPrCommits.mockResolvedValue([commit("3333333c", trailers(cid, "Claude/Claude-UAT", "COS@PetraSoap.com"))]);
    expect((await verifyPr({ ...pr, checkoutIds: [cid] })).verdict).toBe("pass");
  });

  it("checks the Agent runtime strictly against a non-default checkout runtime", async () => {
    const cid = await stamped(undefined, "codex");
    github.loadPrCommits.mockResolvedValue([commit("4444444d", trailers(cid, "claude/claude-uat"))]);
    const r = await verifyPr({ ...pr, checkoutIds: [cid] });
    expect(r.verdict).toBe("block");
    expect(r.reasons).toContain("TASK-900: commit 4444444: Agent claude/claude-uat does not match the checkout's runtime codex");
  });

  it("only warns on the Agent trailer for a legacy default-runtime checkout", async () => {
    const cid = await stamped(undefined, "cursor");
    github.loadPrCommits.mockResolvedValue([commit("5555555e", trailers(cid, "claude/claude-uat"))]);
    const r = await verifyPr({ ...pr, checkoutIds: [cid] });
    expect(r.verdict).toBe("pass");
    expect(r.reasons.join(" ")).toContain('warning: commit 5555555: Agent claude/claude-uat not checked — the checkout records only the default runtime "cursor"');
  });

  it("never reads commits in the merge queue", async () => {
    const cid = await stamped("claude/claude-uat");
    const r = await verifyPr({ ...pr, checkoutIds: [cid], event: "merge_group" });
    expect(r.verdict).toBe("pass");
    expect(github.loadPrCommits).not.toHaveBeenCalled();
  });

  it("records the caller's agent on the checkout event", async () => {
    const cid = await stamped("claude/claude-uat");
    expect(db.events.find((e) => e.kind === "checkout" && e.payload?.checkoutId === cid)?.payload).toMatchObject({ agent: "claude/claude-uat" });
    const legacy = await stamped();
    expect(db.events.find((e) => e.kind === "checkout" && e.payload?.checkoutId === legacy)?.payload).toMatchObject({ agent: null });
  });
});

// TASK-3409: checkout lifecycle — reuse, a second holder, renewal while the PR
// is active, and the checkout's state on every verify result.
describe("checkout lifecycle (TASK-3409)", () => {
  const slug = "petralabx/PLX_MC";
  const mint = (over: Partial<Parameters<typeof checkout>[0]> = {}) =>
    checkout({ taskId: "TASK-900", runtime: "claude-code", accountableHuman: "cos@petrasoap.com", repo: slug, agent: "claude-code/claude", actor: { kind: "service", id: "sp_mcp_claude_code", status: "active" }, ...over });
  beforeEach(() => {
    db.tasks.set("TASK-900", taskish({ accountableOwner: "vince", evidence: { summary: "ok", items: [{ key: "a", label: "a", done: true }], rollback: "revert the PR" } }));
    delete process.env.PLX_MC_CHECKOUT_TAKEOVER_ENFORCE;
  });

  it("reuse returns the caller's own live checkout instead of minting a second", async () => {
    const first = await mint();
    const again = await mint({ reuse: true });
    expect(again).toMatchObject({ checkoutId: first.checkoutId, reused: true });
    expect(db.events.some((e) => e.kind === "checkout.reused" && e.payload?.checkoutId === first.checkoutId)).toBe(true);
    expect((await mint()).checkoutId).not.toBe(first.checkoutId);
  });

  it("never reuses a different principal's lease despite identical runtime and operator headers", async () => {
    const held = await mint();
    const second = await mint({ reuse: true, actor: { kind: "service", id: "sp_mcp_codex", status: "active" } });
    expect(second.checkoutId).not.toBe(held.checkoutId);
    expect(second.reused).toBeUndefined();
  });

  it("does not leak a launcher-owned credential through reuse", async () => {
    process.env.PLX_MC_LAUNCHER_PRINCIPALS = "sp_mcp_ledger";
    try {
      const held = await mint({ actor: { kind: "service", id: "sp_mcp_ledger", status: "active" }, launchId: "launch-1" });
      expect((await mint({ reuse: true })).checkoutId).not.toBe(held.checkoutId);
    } finally {
      delete process.env.PLX_MC_LAUNCHER_PRINCIPALS;
    }
  });

  it.each([undefined, "claude-code/other"])("does not reuse an incompatible agent %s", async (agent) => {
    const held = await mint();
    expect((await mint({ reuse: true, agent })).checkoutId).not.toBe(held.checkoutId);
  });

  it("does not reuse legacy ownerless leases or unauthenticated requests", async () => {
    const held = await mint({ actor: undefined });
    expect((await mint({ reuse: true })).checkoutId).not.toBe(held.checkoutId);
    const plain = await mint({ actor: undefined });
    expect((await mint({ reuse: true, actor: undefined })).checkoutId).not.toBe(plain.checkoutId);
  });

  it("logs a second holder and reports it, without refusing while enforcement is off", async () => {
    const held = await mint({ runtime: "cursor", agent: undefined });
    const second = await mint();
    expect(second.concurrent).toEqual([
      { checkoutRef: `dsp_…${held.checkoutId.slice(-4)}`, runtime: "cursor", accountableHuman: "cos@petrasoap.com" },
    ]);
    const ev = db.events.find((e) => e.kind === "checkout.concurrent");
    expect(ev?.payload).toMatchObject({ checkoutId: second.checkoutId, forceReason: null, enforced: false });
  });

  it.each([
    ["another principal", { actor: { kind: "service" as const, id: "sp_mcp_codex", status: "active" as const } }],
    ["another agent lane", { agent: "claude-code/other" }],
  ])("counts %s with the same runtime and operator as another holder", async (_label, over) => {
    const held = await mint();
    const second = await mint(over);
    expect(second.concurrent).toEqual([
      { checkoutRef: `dsp_…${held.checkoutId.slice(-4)}`, runtime: "claude-code", accountableHuman: "cos@petrasoap.com" },
    ]);
    process.env.PLX_MC_CHECKOUT_TAKEOVER_ENFORCE = "1";
    await expect(mint(over)).rejects.toMatchObject({ code: "checkout_held", status: 409 });
  });

  it("refuses a second holder without forceReason once enforcement is on, and logs the reason when given", async () => {
    await mint({ runtime: "cursor", agent: undefined });
    process.env.PLX_MC_CHECKOUT_TAKEOVER_ENFORCE = "1";
    await expect(mint()).rejects.toMatchObject({ code: "checkout_held", status: 409 });
    const taken = await mint({ forceReason: "cursor lane stalled for 3 h; CoS asked Claude to finish" });
    expect(taken.concurrent).toHaveLength(1);
    expect(db.events.findLast((e) => e.kind === "checkout.concurrent")?.payload).toMatchObject({
      forceReason: "cursor lane stalled for 3 h; CoS asked Claude to finish",
      enforced: true,
    });
  });

  it("renews a stamped checkout on a push to its open PR, never a released one", async () => {
    const live = await mint();
    const d = db.dispatches.get(live.checkoutId)!;
    d.expiresAt = new Date(Date.now() - 60_000).toISOString();
    const gone = await mint({ runtime: "codex", agent: undefined });
    db.dispatches.get(gone.checkoutId)!.releasedAt = new Date().toISOString();
    const before = db.dispatches.get(gone.checkoutId)!.expiresAt;
    await ingestPullRequest({
      repo: "PLX_MC", repoFullName: slug, prNumber: 3409, headSha: "h2", changedPaths: ["src/x.ts"],
      action: "synchronize", merged: false, branch: "b", title: "t", author: "agent", labels: [],
      checkoutId: null, checkoutIds: [live.checkoutId, gone.checkoutId],
    });
    expect(new Date(db.dispatches.get(live.checkoutId)!.expiresAt).getTime()).toBeGreaterThan(Date.now() + 7 * 3_600_000);
    expect(db.dispatches.get(gone.checkoutId)!.expiresAt).toBe(before);
    expect(db.events.filter((e) => e.kind === "checkout.renewed").map((e) => e.payload?.checkoutId)).toEqual([live.checkoutId]);
  });

  it("reports the checkout's state and the task's approval gates on each verify result", async () => {
    github.loadPrCommits.mockResolvedValue([]);
    const { checkoutId } = await mint();
    db.tasks.get("TASK-900")!.approvalGates = [
      { id: "apg_1", reason: "yes?", requestedBy: "cos@petrasoap.com", requestedAt: "2026-10-20T16:38:03Z", status: "approved", decidedBy: "vince@petrasoap.com", decidedAt: "2026-10-20T16:50:22Z" },
    ];
    const r = await verifyPr({ repo: "PLX_MC", repoFullName: slug, prNumber: 3409, headSha: "h1", changedPaths: ["src/x.ts"], checkoutIds: [checkoutId] });
    expect(r.tasks[0].checkout).toMatchObject({ live: true, releasedReason: null, blockReason: null });
    expect(r.tasks[0].approvals).toEqual([
      { gateId: "apg_1", status: "approved", decidedBy: "vince@petrasoap.com", decidedAt: "2026-10-20T16:50:22Z" },
    ]);
    db.dispatches.get(checkoutId)!.revoked = true;
    const revoked = await verifyPr({ repo: "PLX_MC", repoFullName: slug, prNumber: 3409, headSha: "h1", changedPaths: ["src/x.ts"], checkoutIds: [checkoutId] });
    expect(revoked.tasks[0].checkout).toMatchObject({ live: false, blockReason: "revoked", expiresAt: db.dispatches.get(checkoutId)!.expiresAt });
    Object.assign(db.dispatches.get(checkoutId)!, { revoked: false, releasedAt: "2026-10-21T00:00:00Z", releasedReason: "merged" });
    const released = await verifyPr({ repo: "PLX_MC", repoFullName: slug, prNumber: 3409, headSha: "h1", changedPaths: ["src/x.ts"], checkoutIds: [checkoutId] });
    expect(released.verdict).toBe("block");
    expect(released.tasks[0]).toMatchObject({ taskId: null, checkout: { live: false, blockReason: "released", releasedReason: "merged" } });
    const elsewhere = await verifyPr({ repo: "Other", repoFullName: "petralabx/Other", prNumber: 3409, headSha: "h1", changedPaths: ["src/x.ts"], checkoutIds: [checkoutId] });
    expect(elsewhere.tasks[0].checkout).toMatchObject({ live: false, blockReason: "released", releasedReason: null, expiresAt: null });
  });
});

// TASK-3408: a task labelled approval:merge-required merges only under a
// person's signed merge approval of the exact PR head.
describe("merge approval policy (TASK-3408)", () => {
  const slug = "petralabx/PLX_MC";
  const head = "d".repeat(40);
  const pr = { repo: "PLX_MC", repoFullName: slug, prNumber: 3408, headSha: head, changedPaths: ["src/x.ts"] };
  beforeEach(() => {
    process.env.PLX_MC_APPROVAL_SIGNING_KEY = "policy-key";
    github.loadPrCommits.mockResolvedValue([]);
  });
  afterEach(() => { delete process.env.PLX_MC_APPROVAL_SIGNING_KEY; });

  const seedWith = async (gates: Task["approvalGates"]) => {
    db.tasks.set("TASK-900", taskish({ labels: ["lane:claude-cli", "approval:merge-required"], approvalGates: gates, evidence: { summary: "ok", items: [{ key: "a", label: "a", done: true }], rollback: "revert the PR" } }));
    return (await checkout({ taskId: "TASK-900", runtime: "claude-code", accountableHuman: "cos@petrasoap.com", repo: slug, agent: "claude-code/claude" })).checkoutId;
  };
  const signed = async (scopeHead: string) => {
    const { signApproval, approvalExpiry } = await import("@/lib/compliance/approval-signature");
    const decidedAt = new Date().toISOString();
    const g = { id: "apg_m", reason: "merge?", requestedBy: "cos@petrasoap.com", requestedAt: decidedAt, status: "approved" as const, decidedBy: "vince@petrasoap.com", decidedAt, scope: { kind: "merge" as const, repo: slug, pr: 3408, headSha: scopeHead } };
    const stamped = { ...g, expiresAt: approvalExpiry(g.scope, decidedAt) };
    return { ...stamped, signature: signApproval("TASK-900", stamped) };
  };

  it("blocks without a covering approval and names why", async () => {
    const cid = await seedWith([]);
    const r = await verifyPr({ ...pr, checkoutIds: [cid] });
    expect(r.verdict).toBe("block");
    expect(r.reasons.join(" ")).toContain(`approval:merge-required: no signed merge approval covers ${slug}#3408 at ddddddd (no_merge_approval)`);
  });

  it("blocks when the approval covers another head", async () => {
    const cid = await seedWith([await signed("e".repeat(40))]);
    const r = await verifyPr({ ...pr, checkoutIds: [cid] });
    expect(r.verdict).toBe("block");
    expect(r.reasons.join(" ")).toContain("(head_sha_mismatch)");
  });

  it("passes with a signed approval of this exact head", async () => {
    const cid = await seedWith([await signed(head)]);
    expect((await verifyPr({ ...pr, checkoutIds: [cid] })).verdict).toBe("pass");
  });
});

// TASK-3410: the checkout lease chain. Launcher checkouts (a launch record) hold
// the PR head to their recorded SHA chain; a commit naming a launcher lane needs a
// launch record. Both warn until PLX_MC_LEASE_CHAIN_ENFORCE=1. Other checkouts
// (Claude web, Cursor cloud, Codex, people) are unaffected.
describe("checkout lease chain (TASK-3410)", () => {
  const slug = "petralabx/PLX_MC";
  const launcher = { kind: "service" as const, id: "sp_mcp_ledger", status: "active" as const };
  const other = { kind: "service" as const, id: "sp_mcp_claude_code", status: "active" as const };
  const sha = (c: string) => c.repeat(40);
  const base = sha("0");
  const agentIdentity = { authorName: "PLX Agent", authorEmail: "uat@petrasoap.com", authorLogin: "", committerName: "PLX Agent", committerEmail: "uat@petrasoap.com", committerLogin: "" };
  const lane = "claude-code/coding-1-l1";
  const commit = (s: string, message: string) => ({ sha: s, message, ...agentIdentity });
  const trailers = (cid: string, agent: string) =>
    `TASK-900: change\n\nAgent: ${agent}\nOn-Behalf-Of: cos@petrasoap.com\nMC-Checkout: ${cid}`;
  const pr = (headSha: string, prNumber = 3410) => ({ repo: "PLX_MC", repoFullName: slug, prNumber, headSha, changedPaths: ["src/x.ts"] });
  const seed = () =>
    db.tasks.set("TASK-900", taskish({ accountableOwner: "greg", evidence: { summary: "ok", items: [{ key: "a", label: "a", done: true }], rollback: "revert the PR" } }));
  const launch = async () => {
    seed();
    return (await checkout({ taskId: "TASK-900", runtime: "claude-code", accountableHuman: "cos@petrasoap.com", repo: slug, actor: launcher, agent: "claude-code/coding-1-l1", baseSha: base, launchId: "launch-1" })).checkoutId;
  };
  const heads = (cid: string) => (db.heads.get(cid) ?? []).map((h) => `${h.headSha[0]}:${h.source}:${h.pr ?? "-"}`);

  beforeEach(() => {
    process.env.PLX_MC_LAUNCHER_PRINCIPALS = "sp_mcp_ledger";
    github.loadPrCommits.mockResolvedValue([]);
  });
  afterEach(() => {
    delete process.env.PLX_MC_LAUNCHER_PRINCIPALS;
    delete process.env.PLX_MC_LEASE_CHAIN_ENFORCE;
    delete process.env.PLX_MC_LAUNCH_LANES;
  });

  it("records launcherId, baseSha and launchId on the checkout", async () => {
    const cid = await launch();
    expect(db.dispatches.get(cid)).toMatchObject({ launcherId: "sp_mcp_ledger", baseSha: base, launchId: "launch-1" });
    expect(db.events.find((e) => e.kind === "checkout")?.payload).toMatchObject({ baseSha: base, launchId: "launch-1", permissionActorId: "sp_mcp_ledger" });
  });

  it("mints a fresh lease for a launch even when reuse is asked", async () => {
    seed();
    const plain = (await checkout({ taskId: "TASK-900", runtime: "claude-code", accountableHuman: "cos@petrasoap.com", repo: slug, actor: launcher })).checkoutId;
    const launched = await checkout({ taskId: "TASK-900", runtime: "claude-code", accountableHuman: "cos@petrasoap.com", repo: slug, actor: launcher, reuse: true, launchId: "launch-3" });
    expect(launched.checkoutId).not.toBe(plain);
    expect(launched.reused).toBeUndefined();
    expect(db.dispatches.get(launched.checkoutId)).toMatchObject({ launchId: "launch-3" });
  });

  it("refuses a launch record from a principal not on the launcher list, and a short base SHA", async () => {
    seed();
    await expect(checkout({ taskId: "TASK-900", runtime: "claude-code", accountableHuman: "cos@petrasoap.com", repo: slug, actor: other, launchId: "launch-2" }))
      .rejects.toMatchObject({ code: "not_a_launcher", status: 403 });
    await expect(checkout({ taskId: "TASK-900", runtime: "claude-code", accountableHuman: "cos@petrasoap.com", repo: slug, actor: other, baseSha: "abc1234" }))
      .rejects.toMatchObject({ code: "invalid_request", status: 400 });
    const { checkoutId } = await checkout({ taskId: "TASK-900", runtime: "claude-code", accountableHuman: "cos@petrasoap.com", repo: slug, actor: other, baseSha: base });
    expect(db.dispatches.get(checkoutId)).toMatchObject({ launcherId: "sp_mcp_claude_code", baseSha: base, launchId: null });
  });

  it("attaches the first head, then extends the chain on a fast-forward or a staging merge, not a force-push", async () => {
    const cid = await launch();
    const evt = (headSha: string, beforeSha: string | null, prNumber = 3410): PrEvent => ({
      ...pr(headSha, prNumber), action: beforeSha ? "synchronize" : "opened", beforeSha, merged: false, branch: "x", title: "x", author: "agent", labels: [], checkoutId: cid, checkoutIds: [cid],
    });
    github.githubHeadDescendsFrom.mockResolvedValue(true);
    await ingestPullRequest(evt(sha("a"), null));
    await ingestPullRequest(evt(sha("b"), sha("a")));
    await ingestPullRequest(evt(sha("c"), sha("b"))); // first-parent merge of staging: before is the old head
    github.githubHeadDescendsFrom.mockResolvedValue(false);
    await ingestPullRequest(evt(sha("f"), sha("c"))); // rebase: before is still the old head
    github.githubHeadDescendsFrom.mockResolvedValue(true);
    await ingestPullRequest({ ...evt(sha("d"), sha("c")), forced: true });
    await ingestPullRequest(evt(sha("e"), sha("c"), 9999)); // another PR stamping the same checkout
    expect(heads(cid)).toEqual(["a:webhook:3410", "b:webhook:3410", "c:webhook:3410"]);
    process.env.PLX_MC_LEASE_CHAIN_ENFORCE = "1";
    github.loadPrCommits.mockResolvedValue([commit(sha("f"), trailers(cid, lane))]);
    github.githubHeadDescendsFrom.mockResolvedValue(false); // f is the rebase: no chain head is its ancestor
    const blocked = await verifyPr({ ...pr(sha("f")), checkoutIds: [cid] });
    expect(blocked.verdict).toBe("block");
    expect(blocked.reasons.join(" ")).toContain("outside checkout");
  });

  it("passes a head that descends from a recorded head and records it", async () => {
    const cid = await launch();
    await recordHead(cid, sha("a"));
    github.loadPrCommits.mockResolvedValue([commit(sha("a"), trailers(cid, lane)), commit(sha("b"), trailers(cid, lane))]);
    github.githubHeadDescendsFrom.mockResolvedValue(true);
    const r = await verifyPr({ ...pr(sha("b")), checkoutIds: [cid] });
    expect(r.verdict).toBe("pass");
    expect(r.reasons.join(" ")).not.toContain("SHA chain");
    expect(heads(cid)).toEqual(["a:launcher:-", "b:gate:3410"]);
  });

  it("warns, then blocks once enforced, on a head outside the chain or a chain bound to another PR", async () => {
    const cid = await launch();
    await recordHead(cid, sha("a"), 3410);
    github.loadPrCommits.mockResolvedValue([commit(sha("7"), trailers(cid, lane)), commit(sha("8"), trailers(cid, lane))]); // rewritten history
    const warned = await verifyPr({ ...pr(sha("8")), checkoutIds: [cid] });
    expect(warned.verdict).toBe("pass");
    expect(warned.reasons.join(" ")).toContain("warning: head 8888888 is outside checkout");
    expect(heads(cid)).toEqual(["a:launcher:3410"]);

    process.env.PLX_MC_LEASE_CHAIN_ENFORCE = "1";
    const blocked = await verifyPr({ ...pr(sha("8")), checkoutIds: [cid] });
    expect(blocked.verdict).toBe("block");
    expect(blocked.reasons.join(" ")).toContain("recorded SHA chain (last recorded aaaaaaa)");
    const otherPr = await verifyPr({ ...pr(sha("a"), 9999), checkoutIds: [cid] });
    expect(otherPr.verdict).toBe("block");
    expect(otherPr.reasons.join(" ")).toContain("SHA chain is bound to PR #3410, not #9999");
  });

  it("seeds an empty chain only with verified base ancestry, never on a failed compare", async () => {
    const cid = await launch();
    github.loadPrCommits.mockResolvedValue([commit(sha("c"), trailers(cid, lane))]);
    const warned = await verifyPr({ ...pr(sha("c")), checkoutIds: [cid] });
    expect(warned.verdict).toBe("pass");
    expect(warned.reasons.join(" ")).toContain("warning: head ccccccc has no verified ancestry from checkout");
    expect(github.githubHeadDescendsFrom).toHaveBeenCalledWith(slug, base, sha("c"));
    expect(heads(cid)).toEqual([]);

    process.env.PLX_MC_LEASE_CHAIN_ENFORCE = "1";
    expect((await verifyPr({ ...pr(sha("c")), checkoutIds: [cid] })).verdict).toBe("block");
    github.githubHeadDescendsFrom.mockRejectedValue(new Error("github_unavailable"));
    const failed = await verifyPr({ ...pr(sha("c")), checkoutIds: [cid] });
    expect(failed.verdict).toBe("block");
    expect(failed.reasons.join(" ")).toContain("no verified ancestry from checkout");
    expect(heads(cid)).toEqual([]);

    github.githubHeadDescendsFrom.mockResolvedValue(true);
    expect((await verifyPr({ ...pr(sha("c")), checkoutIds: [cid] })).verdict).toBe("pass");
    expect(heads(cid)).toEqual(["c:gate:3410"]);
  });

  it("proves ancestry for the requested head itself, never from the PR's current commits", async () => {
    const cid = await launch();
    await recordHead(cid, sha("a"), 3410);
    // The PR has moved on to b (a descendant of a); a delayed run or replay verifies the unrelated head f.
    github.loadPrCommits.mockResolvedValue([commit(sha("a"), trailers(cid, lane)), commit(sha("b"), trailers(cid, lane))]);
    github.githubHeadDescendsFrom.mockImplementation(async (_repo: string, from: string, to: string) => from === sha("a") && to === sha("b"));
    const warned = await verifyPr({ ...pr(sha("f")), checkoutIds: [cid] });
    expect(warned.reasons.join(" ")).toContain("warning: head fffffff is outside checkout");
    expect(github.githubHeadDescendsFrom).toHaveBeenCalledWith(slug, sha("a"), sha("f"));
    expect(heads(cid)).toEqual(["a:launcher:3410"]);

    process.env.PLX_MC_LEASE_CHAIN_ENFORCE = "1";
    expect((await verifyPr({ ...pr(sha("f")), checkoutIds: [cid] })).verdict).toBe("block");
    github.githubHeadDescendsFrom.mockRejectedValue(new Error("github_unavailable"));
    expect((await verifyPr({ ...pr(sha("b")), checkoutIds: [cid] })).verdict).toBe("block");
    expect(heads(cid)).toEqual(["a:launcher:3410"]);

    github.githubHeadDescendsFrom.mockImplementation(async (_repo: string, from: string, to: string) => from === sha("a") && to === sha("b"));
    expect((await verifyPr({ ...pr(sha("b")), checkoutIds: [cid] })).verdict).toBe("pass");
    expect(heads(cid)).toEqual(["a:launcher:3410", "b:gate:3410"]);
  });

  it("binds a head recorded before its PR existed to the first PR, so another PR cannot reuse the chain", async () => {
    process.env.PLX_MC_LEASE_CHAIN_ENFORCE = "1";
    const cid = await launch();
    await recordHead(cid, sha("a"));
    github.loadPrCommits.mockResolvedValue([commit(sha("a"), trailers(cid, lane))]);
    expect((await verifyPr({ ...pr(sha("a")), checkoutIds: [cid] })).verdict).toBe("pass");
    expect(heads(cid)).toEqual(["a:launcher:3410"]);
    const otherPr = await verifyPr({ ...pr(sha("a"), 9999), checkoutIds: [cid] });
    expect(otherPr.verdict).toBe("block");
    expect(otherPr.reasons.join(" ")).toContain("SHA chain is bound to PR #3410, not #9999");
  });

  it("refuses a verify that loses the bind race to another PR", async () => {
    process.env.PLX_MC_LEASE_CHAIN_ENFORCE = "1";
    const cid = await launch();
    await recordHead(cid, sha("a"));
    db.bindRace = 9999;
    github.loadPrCommits.mockResolvedValue([commit(sha("a"), trailers(cid, lane))]);
    const lost = await verifyPr({ ...pr(sha("a")), checkoutIds: [cid] });
    expect(lost.verdict).toBe("block");
    expect(lost.reasons.join(" ")).toContain("SHA chain is bound to PR #9999, not #3410");
    expect(heads(cid)).toEqual(["a:launcher:9999"]);
  });

  it("binds an unbound recorded head on the PR webhook and on a launcher re-record", async () => {
    const cid = await launch();
    await recordHead(cid, sha("a"));
    await ingestPullRequest({
      ...pr(sha("a")), action: "opened", beforeSha: null, merged: false, branch: "x", title: "x", author: "agent", labels: [], checkoutId: cid, checkoutIds: [cid],
    });
    expect(heads(cid)).toEqual(["a:launcher:3410"]);

    const relaunched = await launch();
    await recordHead(relaunched, sha("b"));
    const again = await recordHead(relaunched, sha("b"), 3411);
    expect(again.recorded).toBe(false);
    expect(heads(relaunched)).toEqual(["b:launcher:3411"]);
    await expect(recordHead(relaunched, sha("b"), 9999)).rejects.toMatchObject({ code: "chain_bound", status: 409 });
  });

  it("does not queue the event when an ordinary checkout's ancestry compare fails, but does for a launcher checkout", async () => {
    seed();
    const plain = (await checkout({ taskId: "TASK-900", runtime: "claude-code", accountableHuman: "cos@petrasoap.com", repo: slug, actor: other, baseSha: base })).checkoutId;
    const evt = (cid: string): PrEvent => ({
      ...pr(sha("a")), action: "opened", beforeSha: null, merged: false, branch: "x", title: "x", author: "agent", labels: [], checkoutId: cid, checkoutIds: [cid],
    });
    github.githubHeadDescendsFrom.mockRejectedValue(new Error("github_unavailable"));
    await expect(ingestPullRequest(evt(plain))).resolves.toMatchObject({ recorded: true });
    expect(heads(plain)).toEqual([]);
    const launched = await launch();
    await expect(ingestPullRequest(evt(launched))).rejects.toThrow("github_unavailable");
  });

  it("blocks a commit stamped by a different actor than the checkout's", async () => {
    const cid = await launch();
    github.loadPrCommits.mockResolvedValue([commit(sha("a"), trailers(cid, "codex/cloud"))]);
    const r = await verifyPr({ ...pr(sha("a")), checkoutIds: [cid] });
    expect(r.verdict).toBe("block");
    expect(r.reasons.join(" ")).toContain("Agent codex/cloud does not match the checkout's agent claude-code/coding-1-l1");
  });

  it("holds launcher-lane Agent trailers to a launch record, and only those", async () => {
    process.env.PLX_MC_LAUNCH_LANES = "claude-code/coding-1-*";
    process.env.PLX_MC_LEASE_CHAIN_ENFORCE = "1";
    seed();
    const web = (await checkout({ taskId: "TASK-900", runtime: "claude-code", accountableHuman: "cos@petrasoap.com", repo: slug, actor: other, agent: "claude-code/coding-1-l2" })).checkoutId;
    github.loadPrCommits.mockResolvedValue([commit(sha("a"), trailers(web, "claude-code/coding-1-l2"))]);
    const lane = await verifyPr({ ...pr(sha("a")), checkoutIds: [web] });
    expect(lane.verdict).toBe("block");
    expect(lane.reasons.join(" ")).toContain("names a launcher lane, but its checkout has no launch record");

    const claudeWeb = (await checkout({ taskId: "TASK-900", runtime: "claude-code", accountableHuman: "cos@petrasoap.com", repo: slug, actor: other, agent: "claude-code/claude" })).checkoutId;
    github.loadPrCommits.mockResolvedValue([commit(sha("b"), trailers(claudeWeb, "claude-code/claude"))]);
    expect((await verifyPr({ ...pr(sha("b"), 3411), checkoutIds: [claudeWeb] })).verdict).toBe("pass");

    const launched = await launch();
    github.loadPrCommits.mockResolvedValue([commit(sha("c"), trailers(launched, "claude-code/coding-1-l1"))]);
    github.githubHeadDescendsFrom.mockResolvedValue(true);
    expect((await verifyPr({ ...pr(sha("c"), 3412), checkoutIds: [launched] })).verdict).toBe("pass");
  });

  it("lets only the principal that took the checkout record its heads, while it is unreleased", async () => {
    const cid = await launch();
    await expect(recordCheckoutHead({ checkoutId: cid, headSha: sha("a"), principalId: "sp_mcp_claude_code" }))
      .rejects.toMatchObject({ code: "not_checkout_launcher", status: 403 });
    const first = await recordCheckoutHead({ checkoutId: cid, headSha: sha("a"), prNumber: 3410, principalId: "sp_mcp_ledger" });
    expect(first.recorded).toBe(true);
    expect((await recordCheckoutHead({ checkoutId: cid, headSha: sha("a"), principalId: "sp_mcp_ledger" })).recorded).toBe(false);
    await expect(recordCheckoutHead({ checkoutId: cid, headSha: sha("b"), prNumber: 9999, principalId: "sp_mcp_ledger" }))
      .rejects.toMatchObject({ code: "chain_bound", status: 409 });
    db.dispatches.get(cid)!.releasedAt = new Date().toISOString();
    await expect(recordCheckoutHead({ checkoutId: cid, headSha: sha("b"), principalId: "sp_mcp_ledger" }))
      .rejects.toMatchObject({ code: "checkout_inactive", status: 409 });
  });

  const recordHead = (cid: string, headSha: string, prNumber?: number) =>
    recordCheckoutHead({ checkoutId: cid, headSha, prNumber, principalId: "sp_mcp_ledger" });
});
