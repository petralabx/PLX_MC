// EN-007 P1 — git → MC ingestion. Signature verification + PR-event parsing are
// pure (real crypto); ingestPullRequest is proven against a mocked repo seam (no
// DB), the same technique as tests/mc-patch.test.ts.
import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { parsePullRequestEvent, verifyGithubSignature } from "@/lib/compliance/webhook";

const db = vi.hoisted(() => ({
  dispatches: new Map<string, { id: string; actorKind: "agent" | "operator"; taskId: string; revoked: boolean; repo: string; expiresAt: string }>(),
  events: [] as { kind: string; actor: string; repo?: string | null; taskId?: string | null; pr?: string | null; payload?: Record<string, unknown> }[],
}));

vi.mock("@/lib/compliance/repo", () => ({
  async getDispatch(id: string) {
    return db.dispatches.get(id) ?? null;
  },
  async appendEvent(e: { kind: string; actor: string; repo?: string | null; taskId?: string | null; pr?: string | null; payload?: Record<string, unknown> }) {
    db.events.push(e);
  },
}));

import { ingestPullRequest } from "@/lib/compliance/service";

beforeEach(() => {
  db.dispatches.clear();
  db.events.length = 0;
});

function prPayload(over: Record<string, unknown> = {}, prOver: Record<string, unknown> = {}) {
  return {
    action: "opened",
    repository: { name: "PLX_MC", full_name: "taylorvalton/PLX_MC" },
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

  it("returns null for a non-pull_request payload", () => {
    expect(parsePullRequestEvent({ action: "push" })).toBeNull();
    expect(parsePullRequestEvent(null)).toBeNull();
  });
});

describe("ingestPullRequest", () => {
  it("records an agent PR open against its checked-out task", async () => {
    db.dispatches.set("dsp_x", { id: "dsp_x", actorKind: "agent", taskId: "TASK-900", revoked: false, repo: "PLX_MC", expiresAt: new Date(Date.now() + 3_600_000).toISOString() });
    const evt = parsePullRequestEvent(prPayload({}, { body: "x\nMC-Checkout: dsp_x" }))!;
    const r = await ingestPullRequest(evt);
    expect(r).toMatchObject({ actorKind: "agent", taskId: "TASK-900", recorded: true });
    const e = db.events.find((x) => x.kind === "pr.opened")!;
    expect(e.taskId).toBe("TASK-900");
    expect(e.payload).toMatchObject({ sparse: false, actorKind: "agent" });
  });

  it("records an operator PR (no checkout) as a sparse, ungated entry attributed to the author", async () => {
    const evt = parsePullRequestEvent(prPayload())!; // no MC-Checkout marker
    const r = await ingestPullRequest(evt);
    expect(r).toMatchObject({ actorKind: "operator", taskId: null });
    const e = db.events.find((x) => x.kind === "pr.opened")!;
    expect(e.actor).toBe("greg");
    expect(e.payload).toMatchObject({ sparse: true });
  });

  it("emits pr.merged + a task.promotion.requested seam on merge", async () => {
    db.dispatches.set("dsp_x", { id: "dsp_x", actorKind: "agent", taskId: "TASK-900", revoked: false, repo: "PLX_MC", expiresAt: new Date(Date.now() + 3_600_000).toISOString() });
    const evt = parsePullRequestEvent(prPayload({ action: "closed" }, { merged: true, body: "x\nMC-Checkout: dsp_x" }))!;
    await ingestPullRequest(evt);
    expect(db.events.map((e) => e.kind)).toEqual(expect.arrayContaining(["pr.merged", "task.promotion.requested"]));
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

  it("records a synchronize as pr.synchronized (T5)", async () => {
    const evt = parsePullRequestEvent(prPayload({ action: "synchronize" }))!;
    await ingestPullRequest(evt);
    expect(db.events.some((e) => e.kind === "pr.synchronized")).toBe(true);
  });
});
