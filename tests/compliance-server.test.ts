// EN-007 P1b — the compliance service (checkout / verify / complete) proven
// without a live database. The repo + sync seams are mocked in-memory (the same
// technique as tests/mc-patch.test.ts), so this exercises the real orchestration:
// tier classification, actor/task resolution from the dispatch ledger, the
// verdict, and the recorded check + emitted events.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Task } from "@/lib/mc-data";
import type { PrEvent } from "@/lib/compliance/webhook";

const github = vi.hoisted(() => ({ loadPrState: vi.fn() }));
vi.mock("@/lib/compliance/github-pr", () => github);

const db = vi.hoisted(() => ({
  dispatches: new Map<string, { id: string; actorKind: "agent" | "operator"; runtime: string; taskId: string; accountableHuman: string; repo: string; revoked: boolean; expiresAt: string; releasedAt?: string | null; releasedReason?: string | null }>(),
  events: [] as { kind: string; actor: string; repo?: string | null; taskId?: string | null; pr?: string | null; payload?: Record<string, unknown> }[],
  checks: [] as { id: string; verdict: string; reasons: string[]; actorKind: string; taskId: string | null }[],
  tasks: new Map<string, Task>(),
  dedupKeys: new Set<string>(),
  bucketsThrow: false,
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
    const i = db.checks.findIndex((x) => x.id === c.id);
    if (i >= 0) db.checks[i] = c;
    else db.checks.push(c);
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
import { checkout, complete, ingestPullRequest, verifyPr } from "@/lib/compliance/service";

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
  db.bucketsThrow = false;
  const withPrd = db.buckets.find((bucket) => bucket.id === "BKT-PRD");
  if (withPrd) withPrd.prd = "https://example.com/prd.md";
  delete process.env.PLX_MC_COMPLIANCE_FULL_REPO_BINDING_ENABLED;
});

describe("open PR checkout lifetime (TASK-2011)", () => {
  const input = { repo: "PLX_MC", repoFullName: "petralabx/PLX_MC", prNumber: 2011, headSha: "head", changedPaths: ["src/x.ts"], checkoutId: "dsp_old" };
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
    ["revoked", "revoked"], ["released", "released"], ["repo", "repo_mismatch"],
    ["closed", "pr_not_open"], ["stamp", "stamp_not_in_pr"], ["verified", "task_closed"], ["deleted", "task_closed"],
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
    expect((await verifyPr(input)).tasks[0].reasons).toEqual(["released"]);
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
      repo: "PLX_MC",
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
      repo: "PLX_MC",
      door: "mcp",
    });
    expect(db.events.at(-1)?.payload).toMatchObject({ door: "mcp", actorKind: "agent" });

    await checkout({
      taskId: "TASK-900",
      runtime: "cursor",
      accountableHuman: "vince",
      repo: "PLX_MC",
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
      repo: "PLX_MC",
    });

    expect(db.tasks.get("TASK-900")?.accountableOwner).toBe("greg");
  });

  it("preserves an existing accountable owner", async () => {
    db.tasks.set("TASK-900", taskish({ accountableOwner: "stephen" }));

    await checkout({
      taskId: "TASK-900",
      runtime: "cursor",
      accountableHuman: "greg.m@petrasoap.com",
      repo: "PLX_MC",
    });

    expect(db.tasks.get("TASK-900")?.accountableOwner).toBe("stephen");
  });

  it("defaults COS dispatches to Vince instead of treating COS as human", async () => {
    db.tasks.set("TASK-900", taskish({ accountableOwner: null }));

    await checkout({
      taskId: "TASK-900",
      runtime: "cursor",
      accountableHuman: "cos@petrasoap.com",
      repo: "PLX_MC",
    });

    expect(db.tasks.get("TASK-900")?.accountableOwner).toBe("vince");
  });
});

describe("verifyPr — resolves actor/task from the checkout, not git", () => {
  it("blocks an agent PR whose task has an incomplete bundle, and records it", async () => {
    db.tasks.set("TASK-900", taskish({ accountableOwner: "greg", evidence: { summary: "x", items: [{ key: "a", label: "a", done: false }] } }));
    const { checkoutId } = await checkout({ taskId: "TASK-900", runtime: "cursor-cloud", accountableHuman: "vince", repo: "PLX_MC" });

    const r = await verifyPr({ repo: "PLX_MC", prNumber: 7, headSha: "abc", changedPaths: ["src/lib/x.ts"], checkoutId });
    expect(r.actorKind).toBe("agent");
    expect(r.tier).toBe("standard");
    expect(r.verdict).toBe("block");
    expect(db.checks.at(-1)).toMatchObject({ verdict: "block", actorKind: "agent" });
    expect(db.events.some((e) => e.kind === "gate.blocked")).toBe(true);
  });

  it("passes an agent PR with a complete standard bundle + human owner", async () => {
    db.tasks.set("TASK-900", taskish({ accountableOwner: "greg", evidence: { summary: "ok", items: [{ key: "a", label: "a", done: true }], rollback: "revert the PR" } }));
    const { checkoutId } = await checkout({ taskId: "TASK-900", runtime: "cursor-cloud", accountableHuman: "vince", repo: "PLX_MC" });

    const r = await verifyPr({ repo: "PLX_MC", prNumber: 8, headSha: "def", changedPaths: ["src/lib/x.ts"], checkoutId });
    expect(r.verdict).toBe("pass");
    expect(db.events.some((e) => e.kind === "gate.passed")).toBe(true);
  });

  it("resolves a checkout minted with the full owner/name slug against the gate's bare repo name (P0c)", async () => {
    // The gate sends repo = github.event.repository.name ("PLX_MC"); a stamp
    // minted with MC_REPO="petralabx/PLX_MC" (the runbook/mcp.json form) must
    // still resolve its task — else taskId=null wrongly blocks a valid agent PR.
    db.tasks.set("TASK-900", taskish({ accountableOwner: "greg", evidence: { summary: "ok", items: [{ key: "a", label: "a", done: true }], rollback: "revert the PR" } }));
    const { checkoutId } = await checkout({ taskId: "TASK-900", runtime: "cursor", accountableHuman: "vince", repo: "petralabx/PLX_MC" });

    const r = await verifyPr({ repo: "PLX_MC", prNumber: 11, headSha: "slug", changedPaths: ["src/lib/x.ts"], checkoutId });
    expect(r.taskId).toBe("TASK-900");
    expect(r.verdict).toBe("pass");
  });

  it("prefers an available full slug and rejects a same-bare-name foreign checkout", async () => {
    process.env.PLX_MC_COMPLIANCE_FULL_REPO_BINDING_ENABLED = "1";
    db.tasks.set("TASK-900", taskish({ accountableOwner: "greg", evidence: { summary: "ok", items: [{ key: "a", label: "a", done: true }], rollback: "revert the PR" } }));
    const { checkoutId } = await checkout({
      taskId: "TASK-900",
      runtime: "cursor",
      accountableHuman: "vince",
      repo: "evil/PLX_MC",
    });

    const result = await verifyPr({
      repo: "PLX_MC",
      repoFullName: "petralabx/PLX_MC",
      prNumber: 12,
      headSha: "full-slug",
      changedPaths: ["src/lib/x.ts"],
      checkoutId,
    });
    expect(result.taskId).toBeNull();
    expect(result.verdict).toBe("block");
  });

  it("keeps legacy bare checkout records valid when a full slug is supplied", async () => {
    process.env.PLX_MC_COMPLIANCE_FULL_REPO_BINDING_ENABLED = "1";
    db.tasks.set("TASK-900", taskish({ accountableOwner: "greg", evidence: { summary: "ok", items: [{ key: "a", label: "a", done: true }], rollback: "revert the PR" } }));
    const { checkoutId } = await checkout({
      taskId: "TASK-900",
      runtime: "cursor",
      accountableHuman: "vince",
      repo: "PLX_MC",
    });

    const result = await verifyPr({
      repo: "PLX_MC",
      repoFullName: "petralabx/PLX_MC",
      prNumber: 13,
      headSha: "legacy-bare",
      changedPaths: ["src/lib/x.ts"],
      checkoutId,
    });
    expect(result.taskId).toBe("TASK-900");
    expect(result.verdict).toBe("pass");
  });

  it("blocks a high-risk agent PR when the task bucket has no PRD", async () => {
    db.tasks.set("TASK-900", taskish({ accountableOwner: "greg", evidence: { summary: "ok", items: [{ key: "a", label: "a", done: true }], rollback: "revert", shots: [{ label: "ui", cap: "x" }] } }));
    const { checkoutId } = await checkout({ taskId: "TASK-900", runtime: "cursor-cloud", accountableHuman: "vince", repo: "PLX_MC" });

    const r = await verifyPr({ repo: "PLX_MC", prNumber: 9, headSha: "ghi", changedPaths: ["db/migrations/006_x.sql"], checkoutId });
    expect(r.tier).toBe("high");
    expect(r.verdict).toBe("block");
    expect(r.reasons.some((x) => /bucket PRD/.test(x))).toBe(true);
  });

  it("passes a high-risk agent PR when the bucket has a PRD and bundle is complete", async () => {
    db.tasks.set("TASK-900", taskish({ bucket: "BKT-PRD", accountableOwner: "greg", evidence: { summary: "ok", items: [{ key: "a", label: "a", done: true }], rollback: "revert", shots: [{ label: "ui", cap: "x" }] } }));
    const { checkoutId } = await checkout({ taskId: "TASK-900", runtime: "cursor-cloud", accountableHuman: "vince", repo: "PLX_MC" });

    const r = await verifyPr({ repo: "PLX_MC", prNumber: 91, headSha: "ghi2", changedPaths: ["db/migrations/006_x.sql"], checkoutId });
    expect(r.tier).toBe("high");
    expect(r.verdict).toBe("pass");
  });

  it("blocks a high-risk agent PR when the PRD value is not a link", async () => {
    const bucket = db.buckets.find((row) => row.id === "BKT-PRD");
    if (bucket) bucket.prd = "PRD-001";
    db.tasks.set("TASK-900", taskish({ bucket: "BKT-PRD", accountableOwner: "greg", evidence: { summary: "ok", items: [{ key: "a", label: "a", done: true }], rollback: "revert", shots: [{ label: "ui", cap: "x" }] } }));
    const { checkoutId } = await checkout({ taskId: "TASK-900", runtime: "cursor-cloud", accountableHuman: "vince", repo: "PLX_MC" });
    const r = await verifyPr({ repo: "PLX_MC", prNumber: 92, headSha: "junk", changedPaths: ["db/migrations/006_x.sql"], checkoutId });
    expect(r.verdict).toBe("block");
    expect(r.reasons.some((reason) => reason.includes("linked bucket PRD"))).toBe(true);
    expect(r.reasons.join(" ")).not.toMatch(/approved/);
  });

  it("blocks a high-risk agent PR when the task has no initiative", async () => {
    db.tasks.set("TASK-900", taskish({ bucket: "", accountableOwner: "greg", evidence: { summary: "ok", items: [{ key: "a", label: "a", done: true }], rollback: "revert", shots: [{ label: "ui", cap: "x" }] } }));
    const { checkoutId } = await checkout({ taskId: "TASK-900", runtime: "cursor-cloud", accountableHuman: "vince", repo: "PLX_MC" });
    const r = await verifyPr({ repo: "PLX_MC", prNumber: 93, headSha: "nobucket", changedPaths: ["db/migrations/006_x.sql"], checkoutId });
    expect(r.verdict).toBe("block");
    expect(r.reasons.some((reason) => reason.includes("on an initiative"))).toBe(true);
  });

  it("keeps the PRD check advisory when the bucket store cannot be read", async () => {
    db.bucketsThrow = true;
    db.tasks.set("TASK-900", taskish({ bucket: "BKT-PRD", accountableOwner: "greg", evidence: { summary: "ok", items: [{ key: "a", label: "a", done: true }], rollback: "revert", shots: [{ label: "ui", cap: "x" }] } }));
    const { checkoutId } = await checkout({ taskId: "TASK-900", runtime: "cursor-cloud", accountableHuman: "vince", repo: "PLX_MC" });
    const r = await verifyPr({ repo: "PLX_MC", prNumber: 94, headSha: "storedown", changedPaths: ["db/migrations/006_x.sql"], checkoutId });
    expect(r.verdict).toBe("pass");
    expect(r.reasons.some((reason) => reason.includes("advisory"))).toBe(true);
  });

  it("is idempotent on replay — same (repo, pr, sha) yields one check + one gate event (S3)", async () => {
    db.tasks.set("TASK-900", taskish({ accountableOwner: "greg", evidence: { summary: "ok", items: [{ key: "a", label: "a", done: true }], rollback: "revert the PR" } }));
    const { checkoutId } = await checkout({ taskId: "TASK-900", runtime: "cursor-cloud", accountableHuman: "vince", repo: "PLX_MC" });
    const args = { repo: "PLX_MC", prNumber: 20, headSha: "sha20", changedPaths: ["src/x.ts"], checkoutId };
    await verifyPr(args);
    await verifyPr(args); // reconciliation replay of the same work
    expect(db.checks.filter((c) => c.id.includes("_20_")).length).toBe(1);
    expect(db.events.filter((e) => e.kind === "gate.passed").length).toBe(1);
  });

  it("computes the same verdict without writing the ledger when record is false (mc_verify_pr)", async () => {
    db.tasks.set("TASK-900", taskish({ accountableOwner: "greg", evidence: { summary: "ok", items: [{ key: "a", label: "a", done: true }], rollback: "revert the PR" } }));
    const { checkoutId } = await checkout({ taskId: "TASK-900", runtime: "cursor-cloud", accountableHuman: "vince", repo: "PLX_MC" });
    const checksBefore = db.checks.length;
    const eventsBefore = db.events.length;

    const agent = await verifyPr(
      { repo: "PLX_MC", prNumber: 21, headSha: "sha21", changedPaths: ["src/x.ts"], checkoutId },
      { record: false }
    );
    const operator = await verifyPr(
      { repo: "PLX_MC", prNumber: 22, headSha: "sha22", changedPaths: ["src/x.ts"] },
      { record: false }
    );

    expect(agent).toMatchObject({ verdict: "pass", actorKind: "agent", taskId: "TASK-900" });
    expect(operator).toMatchObject({ verdict: "pass", actorKind: "operator" });
    expect(db.checks.length).toBe(checksBefore);
    expect(db.events.length).toBe(eventsBefore);
  });

  it("treats a PR with no checkout as operator work and passes it", async () => {
    const r = await verifyPr({ repo: "PLX_MC", prNumber: 10, headSha: "jkl", changedPaths: ["db/migrations/007_x.sql"] });
    expect(r.actorKind).toBe("operator");
    expect(r.verdict).toBe("pass");
  });

  // Hardening (security review): a present checkoutId is always an agent run; an
  // expired or repo-mismatched credential must BLOCK, never downgrade to operator.
  it("passes an expired checkout attached to the live open PR", async () => {
    db.tasks.set("TASK-900", taskish({ accountableOwner: "greg", evidence: { summary: "ok", items: [{ key: "a", label: "a", done: true }], rollback: "revert" } }));
    db.dispatches.set("dsp_old", {
      id: "dsp_old", actorKind: "agent", runtime: "cursor", taskId: "TASK-900",
      accountableHuman: "vince", repo: "PLX_MC", revoked: false,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    const r = await verifyPr({ repo: "PLX_MC", prNumber: 11, headSha: "x", changedPaths: ["src/x.ts"], checkoutId: "dsp_old" });
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
    const r = await verifyPr({ repo: "PLX_MC", prNumber: 12, headSha: "y", changedPaths: ["src/x.ts"], checkoutId: "dsp_other" });
    expect(r.actorKind).toBe("agent");
    expect(r.verdict).toBe("block");
  });
});

describe("complete", () => {
  it("emits a task.completed event tied to the dispatch", async () => {
    const { checkoutId } = await checkout({ taskId: "TASK-900", runtime: "cursor-cloud", accountableHuman: "vince", repo: "PLX_MC" });
    await complete({ checkoutId, summary: "shipped", commitSha: "deadbeef", prUrl: "https://github.com/x/y/pull/1" });
    const ev = db.events.find((e) => e.kind === "task.completed");
    expect(ev).toBeTruthy();
    expect(ev!.payload).toMatchObject({ summary: "shipped", commitSha: "deadbeef" });
  });

  it("rejects completion for an unknown or expired checkout (S4)", async () => {
    await expect(complete({ checkoutId: "dsp_bogus", summary: "x" })).rejects.toMatchObject({ code: "invalid_checkout" });
    db.dispatches.set("dsp_exp", {
      id: "dsp_exp", actorKind: "agent", runtime: "cursor", taskId: "TASK-900",
      accountableHuman: "vince", repo: "PLX_MC", revoked: false,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    await expect(complete({ checkoutId: "dsp_exp", summary: "x" })).rejects.toMatchObject({ code: "invalid_checkout" });
    expect(db.events.some((e) => e.kind === "task.completed")).toBe(false);
  });
});
