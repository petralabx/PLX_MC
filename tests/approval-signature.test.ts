// TASK-3408: signed, scope-bound approval records. Each case changes one thing
// about an otherwise valid approval and expects that one reason.
import { afterEach, describe, expect, it } from "vitest";
import type { ApprovalGate } from "@/lib/mc-data";
import { approvalExpiry, canonicalApprovalRecord, checkApproval, signApproval } from "@/lib/compliance/approval-signature";

const KEY = "test-signing-key";
const SHA = "a".repeat(40);
const HASH = "b".repeat(64);
const decidedAt = "2026-10-20T16:50:22.000Z";
const NOW = Date.parse("2026-10-20T17:00:00.000Z");

function approved(over: Partial<ApprovalGate> = {}): ApprovalGate {
  const gate: ApprovalGate = {
    id: "apg_1", reason: "yes?", requestedBy: "cos@petrasoap.com", requestedAt: "2026-10-20T16:38:03Z",
    status: "approved", decidedBy: "vince@petrasoap.com", decidedAt,
    scope: { kind: "launch", lane: "claude-code/claude-uat", promptHash: HASH },
    ...over,
  };
  const stamped = { ...gate, expiresAt: gate.expiresAt ?? approvalExpiry(gate.scope, decidedAt) };
  return { ...stamped, signature: signApproval("TASK-1", stamped, KEY) };
}
const check = (gate: ApprovalGate, want: Parameters<typeof checkApproval>[2], now = NOW) =>
  checkApproval("TASK-1", gate, want, { now, key: KEY });

afterEach(() => { delete process.env.PLX_MC_APPROVAL_DECIDERS; });

describe("checkApproval (TASK-3408)", () => {
  it("accepts a person's signed, unexpired approval in scope", () => {
    expect(check(approved(), { kind: "launch", lane: "claude-code/claude-uat", promptHash: HASH.toUpperCase() })).toEqual({ ok: true });
  });

  it.each([
    ["pending", { status: "pending" as const }, "not_approved"],
    ["rejected", { status: "rejected" as const }, "not_approved"],
  ])("refuses a %s gate", (_name, over, reason) => {
    expect(check({ ...approved(), ...over }, { kind: "launch" })).toEqual({ ok: false, reason });
  });

  it("refuses an unsigned approval, and every approval when no key is set", () => {
    expect(check({ ...approved(), signature: null }, { kind: "launch" })).toEqual({ ok: false, reason: "unsigned" });
    expect(checkApproval("TASK-1", approved(), { kind: "launch" }, { now: NOW, key: null })).toEqual({ ok: false, reason: "unsigned" });
  });

  it("refuses a record changed after signing: scope, decider, expiry or task", () => {
    const gate = approved();
    for (const tampered of [
      { ...gate, scope: { kind: "launch" as const, lane: "claude-code/other", promptHash: HASH } },
      { ...gate, decidedBy: "stephen@petrasoap.com" },
      { ...gate, expiresAt: "2099-01-01T00:00:00.000Z" },
    ]) {
      expect(check(tampered, { kind: "launch" })).toEqual({ ok: false, reason: "bad_signature" });
    }
    expect(checkApproval("TASK-2", gate, { kind: "launch" }, { now: NOW, key: KEY })).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("expires a launch approval four hours after the decision", () => {
    expect(check(approved(), { kind: "launch" }, Date.parse(decidedAt) + 4 * 3_600_000 - 1)).toEqual({ ok: true });
    expect(check(approved(), { kind: "launch" }, Date.parse(decidedAt) + 4 * 3_600_000)).toEqual({ ok: false, reason: "expired" });
  });

  it.each([
    [{ kind: "launch" as const, lane: "claude-code/other" }, "lane_mismatch"],
    [{ kind: "launch" as const, promptHash: "c".repeat(64) }, "prompt_hash_mismatch"],
    [{ kind: "merge" as const }, "scope_kind_mismatch"],
  ])("refuses a launch approval for %j", (want, reason) => {
    expect(check(approved(), want)).toEqual({ ok: false, reason });
  });

  it("binds a merge approval to repo, PR and head SHA", () => {
    const gate = approved({ scope: { kind: "merge", repo: "petralabx/PLX_MC", pr: 400, headSha: SHA } });
    expect(check(gate, { kind: "merge", repo: "PetraLabX/PLX_MC", pr: 400, headSha: SHA })).toEqual({ ok: true });
    expect(check(gate, { kind: "merge", headSha: "c".repeat(40) })).toEqual({ ok: false, reason: "head_sha_mismatch" });
    expect(check(gate, { kind: "merge", pr: 401 })).toEqual({ ok: false, reason: "pr_mismatch" });
    expect(check(gate, { kind: "merge", repo: "petralabx/plx-customer-portal" })).toEqual({ ok: false, reason: "repo_mismatch" });
  });

  it("refuses a legacy gate with no scope", () => {
    expect(check(approved({ scope: undefined }), { kind: "launch" })).toEqual({ ok: false, reason: "scope_missing" });
  });

  it("refuses a decider off the allowlist, and an agent decider", () => {
    process.env.PLX_MC_APPROVAL_DECIDERS = "stephen@petrasoap.com";
    expect(check(approved(), { kind: "launch" })).toEqual({ ok: false, reason: "decider_not_allowed" });
    delete process.env.PLX_MC_APPROVAL_DECIDERS;
    expect(check(approved({ decidedBy: "vibes" }), { kind: "launch" })).toEqual({ ok: false, reason: "decider_not_allowed" });
  });

  it("signs a canonical record that does not depend on flag order or case", () => {
    const a = canonicalApprovalRecord("TASK-1", approved({ scope: { kind: "flags", flags: ["b", "a"] } }));
    const b = canonicalApprovalRecord("TASK-1", approved({ scope: { kind: "flags", flags: ["a", "b"] } }));
    expect(a).toBe(b);
  });
});
