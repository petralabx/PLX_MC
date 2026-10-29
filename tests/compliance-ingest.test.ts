// EN-007 P1 — git → MC ingestion. Signature verification + PR-event parsing are
// pure (real crypto); ingestPullRequest is proven against a mocked repo seam (no
// DB), the same technique as tests/mc-patch.test.ts.
import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { parsePullRequestEvent, resolvePrTask, verifyGithubSignature } from "@/lib/compliance/webhook";

const db = vi.hoisted(() => ({
  dispatches: new Map<string, { id: string; actorKind: "agent" | "operator"; taskId: string; revoked: boolean; repo: string; expiresAt: string }>(),
  events: [] as { kind: string; actor: string; repo?: string | null; taskId?: string | null; pr?: string | null; payload?: Record<string, unknown>; dedupKey?: string }[],
}));

vi.mock("@/lib/compliance/projection", () => ({
  projectionEnabled: () => false,
  projectPullRequest: vi.fn(async () => {}),
}));

const renewDispatches = vi.hoisted(() => vi.fn(async () => {}));
const order = vi.hoisted(() => [] as string[]);
const recordMergeOnTask = vi.hoisted(() => vi.fn(async (r: { taskId: string }) => { order.push(`note:${r.taskId}`); return true; }));
const releaseDispatches = vi.hoisted(() => vi.fn(async (ids: string[]) => { order.push(`release:${ids.join(",")}`); }));

vi.mock("@/lib/compliance/merge-note", () => ({ recordMergeOnTask }));

vi.mock("@/lib/compliance/repo", () => ({
  releaseDispatches,
  openPrCandidatesForTask: async () => [],
  renewDispatches,
  dispatchHeads: async () => [],
  recordDispatchHead: async () => true,
  async getDispatch(id: string) {
    return db.dispatches.get(id) ?? null;
  },
  async appendEvent(e: { kind: string; actor: string; repo?: string | null; taskId?: string | null; pr?: string | null; payload?: Record<string, unknown>; dedupKey?: string }) {
    db.events.push(e);
  },
  async eventTaskIdByDedupKey(dedupKey: string) {
    return db.events.find((e) => e.dedupKey === dedupKey)?.taskId ?? null;
  },
}));

import { ingestPullRequest } from "@/lib/compliance/service";

beforeEach(() => {
  db.dispatches.clear();
  db.events.length = 0;
  renewDispatches.mockClear();
  recordMergeOnTask.mockClear();
  releaseDispatches.mockClear();
  order.length = 0;
});

function prPayload(over: Record<string, unknown> = {}, prOver: Record<string, unknown> = {}) {
  return {
    action: "opened",
    repository: { name: "PLX_MC", full_name: "petralabx/PLX_MC" },
    pull_request: {
      number: 42,
      merged: false,
      title: "Add the thing",
      body: "Implements the thing.",
      head: { sha: "abc123", ref: "feat/x" },
      user: { login: "greg" },
      labels: [{ name: "go-live" }],
      ...prOver,
    },
    ...over,
  };
}

describe("verifyGithubSignature", () => {
  const secret = "s3cr3t";
  const raw = JSON.stringify({ hello: "world" });
  const good = "sha256=" + createHmac("sha256", secret).update(raw, "utf8").digest("hex");

  it("accepts a correct signature and rejects tampering / absence", () => {
    expect(verifyGithubSignature(raw, good, secret)).toBe(true);
    expect(verifyGithubSignature(raw + "x", good, secret)).toBe(false);
    expect(verifyGithubSignature(raw, "sha256=deadbeef", secret)).toBe(false);
    expect(verifyGithubSignature(raw, null, secret)).toBe(false);
  });
});

describe("parsePullRequestEvent", () => {
  it("normalizes a PR event and extracts the checkout marker from the body", () => {
    const evt = parsePullRequestEvent(prPayload({}, { body: "Work for the gate.\n\nMC-Checkout: dsp_abc123" }))!;
    expect(evt).toMatchObject({ action: "opened", repo: "PLX_MC", prNumber: 42, headSha: "abc123", author: "greg", checkoutId: "dsp_abc123" });
    expect(evt.labels).toEqual(["go-live"]);
  });

  it("carries merged_at as mergedAt only for merged PRs", () => {
    const merged = parsePullRequestEvent(
      prPayload({ action: "closed" }, { merged: true, merged_at: "2026-07-23T15:04:05Z", merge_commit_sha: "m1" })
    )!;
    expect(merged.mergedAt).toBe("2026-07-23T15:04:05Z");
    expect(parsePullRequestEvent(prPayload({ action: "closed" }, { merged_at: "2026-07-23T15:04:05Z" }))!.mergedAt).toBeNull();
  });

  it("carries a synchronize push's before SHA as beforeSha (TASK-3410)", () => {
    expect(parsePullRequestEvent(prPayload({ action: "synchronize", before: "b".repeat(40) }))?.beforeSha).toBe("b".repeat(40));
    expect(parsePullRequestEvent(prPayload())?.beforeSha).toBeNull();
  });

  it("flags a PR whose head lives in a fork, or in a deleted fork, as crossRepo (TASK-4004)", () => {
    const head = (repo: unknown) => prPayload({}, { head: { sha: "abc123", ref: "feat/x", repo } });
    expect(parsePullRequestEvent(head({ full_name: "outsider/PLX_MC" }))?.crossRepo).toBe(true);
    expect(parsePullRequestEvent(head(null))?.crossRepo).toBe(true);
    expect(parsePullRequestEvent(head({ full_name: "petralabx/plx_mc" }))?.crossRepo).toBe(false);
  });

  it("carries GitHub's draft flag (TASK-3743)", () => {
    expect(parsePullRequestEvent(prPayload({}, { draft: true }))?.draft).toBe(true);
    expect(parsePullRequestEvent(prPayload())?.draft).toBe(false);
  });

  it("returns null for a non-pull_request payload", () => {
    expect(parsePullRequestEvent({ action: "push" })).toBeNull();
    expect(parsePullRequestEvent(null)).toBeNull();
  });

  it("extracts EVERY checkout stamp (multi-task), deduped, first as checkoutId", () => {
    const body = "Two tasks.\n\nMC-Checkout: dsp_aaa\nMC-Checkout: dsp_bbb\nMC-Checkout: dsp_aaa";
    const evt = parsePullRequestEvent(prPayload({}, { body }))!;
    expect(evt.checkoutIds).toEqual(["dsp_aaa", "dsp_bbb"]);
    expect(evt.checkoutId).toBe("dsp_aaa");
  });

  it("has an empty checkoutIds and null checkoutId when there is no stamp", () => {
    const evt = parsePullRequestEvent(prPayload())!;
    expect(evt.checkoutIds).toEqual([]);
    expect(evt.checkoutId).toBeNull();
  });
});

// TASK-4004: the PR's task, from its checkout, else its title, else its branch.
describe("resolvePrTask", () => {
  const pr = (title: string, branch: string) => ({ title, branch });

  it("leaves a stamped PR to its checkouts, whatever the title or branch names", () => {
    expect(resolvePrTask(pr("Fix TASK-2", "claude/task-3-x"), ["dsp_a"])).toEqual({ kind: "checkout" });
    expect(resolvePrTask(pr("TASK-1 and TASK-2", ""), ["dsp_a", "dsp_b"])).toEqual({ kind: "checkout" });
  });

  it("takes the title's id when no checkout resolves, over the branch's", () => {
    expect(resolvePrTask(pr("feat(x): the thing (TASK-4004)", "claude/task-3999-y"), [])).toEqual({ kind: "resolved", source: "title", taskIds: ["TASK-4004"] });
  });

  it("takes the branch's id when the title names none, in any case at a segment start", () => {
    expect(resolvePrTask(pr("feat(x): the thing", "cursor/task-4004-autolink"), [])).toEqual({ kind: "resolved", source: "branch", taskIds: ["TASK-4004"] });
    expect(resolvePrTask(pr("Task-4005: autolink", "feat/x"), [])).toEqual({ kind: "resolved", source: "title", taskIds: ["TASK-4005"] });
    expect(resolvePrTask(pr("feat(x): the thing", "Claude/Task-4006-x"), [])).toEqual({ kind: "resolved", source: "branch", taskIds: ["TASK-4006"] });
  });

  it("counts one id named twice as one", () => {
    expect(resolvePrTask(pr("TASK-7: fix the TASK-7 regression", ""), [])).toEqual({ kind: "resolved", source: "title", taskIds: ["TASK-7"] });
  });

  it("is ambiguous when the title names several ids, and does not fall back to the branch", () => {
    expect(resolvePrTask(pr("TASK-1 and TASK-2", "feat/task-3"), [])).toEqual({ kind: "ambiguous", source: "title", taskIds: ["TASK-1", "TASK-2"] });
  });

  it("is ambiguous when the branch names several ids", () => {
    expect(resolvePrTask(pr("no id here", "feat/TASK-1/TASK-2"), [])).toEqual({ kind: "ambiguous", source: "branch", taskIds: ["TASK-1", "TASK-2"] });
  });

  it("resolves nothing when no source names a task", () => {
    expect(resolvePrTask(pr("Add the thing", "feat/x"), [])).toEqual({ kind: "none" });
  });

  it("reads only whole TASK-n tokens: subtask-2, setup-task-2, MY_TASK-2 or TASK-12a name no task", () => {
    expect(resolvePrTask(pr("Fix subtask-2 rendering", "feat/multitask-3-ui"), [])).toEqual({ kind: "none" });
    expect(resolvePrTask(pr("Fix onboarding task-3 copy", "dependabot/github_actions/arduino/setup-task-2"), [])).toEqual({ kind: "none" });
    expect(resolvePrTask(pr("MY_TASK-2 fix", "feat/SETUP-TASK-2-x"), [])).toEqual({ kind: "none" });
    expect(resolvePrTask(pr("TASK-12a draft", "feat/TASK-4004_autolink"), [])).toEqual({ kind: "resolved", source: "branch", taskIds: ["TASK-4004"] });
  });

  it("marks a fork PR, which anyone can open on a public repo, so it links nothing", () => {
    expect(resolvePrTask({ title: "Fix TASK-4004", branch: "main", crossRepo: true }, [])).toEqual({ kind: "fork", source: "title", taskIds: ["TASK-4004"] });
  });

  it("marks a revert, by its title or its branch, so it links nothing", () => {
    const revert = (source: "title" | "branch") => ({ kind: "revert", source, taskIds: ["TASK-4004"] });
    expect(resolvePrTask(pr('Revert "feat: x (TASK-4004)"', "revert-512-claude/task-4004-x"), [])).toEqual(revert("title"));
    expect(resolvePrTask(pr("Undo x (TASK-4004)", "revert-512-claude/task-4004-x"), [])).toEqual(revert("title"));
    expect(resolvePrTask(pr("revert: back out TASK-4004 autolink", "fix/x"), [])).toEqual(revert("title"));
    expect(resolvePrTask(pr("revert(compliance): back out TASK-4004", "fix/x"), [])).toEqual(revert("title"));
    expect(resolvePrTask(pr("Reverts TASK-4004 pricing change", "cos/undo-pricing"), [])).toEqual(revert("title"));
    expect(resolvePrTask(pr("Reverted the TASK-4004 change", "cos/undo-pricing"), [])).toEqual(revert("title"));
    expect(resolvePrTask(pr("Reverting TASK-4004 autolink", "cos/undo-autolink"), [])).toEqual(revert("title"));
    expect(resolvePrTask(pr("chore: revert TASK-4004 pricing change", "cos/undo-pricing"), [])).toEqual(revert("title"));
    expect(resolvePrTask(pr("fix(api)!: Revert TASK-4004", "cos/undo-pricing"), [])).toEqual(revert("title"));
    expect(resolvePrTask(pr("TASK-4004: Revert pricing change", "cos/undo-pricing"), [])).toEqual(revert("title"));
    expect(resolvePrTask(pr("[TASK-4004] Revert pricing", "cos/undo-pricing"), [])).toEqual(revert("title"));
    // Conservative: a title about a revert feature is skipped too, and recorded.
    expect(resolvePrTask(pr("Add revert button (TASK-4004)", "feat/x"), [])).toEqual(revert("title"));
    expect(resolvePrTask(pr("Back out the autolink", "revert-512-claude/task-4004-x"), [])).toEqual(revert("branch"));
    expect(resolvePrTask(pr("Revert-safe migrations (TASK-4004)", "feat/x"), [])).toEqual({ kind: "resolved", source: "title", taskIds: ["TASK-4004"] });
  });
});

describe("ingestPullRequest", () => {
  it("records an agent PR open against its checked-out task", async () => {
    db.dispatches.set("dsp_x", { id: "dsp_x", actorKind: "agent", taskId: "TASK-900", revoked: false, repo: "petralabx/PLX_MC", expiresAt: new Date(Date.now() + 3_600_000).toISOString() });
    const evt = parsePullRequestEvent(prPayload({}, { body: "x\nMC-Checkout: dsp_x" }))!;
    const r = await ingestPullRequest(evt);
    expect(r).toMatchObject({ actorKind: "agent", taskId: "TASK-900", recorded: true });
    const e = db.events.find((x) => x.kind === "pr.opened")!;
    expect(e.taskId).toBe("TASK-900");
    expect(e.payload).toMatchObject({ sparse: false, actorKind: "agent" });
    // TASK-3409: activity on the stamped PR keeps its checkout alive.
    expect(renewDispatches).toHaveBeenCalledWith(["dsp_x"], { repo: "petralabx/PLX_MC", pr: evt.prNumber, ttlMinutes: 480 });
  });

  it("records an operator PR (no checkout) as unrouted/action_required — not a sparse Task", async () => {
    const evt = parsePullRequestEvent(prPayload())!; // no MC-Checkout marker
    const r = await ingestPullRequest(evt);
    expect(r).toMatchObject({ actorKind: "operator", taskId: null });
    const e = db.events.find((x) => x.kind === "pr.opened")!;
    expect(e.actor).toBe("greg");
    expect(e.payload).toMatchObject({ sparse: true, actionRequired: true });
    expect(db.events.some((x) => x.kind === "task.sparse_created")).toBe(false);
    expect(db.events.some((x) => x.kind === "routing.proposal.triage")).toBe(true);
  });

  it("emits pr.merged + a task.promotion.requested seam on merge", async () => {
    db.dispatches.set("dsp_x", { id: "dsp_x", actorKind: "agent", taskId: "TASK-900", revoked: false, repo: "petralabx/PLX_MC", expiresAt: new Date(Date.now() + 3_600_000).toISOString() });
    const evt = parsePullRequestEvent(prPayload({ action: "closed" }, { merged: true, body: "x\nMC-Checkout: dsp_x" }))!;
    await ingestPullRequest(evt);
    expect(db.events.map((e) => e.kind)).toEqual(expect.arrayContaining(["pr.merged", "task.promotion.requested"]));
  });

  // Checkout TTL gates new work; it must not erase attribution for a PR that
  // passed the gate in time but merged after the credential expired.
  describe("merge after the checkout TTL", () => {
    const expired = (over: Partial<{ revoked: boolean; repo: string }> = {}) => ({
      id: "dsp_old", actorKind: "agent" as const, taskId: "TASK-901", revoked: false, repo: "petralabx/PLX_MC",
      expiresAt: new Date(Date.now() - 24 * 3_600_000).toISOString(), ...over,
    });
    const gatePassed = (taskId: string) =>
      db.events.push({ kind: "gate.passed", actor: "claude-code", repo: "PLX_MC", taskId, pr: "42", dedupKey: `gate:PLX_MC:42:abc123:${taskId}:pass` });
    const mergeEvt = () =>
      parsePullRequestEvent(prPayload({ action: "closed" }, { merged: true, body: "x\nMC-Checkout: dsp_old" }))!;

    it("keeps the task link when the gate passed this head with that checkout", async () => {
      db.dispatches.set("dsp_old", expired());
      gatePassed("TASK-901");
      const r = await ingestPullRequest(mergeEvt());
      expect(r).toMatchObject({ actorKind: "agent", taskId: "TASK-901" });
      expect(db.events.filter((e) => e.kind === "task.promotion.requested").map((e) => e.taskId)).toEqual(["TASK-901"]);
    });

    it("does not attribute an expired checkout the gate never passed", async () => {
      db.dispatches.set("dsp_old", expired());
      const r = await ingestPullRequest(mergeEvt());
      expect(r.taskId).toBeNull();
    });

    it("never attributes a revoked or wrong-repo checkout, even after a pass", async () => {
      gatePassed("TASK-901");
      db.dispatches.set("dsp_old", expired({ revoked: true }));
      expect((await ingestPullRequest(mergeEvt())).taskId).toBeNull();
      db.dispatches.set("dsp_old", expired({ repo: "plx-customer-portal" }));
      expect((await ingestPullRequest(mergeEvt())).taskId).toBeNull();
    });
  });

  it("records a closed-without-merge PR as pr.closed, never pr.opened (B1)", async () => {
    const evt = parsePullRequestEvent(prPayload({ action: "closed" }, { merged: false }))!;
    const r = await ingestPullRequest(evt);
    expect(r.recorded).toBe(true);
    expect(db.events.some((e) => e.kind === "pr.closed")).toBe(true);
    expect(db.events.some((e) => e.kind === "pr.opened")).toBe(false);
  });

  it("ignores unhandled actions (e.g. labeled) — no spurious event (B1)", async () => {
    const evt = parsePullRequestEvent(prPayload({ action: "labeled" }))!;
    const r = await ingestPullRequest(evt);
    expect(r.recorded).toBe(false);
    expect(db.events.length).toBe(0);
  });

  it("records a PR marked ready for review under its own kind, never a second pr.opened (TASK-3743)", async () => {
    const evt = parsePullRequestEvent(prPayload({ action: "ready_for_review" }))!;
    const r = await ingestPullRequest(evt);
    expect(r.recorded).toBe(true);
    expect(db.events.some((e) => e.kind === "pr.opened")).toBe(false);
    expect(db.events.filter((e) => e.kind === "pr.ready_for_review").map((e) => e.dedupKey)).toEqual([
      "pr.ready_for_review:PLX_MC:42:abc123:ready_for_review",
    ]);
  });

  it("records a synchronize as pr.synchronized (T5)", async () => {
    const evt = parsePullRequestEvent(prPayload({ action: "synchronize" }))!;
    await ingestPullRequest(evt);
    expect(db.events.some((e) => e.kind === "pr.synchronized")).toBe(true);
  });

  // Multi-task parity: a PR completing N tasks attributes ALL of them.
  it("attributes every checked-out task on a multi-task PR open", async () => {
    db.dispatches.set("dsp_a", { id: "dsp_a", actorKind: "agent", taskId: "TASK-1", revoked: false, repo: "petralabx/PLX_MC", expiresAt: new Date(Date.now() + 3_600_000).toISOString() });
    db.dispatches.set("dsp_b", { id: "dsp_b", actorKind: "agent", taskId: "TASK-2", revoked: false, repo: "petralabx/PLX_MC", expiresAt: new Date(Date.now() + 3_600_000).toISOString() });
    const evt = parsePullRequestEvent(prPayload({}, { body: "two\nMC-Checkout: dsp_a\nMC-Checkout: dsp_b" }))!;
    const r = await ingestPullRequest(evt);
    expect(r).toMatchObject({ actorKind: "agent", taskId: "TASK-1", recorded: true });
    const e = db.events.find((x) => x.kind === "pr.opened")!;
    expect(e.taskId).toBe("TASK-1"); // primary = first (back-compat)
    expect(e.payload).toMatchObject({ taskIds: ["TASK-1", "TASK-2"], actorKind: "agent" });
  });

  it("emits one task.promotion.requested per task on a multi-task merge", async () => {
    db.dispatches.set("dsp_a", { id: "dsp_a", actorKind: "agent", taskId: "TASK-1", revoked: false, repo: "petralabx/PLX_MC", expiresAt: new Date(Date.now() + 3_600_000).toISOString() });
    db.dispatches.set("dsp_b", { id: "dsp_b", actorKind: "agent", taskId: "TASK-2", revoked: false, repo: "petralabx/PLX_MC", expiresAt: new Date(Date.now() + 3_600_000).toISOString() });
    const evt = parsePullRequestEvent(prPayload({ action: "closed" }, { merged: true, body: "two\nMC-Checkout: dsp_a\nMC-Checkout: dsp_b" }))!;
    await ingestPullRequest(evt);
    const promo = db.events.filter((e) => e.kind === "task.promotion.requested");
    expect(promo.map((e) => e.taskId).sort()).toEqual(["TASK-1", "TASK-2"]);
    expect(db.events.find((e) => e.kind === "pr.merged")!.payload).toMatchObject({ taskIds: ["TASK-1", "TASK-2"] });
  });

  // TASK-4150: the merge SHA, PR link and rollback land on the task before release.
  describe("merge note before release", () => {
    const live = (id: string, taskId: string) => ({
      id, actorKind: "agent" as const, taskId, revoked: false, repo: "petralabx/PLX_MC", runtime: "cursor-cloud",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });

    it("records the merge on the task, then releases with reason merged", async () => {
      db.dispatches.set("dsp_x", live("dsp_x", "TASK-900"));
      const evt = parsePullRequestEvent(
        prPayload({ action: "closed" }, { merged: true, merge_commit_sha: "abc999", body: "x\nMC-Checkout: dsp_x" })
      )!;
      await ingestPullRequest(evt);
      expect(recordMergeOnTask).toHaveBeenCalledWith({
        taskId: "TASK-900", repo: "petralabx/PLX_MC", prNumber: evt.prNumber, mergeSha: "abc999", checkoutIds: ["dsp_x"], actor: "cursor-cloud",
      });
      expect(releaseDispatches).toHaveBeenCalledWith(["dsp_x"], { repo: "petralabx/PLX_MC", pr: evt.prNumber, reason: "merged" });
      expect(order).toEqual(["note:TASK-900", "release:dsp_x"]);
    });

    it("writes one note per task when two checkouts of different tasks merge", async () => {
      db.dispatches.set("dsp_a", live("dsp_a", "TASK-1"));
      db.dispatches.set("dsp_b", live("dsp_b", "TASK-2"));
      const evt = parsePullRequestEvent(
        prPayload({ action: "closed" }, { merged: true, merge_commit_sha: "abc999", body: "two\nMC-Checkout: dsp_a\nMC-Checkout: dsp_b" })
      )!;
      await ingestPullRequest(evt);
      expect(order).toEqual(["note:TASK-1", "note:TASK-2", "release:dsp_a", "release:dsp_b"]);
    });

    it("does not release when the note fails, so the replay retries both", async () => {
      db.dispatches.set("dsp_x", live("dsp_x", "TASK-900"));
      recordMergeOnTask.mockRejectedValueOnce(new Error("db down"));
      const evt = parsePullRequestEvent(
        prPayload({ action: "closed" }, { merged: true, merge_commit_sha: "abc999", body: "x\nMC-Checkout: dsp_x" })
      )!;
      await expect(ingestPullRequest(evt)).rejects.toThrow("db down");
      expect(releaseDispatches).not.toHaveBeenCalled();
    });

    it("writes no note for a PR closed without merging, and releases as closed", async () => {
      db.dispatches.set("dsp_x", live("dsp_x", "TASK-900"));
      const evt = parsePullRequestEvent(prPayload({ action: "closed" }, { merged: false, body: "x\nMC-Checkout: dsp_x" }))!;
      await ingestPullRequest(evt);
      expect(recordMergeOnTask).not.toHaveBeenCalled();
      expect(releaseDispatches).toHaveBeenCalledWith(["dsp_x"], { repo: "petralabx/PLX_MC", pr: evt.prNumber, reason: "closed" });
    });
  });
});
