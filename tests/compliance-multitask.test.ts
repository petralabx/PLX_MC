// EN-007 — multi-task PRs (agent-governance-automation P2). A single PR may
// complete N related MC tasks (one MC-Checkout stamp each). verifyPr verifies
// EVERY checked-out task and passes only if ALL pass; each task's verdict is its
// own recorded check + gate event. Same in-memory repo/sync mocks as
// tests/compliance-server.test.ts (no live DB).
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

import { checkout, verifyPr } from "@/lib/compliance/service";

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

const complete = { summary: "ok", items: [{ key: "a", label: "a", done: true }], rollback: "revert the PR" };
const incomplete = { summary: "wip", items: [{ key: "a", label: "a", done: false }] };

beforeEach(() => {
  db.dispatches.clear();
  db.events.length = 0;
  db.checks.length = 0;
  db.tasks.clear();
  db.dedupKeys.clear();
});

describe("verifyPr — multi-task PRs (checkoutIds)", () => {
  it("passes only when EVERY checked-out task has a complete bundle", async () => {
    db.tasks.set("TASK-1", taskish({ id: "TASK-1", accountableOwner: "greg", evidence: complete }));
    db.tasks.set("TASK-2", taskish({ id: "TASK-2", accountableOwner: "greg", evidence: complete }));
    const a = await checkout({ taskId: "TASK-1", runtime: "cursor", accountableHuman: "vince", repo: "PLX_MC" });
    const b = await checkout({ taskId: "TASK-2", runtime: "claude", accountableHuman: "vince", repo: "PLX_MC" });

    const r = await verifyPr({ repo: "PLX_MC", prNumber: 30, headSha: "sha30", changedPaths: ["src/lib/x.ts"], checkoutIds: [a.checkoutId, b.checkoutId] });

    expect(r.actorKind).toBe("agent");
    expect(r.verdict).toBe("pass");
    expect(r.tasks.map((t) => t.taskId).sort()).toEqual(["TASK-1", "TASK-2"]);
    expect(r.tasks.every((t) => t.verdict === "pass")).toBe(true);
    // One check + one gate event per task (distinct ids, not collided).
    expect(db.checks.filter((c) => c.id.includes("_30_")).length).toBe(2);
    expect(db.events.filter((e) => e.kind === "gate.passed").length).toBe(2);
  });

  it("blocks the WHOLE PR if any one task's bundle is incomplete, naming that task", async () => {
    db.tasks.set("TASK-1", taskish({ id: "TASK-1", accountableOwner: "greg", evidence: complete }));
    db.tasks.set("TASK-2", taskish({ id: "TASK-2", accountableOwner: "greg", evidence: incomplete }));
    const a = await checkout({ taskId: "TASK-1", runtime: "cursor", accountableHuman: "vince", repo: "PLX_MC" });
    const b = await checkout({ taskId: "TASK-2", runtime: "claude", accountableHuman: "vince", repo: "PLX_MC" });

    const r = await verifyPr({ repo: "PLX_MC", prNumber: 31, headSha: "sha31", changedPaths: ["src/lib/x.ts"], checkoutIds: [a.checkoutId, b.checkoutId] });

    expect(r.verdict).toBe("block");
    // Per-task detail: TASK-1 passes, TASK-2 blocks.
    expect(r.tasks.find((t) => t.taskId === "TASK-1")!.verdict).toBe("pass");
    expect(r.tasks.find((t) => t.taskId === "TASK-2")!.verdict).toBe("block");
    // Aggregate reasons are prefixed with the offending task id.
    expect(r.reasons.some((x) => /^TASK-2:/.test(x))).toBe(true);
    expect(r.reasons.some((x) => /^TASK-1:/.test(x))).toBe(false);
    // Both tasks recorded (one pass, one block).
    expect(db.checks.filter((c) => c.id.includes("_31_") && c.verdict === "pass").length).toBe(1);
    expect(db.checks.filter((c) => c.id.includes("_31_") && c.verdict === "block").length).toBe(1);
    expect(db.events.some((e) => e.kind === "gate.blocked")).toBe(true);
  });

  it("dedups a repeated stamp — the same checkout listed twice counts once", async () => {
    db.tasks.set("TASK-1", taskish({ id: "TASK-1", accountableOwner: "greg", evidence: complete }));
    const a = await checkout({ taskId: "TASK-1", runtime: "cursor", accountableHuman: "vince", repo: "PLX_MC" });

    const r = await verifyPr({ repo: "PLX_MC", prNumber: 32, headSha: "sha32", changedPaths: ["src/lib/x.ts"], checkoutIds: [a.checkoutId, a.checkoutId] });

    expect(r.verdict).toBe("pass");
    expect(r.tasks.length).toBe(1);
    expect(db.checks.filter((c) => c.id.includes("_32_")).length).toBe(1);
  });

  it("treats a single checkoutId as the one-task subset (back-compat)", async () => {
    db.tasks.set("TASK-1", taskish({ id: "TASK-1", accountableOwner: "greg", evidence: complete }));
    const a = await checkout({ taskId: "TASK-1", runtime: "cursor", accountableHuman: "vince", repo: "PLX_MC" });

    const r = await verifyPr({ repo: "PLX_MC", prNumber: 33, headSha: "sha33", changedPaths: ["src/lib/x.ts"], checkoutId: a.checkoutId });

    expect(r.verdict).toBe("pass");
    expect(r.taskId).toBe("TASK-1");
    expect(r.tasks.length).toBe(1);
  });

  it("is idempotent on replay — same (repo, pr, sha) over N tasks dedups checks + events (S3)", async () => {
    db.tasks.set("TASK-1", taskish({ id: "TASK-1", accountableOwner: "greg", evidence: complete }));
    db.tasks.set("TASK-2", taskish({ id: "TASK-2", accountableOwner: "greg", evidence: complete }));
    const a = await checkout({ taskId: "TASK-1", runtime: "cursor", accountableHuman: "vince", repo: "PLX_MC" });
    const b = await checkout({ taskId: "TASK-2", runtime: "claude", accountableHuman: "vince", repo: "PLX_MC" });
    const args = { repo: "PLX_MC", prNumber: 34, headSha: "sha34", changedPaths: ["src/x.ts"], checkoutIds: [a.checkoutId, b.checkoutId] };

    await verifyPr(args);
    await verifyPr(args); // reconciliation replay

    expect(db.checks.filter((c) => c.id.includes("_34_")).length).toBe(2);
    expect(db.events.filter((e) => e.kind === "gate.passed").length).toBe(2);
  });
});
