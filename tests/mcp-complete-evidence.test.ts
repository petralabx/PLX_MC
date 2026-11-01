// P0d — actionComplete writes the tier-appropriate evidence bundle onto the task.
// Standard tier needs summary + done checklist + rollback; high/full tier also
// needs a test run (qa) or screenshots (shots). This proves the MCP complete-flow
// can supply that proof, so a high-risk PR (e.g. a migration) is gate-passable.
// All seams are mocked in-memory (same technique as compliance-server.test.ts).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { complete } from "@/lib/compliance/service";
import type { Task } from "@/lib/mc-data";

const db = vi.hoisted(() => ({
  dispatches: new Map<string, { taskId: string; accountableHuman: string; repo: string }>(),
  patched: [] as { taskId: string; patch: Record<string, unknown> }[],
  taskLabels: [] as string[],
  taskBucket: "BKT-OPEN",
  taskEvidence: undefined as unknown,
  taskStage: undefined as string | undefined,
  taskPrs: undefined as unknown[] | undefined,
  taskOwner: "vince" as string | undefined,
  taskGates: undefined as unknown[] | undefined,
  openTx: 0,
  events: [] as { kind: string; inTx: boolean; actor?: string; repo?: string | null; taskId?: string; payload?: Record<string, unknown> }[],
}));

vi.mock("@/lib/compliance/service", () => ({
  complete: vi.fn(async () => ({ ok: true })),
  checkout: vi.fn(async () => ({ checkoutId: "dsp_test" })),
}));

// Counts open transactions, so an event shows whether it was written inside one.
vi.mock("@/lib/db", () => ({
  withTransaction: vi.fn(async (fn: (q: unknown) => unknown) => {
    db.openTx += 1;
    try {
      return await fn({});
    } finally {
      db.openTx -= 1;
    }
  }),
}));

vi.mock("@/lib/compliance/repo", () => ({
  getDispatch: vi.fn(async (id: string) => db.dispatches.get(id) ?? null),
  appendEvent: vi.fn(async (event: (typeof db.events)[number]) => {
    db.events.push({ ...event, inTx: db.openTx > 0 });
  }),
}));

vi.mock("@/lib/sync", () => ({
  patchTask: vi.fn(async (taskId: string, patch: Record<string, unknown>) => {
    db.patched.push({ taskId, patch });
    return { id: taskId } as Task;
  }),
  createTask: vi.fn(),
  snapshot: vi.fn(),
}));

vi.mock("@/lib/sync/repo", () => ({
  getEntity: vi.fn(async () => ({ data: { id: "TASK-1", bucket: db.taskBucket, labels: db.taskLabels, evidence: db.taskEvidence, stage: db.taskStage, prs: db.taskPrs, accountableOwner: db.taskOwner, approvalGates: db.taskGates } })),
  getBuckets: vi.fn(async () => [{ id: "BKT-OPEN", project: null }]),
  getProjects: vi.fn(async () => []),
}));

vi.mock("@/lib/mcp/sync-meta", () => ({
  syncMetaForTask: vi.fn(async () => ({ status: "queued" })),
}));

vi.mock("@/lib/routing/mutations/actors", () => ({
  requireMcpActor: vi.fn((_identity: unknown, _cap: string) => ({
    actor: { kind: "service", id: "sp_mcp_cursor", status: "active" },
    actorId: "sp_mcp_cursor",
    actorKind: "service",
    auditLabel: "vince@example.com",
  })),
  aclPrincipalFromMcp: () => ({ tokens: ["sp_mcp_cursor"] }),
}));

import { CreatorApprovalRefusal } from "@/lib/compliance/creator-approval";
import { actionComplete, completionReview, prlessCodeReview, shouldPromotePrlessCompletion } from "@/lib/mcp/actions";
import { patchTask } from "@/lib/sync";
import type { McpIdentity } from "@/lib/mcp/auth";

const identity: McpIdentity = {
  operatorEmail: "vince@example.com",
  runtime: "cursor",
  workerId: "test",
  repo: "petralabx/PLX_MC",
  servicePrincipalId: "sp_mcp_cursor",
  actor: { kind: "service", id: "sp_mcp_cursor", status: "active" },
};

beforeEach(() => {
  db.dispatches.clear();
  db.patched.length = 0;
  db.events.length = 0;
  db.taskLabels = [];
  db.taskBucket = "BKT-OPEN";
  db.taskEvidence = undefined;
  db.taskStage = undefined;
  db.taskPrs = undefined;
  db.taskOwner = "vince";
  db.taskGates = undefined;
  vi.mocked(complete).mockClear();
  db.dispatches.set("dsp_test", { taskId: "TASK-900", accountableHuman: "vince", repo: "petralabx/PLX_MC" });
});

describe("actionComplete evidence (P0d)", () => {
  it("standard bundle: writes summary + done checklist + rollback, no qa", async () => {
    await actionComplete(identity, {
      checkoutId: "dsp_test",
      summary: "did the thing",
      verificationCommands: ["npm test"],
      rollback: "revert the PR",
    });
    const ev = db.patched.at(-1)?.patch.evidence as Record<string, unknown>;
    expect(ev.summary).toBe("did the thing");
    expect(ev.rollback).toBe("revert the PR");
    expect(ev.qa).toBeUndefined();
    expect(ev.shots).toBeUndefined();
  });

  it("high/full bundle: a testRun lands as evidence.qa so a high-risk PR is gate-passable", async () => {
    const res = await actionComplete(identity, {
      checkoutId: "dsp_test",
      summary: "migration applied",
      verificationCommands: ["npx vitest run"],
      rollback: "db/rollback/011_projects_rollback.sql",
      testRun: { suite: "vitest", passed: 637, failed: 0 },
    });
    const ev = db.patched.at(-1)?.patch.evidence as { qa?: { pass: number; fail: number; total: number; suite: string } };
    expect(ev.qa).toBeDefined();
    expect(ev.qa?.pass).toBe(637);
    expect(ev.qa?.fail).toBe(0);
    expect(ev.qa?.total).toBe(637);
    expect(ev.qa?.suite).toBe("vitest");
    // The returned envelope echoes the qa proof too.
    expect(res.evidence.qa).not.toBeNull();
  });

  it("screenshots are accepted as the alternative full-tier proof", async () => {
    await actionComplete(identity, {
      checkoutId: "dsp_test",
      summary: "ui change",
      rollback: "revert",
      shots: [{ label: "before", cap: "old" }, { label: "after", cap: "new" }],
    });
    const ev = db.patched.at(-1)?.patch.evidence as { shots?: { label: string }[] };
    expect(ev.shots).toHaveLength(2);
  });

  // TASK-3166: files from mc_upload_evidence are not lost when the hand-in rebuilds the evidence.
  it("keeps the artifacts uploaded before the hand-in", async () => {
    const artifacts = [{ kind: "diagram", driveItemId: "item-1", url: "https://sp/item-1" }];
    db.taskEvidence = { summary: "old", items: [], artifacts };
    await actionComplete(identity, { checkoutId: "dsp_test", summary: "new summary", verificationCommands: ["npm test"], rollback: "revert" });
    const ev = db.patched.at(-1)?.patch.evidence as { summary: string; artifacts?: unknown[] };
    expect(ev.summary).toBe("new summary");
    expect(ev.artifacts).toEqual(artifacts);
  });
});

describe("UAT code completion requires a PR", () => {
  const handIn = (over: Partial<Parameters<typeof actionComplete>[1]> = {}) =>
    actionComplete(identity, {
      checkoutId: "dsp_test", summary: "Fix ready for review.",
      verificationCommands: ["npm test"], rollback: "revert", ...over,
    });

  beforeEach(() => {
    db.taskBucket = "BKT-UAT";
    db.taskLabels = ["kind:code", "uat:feedback-123"];
  });

  it.each([undefined, "", "   "])("refuses missing/blank prUrl %j before writing", async (prUrl) => {
    await expect(handIn({ prUrl })).rejects.toMatchObject({ code: "uat_code_pr_required", status: 400 });
    expect(complete).not.toHaveBeenCalled();
    expect(db.patched).toHaveLength(0);
  });

  it("does not treat a branch push or summary claiming failure as an explicit outcome", async () => {
    await expect(handIn({ summary: "branch push only; blocked", outcome: "completed" }))
      .rejects.toMatchObject({ code: "uat_code_pr_required" });
    expect(complete).not.toHaveBeenCalled();
  });

  it("accepts a PR link", async () => {
    const prUrl = "https://github.com/petralabx/PLX_MC/pull/999";
    await expect(handIn({ prUrl })).resolves.toMatchObject({ ok: true });
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ prUrl }));
    expect(db.patched).toHaveLength(1);
  });

  it.each(["blocked", "failed"] as const)("accepts and forwards explicit %s without a PR", async (outcome) => {
    await expect(handIn({ outcome })).resolves.toMatchObject({ ok: true, evidence: { outcome } });
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ outcome }));
    expect(db.patched).toHaveLength(1);
  });

  it("refuses a ticket task that has been moved out of BKT-UAT", async () => {
    db.taskBucket = "BKT-OPEN";
    db.taskLabels = ["kind:code", "uat:feedback-123"];
    await expect(handIn()).rejects.toMatchObject({ code: "uat_code_pr_required", status: 400 });
    expect(complete).not.toHaveBeenCalled();
    expect(db.patched).toHaveLength(0);
  });

  it.each([
    { bucket: "BKT-UAT", labels: ["kind:docs", "uat:feedback-123"] },
    { bucket: "BKT-UAT", labels: ["kind:code"] },
    { bucket: "BKT-UAT", labels: ["kind:code", "uat:"] },
    { bucket: "BKT-UAT", labels: ["kind:code", "uat: "] },
    { bucket: "BKT-UAT", labels: ["kind:code", "other:uat:feedback-123"] },
  ])("leaves non-matching tasks unaffected: %j", async ({ bucket, labels }) => {
    db.taskBucket = bucket;
    db.taskLabels = labels;
    await expect(handIn()).resolves.toMatchObject({ ok: true });
    expect(complete).toHaveBeenCalledTimes(1);
  });
});

// TASK-3165: on work a person must verify, the summary is held to STE-lite. It
// is checked before complete() releases the checkout, so a refused hand-in can
// be fixed and sent again on the same checkout.
describe("actionComplete evidence standard (TASK-3165)", () => {
  const longSummary = `${Array.from({ length: 30 }, (_, i) => `word${i}`).join(" ")}.`;
  const handIn = (over: Partial<Parameters<typeof actionComplete>[1]> = {}) =>
    actionComplete(identity, {
      checkoutId: "dsp_test",
      summary: longSummary,
      verificationCommands: ["npm test"],
      rollback: "revert the PR",
      ...over,
    });

  afterEach(() => vi.useRealTimers());
  const at = (iso: string) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(iso));
  };

  it("hands in during the warn-only week and returns the findings", async () => {
    at("2026-10-20T12:00:00Z");
    db.taskLabels = ["verify:human"];
    const res = await handIn();
    expect(complete).toHaveBeenCalledTimes(1);
    expect(res.evidenceStandard).toMatchObject({ applies: true, mode: "warn", enforceFrom: "2026-10-24T04:00:00.000Z" });
    expect(res.evidenceStandard.findings).toMatchObject([{ rule: "sentence-length", severity: "error" }]);
  });

  it("refuses the hand-in after the week, before the checkout is released", async () => {
    at("2026-10-25T12:00:00Z");
    db.taskLabels = ["kind:human-test"];
    await expect(handIn()).rejects.toMatchObject({ code: "evidence_standard", status: 400 });
    expect(complete).not.toHaveBeenCalled();
    expect(db.patched).toHaveLength(0);
  });

  it("holds an unlabelled high-risk change (from filesChanged) to the standard", async () => {
    at("2026-10-25T12:00:00Z");
    await expect(handIn({ filesChanged: ["src/lib/auth/edge.ts"] })).rejects.toMatchObject({ code: "evidence_standard" });
    await expect(handIn({ filesChanged: ["src/components/mc/help.tsx"] })).resolves.toMatchObject({ ok: true });
  });

  it("accepts a clean summary after the week", async () => {
    at("2026-10-25T12:00:00Z");
    db.taskLabels = ["verify:human"];
    const res = await handIn({ summary: "API calls now get a 401. The browser goes to sign-in." });
    expect(res.evidenceStandard.findings).toEqual([]);
  });
});

describe("mc_complete_task transport contracts", () => {
  it("exposes and forwards the REST completion evidence fields over stdio", () => {
    const source = readFileSync(
      join(process.cwd(), "tools/plx-mc-mcp/index.ts"),
      "utf8"
    );
    const start = source.indexOf('"mc_complete_task"');
    const end = source.indexOf("\nserver.tool(", start + 1);
    const block = source.slice(start, end);

    expect(block).toContain("verificationCommands: z.array(z.string().trim().min(1)).min(1)");
    expect(block).toContain("rollback: z.string().trim().min(1)");
    expect(block).toContain('outcome: z.enum(["completed", "blocked", "failed"]).optional()');
    expect(block).toContain("testRun: z");
    expect(block).toContain("shots: z.array");
    expect(block).toContain('mcFetch("/complete", { method: "POST", body })');
  });

  it("exposes and forwards the REST completion evidence fields over HTTP", () => {
    const source = readFileSync(
      join(process.cwd(), "src/lib/mcp/create-http-server.ts"),
      "utf8"
    );
    const start = source.indexOf('"mc_complete_task"');
    const end = source.indexOf("\n  server.tool(", start + 1);
    const block = source.slice(start, end);

    // The HTTP tool and REST route share one required-evidence shape.
    expect(block).toContain("completeTaskInputShape");
    expect(block).toContain("actionComplete(identity, body)");
  });
});

// TASK-4017: a PR-less completion used to leave the task in backlog.
describe("PR-less completion moves the task to the done stage", () => {
  const handIn = (over: Partial<Parameters<typeof actionComplete>[1]> = {}) =>
    actionComplete(identity, { checkoutId: "dsp_test", summary: "done", verificationCommands: ["npm test"], rollback: "revert", ...over });

  it("backlog task with no PR rows goes to merged, never verified", async () => {
    db.taskStage = "backlog";
    db.taskPrs = [];
    await handIn();
    const patch = db.patched.at(-1)?.patch;
    expect(patch?.stage).toBe("merged");
    expect(patch?.stage).not.toBe("verified");
  });

  describe("when the creator gate refuses that move (TASK-4293)", () => {
    const refuse = () =>
      vi.mocked(patchTask).mockImplementationOnce(async () => {
        throw new CreatorApprovalRefusal(
          { id: "TASK-900", creatorApproval: { principal: "sp_mcp_workbench_intake", status: "pending", requestedAt: "2026-10-31T00:00:00.000Z" } },
          "merged",
          { actor: "vince@example.com", actorId: "sp_mcp_cursor" },
          "TASK-900 waits for creator approval."
        );
      });
    const blocked = () => db.events.filter((event) => event.kind === "creator_approval.blocked");
    beforeEach(() => {
      db.taskStage = "backlog";
      db.taskPrs = [];
    });

    it("records it once, after its transaction has closed", async () => {
      refuse();
      await expect(handIn()).rejects.toMatchObject({ code: "creator_approval_pending", status: 409 });
      expect(blocked()).toEqual([
        expect.objectContaining({
          inTx: false,
          taskId: "TASK-900",
          actor: "cursor:vince@example.com",
          repo: "petralabx/PLX_MC",
          payload: expect.objectContaining({ action: "stage", requestedStage: "merged", door: "mcp", actorId: "sp_mcp_cursor" }),
        }),
      ]);
    });

    // A Hub connector checks out work on another repo; the hand-in's other events name the checkout's repo.
    it("names the checkout's repo, not the connector's", async () => {
      db.dispatches.set("dsp_test", { taskId: "TASK-900", accountableHuman: "vince", repo: "petralabx/plx-customer-portal" });
      refuse();
      await expect(handIn()).rejects.toMatchObject({ code: "creator_approval_pending" });
      expect(blocked().map((event) => event.repo)).toEqual(["petralabx/plx-customer-portal"]);
    });
  });

  it("task with a PR row keeps its existing path (no stage change)", async () => {
    db.taskStage = "backlog";
    db.taskPrs = [{ repo: "PLX_MC", num: 12, status: "open" }];
    await handIn();
    expect(db.patched.at(-1)?.patch.stage).toBeUndefined();
  });

  it("a hand-in carrying prUrl stays on the PR path", async () => {
    db.taskStage = "progress";
    db.taskPrs = [];
    await handIn({ prUrl: "https://github.com/petralabx/PLX_MC/pull/1" });
    expect(db.patched.at(-1)?.patch.stage).toBeUndefined();
  });

  it("blocked/failed outcomes do not promote", async () => {
    db.taskStage = "backlog";
    db.taskPrs = [];
    await handIn({ outcome: "blocked" });
    expect(db.patched.at(-1)?.patch.stage).toBeUndefined();
  });

  it("already-done stages are left alone", async () => {
    db.taskStage = "verified";
    db.taskPrs = [];
    await handIn();
    expect(db.patched.at(-1)?.patch.stage).toBeUndefined();
  });

  it("TASK-3992 shape: completed early with an open PR at review stays at review", async () => {
    db.taskStage = "review";
    db.taskPrs = [{ repo: "PLX_MC", num: 463, status: "open" }];
    await handIn();
    expect(db.patched.at(-1)?.patch.stage).toBeUndefined();
  });

  it("does not promote a UAT ticket task", () => {
    expect(shouldPromotePrlessCompletion(
      { stage: "backlog", prs: [], labels: ["kind:code", "uat:feedback-123"] },
      {},
    )).toBe(false);
  });
});

// TASK-4378 (zero-drift item 4): completing with an open, ready PR moves the
// task to In Review, so the agent makes no second call. The merge moves it on.
describe("completion with an open, ready PR moves the task to In Review", () => {
  const PR = "https://github.com/petralabx/agentic-swarm/pull/1811";
  const handIn = (over: Partial<Parameters<typeof actionComplete>[1]> = {}) =>
    actionComplete(identity, { checkoutId: "dsp_test", summary: "done", verificationCommands: ["npm test"], rollback: "revert", prUrl: PR, ...over });
  beforeEach(() => {
    db.taskStage = "progress";
    db.taskPrs = [{ repo: "agentic-swarm", num: 1811, status: "open", title: "t" }];
  });

  it("moves an In Progress task to In Review and says so", async () => {
    const res = await handIn();
    const patch = db.patched.at(-1)?.patch;
    expect(patch?.stage).toBe("review");
    expect(patch?.activityLine).toMatchObject({ kind: "move", what: expect.stringContaining("agentic-swarm#1811") });
    expect(res.review).toEqual({ moved: true });
  });

  it("matches the PR row whatever the URL's letter case", async () => {
    await handIn({ prUrl: "https://github.com/petralabx/Agentic-Swarm/pull/1811" });
    expect(db.patched.at(-1)?.patch.stage).toBe("review");
  });

  it.each(["draft", "merged", "closed"])("leaves the stage alone when the PR is %s, and says what to do", async (status) => {
    db.taskPrs = [{ repo: "agentic-swarm", num: 1811, status, title: "t" }];
    const res = await handIn();
    expect(db.patched.at(-1)?.patch.stage).toBeUndefined();
    expect(res.review).toEqual({ moved: false, reason: expect.stringContaining(`agentic-swarm#1811 is ${status}`) });
    expect(res.review?.reason).toContain("mc_report_progress");
  });

  it("leaves the stage alone when the task does not hold that PR yet", async () => {
    const res = await handIn({ prUrl: "https://github.com/petralabx/agentic-swarm/pull/1812" });
    expect(db.patched.at(-1)?.patch.stage).toBeUndefined();
    expect(res.review?.reason).toContain("agentic-swarm#1812 is not linked to this task yet");
  });

  it("says nothing about In Review when the hand-in has no PR link", async () => {
    const res = await handIn({ prUrl: undefined });
    expect(res.review).toBeUndefined();
  });

  it("never moves a blocked or failed hand-in", async () => {
    await handIn({ outcome: "blocked" });
    expect(db.patched.at(-1)?.patch.stage).toBeUndefined();
  });

  it.each(["review", "merged", "verified", "cancelled"])("never moves a task that is already %s", async (stage) => {
    db.taskStage = stage;
    await handIn();
    expect(db.patched.at(-1)?.patch.stage).toBeUndefined();
  });

  it("keeps the stage under a pending approval gate, still records the hand-in, and says why", async () => {
    db.taskGates = [{ id: "apg_1", status: "pending", reason: "workflow change" }];
    const res = await handIn();
    const patch = db.patched.at(-1)?.patch;
    expect(patch?.stage).toBeUndefined();
    expect(patch?.evidence).toBeDefined();
    expect(res.review).toEqual({ moved: false, reason: expect.stringContaining("pending approval gate") });
  });

  it("keeps the stage when the task has no human accountable owner", async () => {
    db.taskOwner = undefined;
    const res = await handIn();
    expect(db.patched.at(-1)?.patch.stage).toBeUndefined();
    expect(res.review?.moved).toBe(false);
  });

  it("reads only github.com pull URLs", () => {
    const task = { stage: "progress" as const, prs: [{ repo: "agentic-swarm", num: 1811, status: "open" as const, title: "t" }] };
    expect(completionReview(task, { prUrl: PR })).toMatchObject({ pr: { num: 1811 } });
    expect(completionReview(task, { prUrl: "agentic-swarm#1811" })).toBeNull();
    expect(completionReview(task, {})).toBeNull();
  });
});

// TASK-4187: on Oct 30 a plain completion set TASK-4170 and TASK-4174 to merged while their PRs were
// still open, because the PRs were not linked yet. A code task reaches merged only through its merged PR.
describe("a code task completed before its PR is linked waits in review", () => {
  const handIn = (over: Partial<Parameters<typeof actionComplete>[1]> = {}) =>
    actionComplete(identity, { checkoutId: "dsp_test", summary: "done", verificationCommands: ["npm test"], rollback: "revert", ...over });
  beforeEach(() => {
    db.taskStage = "progress";
    db.taskPrs = [];
    db.taskLabels = ["kind:code", "lane:claude-cli"];
  });

  it("moves it to In Review, not merged, and says why", async () => {
    const res = await handIn();
    const patch = db.patched.at(-1)?.patch;
    expect(patch?.stage).toBe("review");
    expect(patch?.activityLine).toMatchObject({ kind: "move", what: expect.stringContaining("no linked PR yet") });
    expect(res.review).toEqual({ moved: true });
  });

  it("still sends a non-code task with no PR to merged (TASK-4017)", async () => {
    db.taskLabels = ["kind:admin-setup"];
    await handIn();
    expect(db.patched.at(-1)?.patch.stage).toBe("merged");
  });

  it("keeps the stage under a pending approval gate and says why", async () => {
    db.taskGates = [{ id: "apg_1", status: "pending", reason: "workflow change" }];
    const res = await handIn();
    expect(db.patched.at(-1)?.patch.stage).toBeUndefined();
    expect(res.review).toEqual({ moved: false, reason: expect.stringContaining("pending approval gate") });
  });

  it.each(["review", "merged", "verified"])("leaves a task already %s alone", async (stage) => {
    db.taskStage = stage;
    await handIn();
    expect(db.patched.at(-1)?.patch.stage).toBeUndefined();
  });

  it("never moves a blocked hand-in, a UAT ticket, a task with a PR row, or a hand-in naming a PR", () => {
    const task = { stage: "progress" as const, prs: [], labels: ["kind:code"] };
    expect(prlessCodeReview(task, {})).toBe(true);
    expect(prlessCodeReview(task, { outcome: "blocked" })).toBe(false);
    expect(prlessCodeReview({ ...task, labels: ["kind:code", "uat:feedback-1"] }, {})).toBe(false);
    expect(prlessCodeReview({ ...task, prs: [{ repo: "PLX_MC", num: 1, status: "open", title: "t" }] }, {})).toBe(false);
    expect(prlessCodeReview(task, { prUrl: "https://github.com/petralabx/PLX_MC/pull/1" })).toBe(false);
    expect(shouldPromotePrlessCompletion(task, {})).toBe(false);
  });
});
