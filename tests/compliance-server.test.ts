// EN-007 P1b — the compliance service (checkout / verify / complete) proven
// without a live database. The repo + sync seams are mocked in-memory (the same
// technique as tests/mc-patch.test.ts), so this exercises the real orchestration:
// tier classification, actor/task resolution from the dispatch ledger, the
// verdict, and the recorded check + emitted events.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Task } from "@/lib/mc-data";

const db = vi.hoisted(() => ({
  dispatches: new Map<string, { id: string; actorKind: "agent" | "operator"; runtime: string; taskId: string; accountableHuman: string; repo: string; revoked: boolean; expiresAt: string }>(),
  events: [] as { kind: string; actor: string; repo?: string | null; taskId?: string | null; pr?: string | null; payload?: Record<string, unknown> }[],
  checks: [] as { id: string; verdict: string; reasons: string[]; actorKind: string; taskId: string | null }[],
  tasks: new Map<string, Task>(),
  dedupKeys: new Set<string>(),
}));

vi.mock("@/lib/compliance/repo", () => ({
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
}));

vi.mock("@/lib/sync/repo", () => ({
  async getEntity(type: string, id: string) {
    const t = db.tasks.get(id);
    return t ? { entity_type: type, id, data: t, sync_state: "synced", sp_item_id: null, dirty_fields: [] } : null;
  },
}));

// Imported AFTER the mocks so the service's `import * as repo` + sync getEntity
// resolve to the mocked modules.
import { checkout, complete, verifyPr } from "@/lib/compliance/service";

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
  db.dispatches.clear();
  db.events.length = 0;
  db.checks.length = 0;
  db.tasks.clear();
  db.dedupKeys.clear();
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
    // minted with MC_REPO="taylorvalton/PLX_MC" (the runbook/mcp.json form) must
    // still resolve its task — else taskId=null wrongly blocks a valid agent PR.
    db.tasks.set("TASK-900", taskish({ accountableOwner: "greg", evidence: { summary: "ok", items: [{ key: "a", label: "a", done: true }], rollback: "revert the PR" } }));
    const { checkoutId } = await checkout({ taskId: "TASK-900", runtime: "cursor", accountableHuman: "vince", repo: "taylorvalton/PLX_MC" });

    const r = await verifyPr({ repo: "PLX_MC", prNumber: 11, headSha: "slug", changedPaths: ["src/lib/x.ts"], checkoutId });
    expect(r.taskId).toBe("TASK-900");
    expect(r.verdict).toBe("pass");
  });

  it("classifies a migration change as high-risk; PRD is advisory (no bucket store) so a full bundle passes (S1)", async () => {
    db.tasks.set("TASK-900", taskish({ accountableOwner: "greg", evidence: { summary: "ok", items: [{ key: "a", label: "a", done: true }], rollback: "revert", shots: [{ label: "ui", cap: "x" }] } }));
    const { checkoutId } = await checkout({ taskId: "TASK-900", runtime: "cursor-cloud", accountableHuman: "vince", repo: "PLX_MC" });

    const r = await verifyPr({ repo: "PLX_MC", prNumber: 9, headSha: "ghi", changedPaths: ["db/migrations/006_x.sql"], checkoutId });
    expect(r.tier).toBe("high");
    expect(r.verdict).toBe("pass");
    expect(r.reasons.some((x) => /advisory/.test(x))).toBe(true);
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

  it("treats a PR with no checkout as operator work and passes it", async () => {
    const r = await verifyPr({ repo: "PLX_MC", prNumber: 10, headSha: "jkl", changedPaths: ["db/migrations/007_x.sql"] });
    expect(r.actorKind).toBe("operator");
    expect(r.verdict).toBe("pass");
  });

  // Hardening (security review): a present checkoutId is always an agent run; an
  // expired or repo-mismatched credential must BLOCK, never downgrade to operator.
  it("blocks an agent PR whose checkout is expired (no downgrade to operator)", async () => {
    db.tasks.set("TASK-900", taskish({ accountableOwner: "greg", evidence: { summary: "ok", items: [{ key: "a", label: "a", done: true }], rollback: "revert" } }));
    db.dispatches.set("dsp_old", {
      id: "dsp_old", actorKind: "agent", runtime: "cursor", taskId: "TASK-900",
      accountableHuman: "vince", repo: "PLX_MC", revoked: false,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    const r = await verifyPr({ repo: "PLX_MC", prNumber: 11, headSha: "x", changedPaths: ["src/x.ts"], checkoutId: "dsp_old" });
    expect(r.actorKind).toBe("agent");
    expect(r.verdict).toBe("block");
    expect(r.reasons.some((x) => /no checked-out MC task/.test(x))).toBe(true);
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
