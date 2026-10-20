// Signed, scope-bound approval records (TASK-3408). A runtime approval gate
// that a person approves is stamped with an expiry and an HMAC-SHA256
// signature over its canonical record. The compliance gate and the launcher
// verify the signature, the expiry, the decider and the scope before an
// approval counts. A free-text "approved" line in a prompt is never an input.

import { createHmac, timingSafeEqual } from "node:crypto";

import { isAgentId, type ApprovalGate, type ApprovalScope } from "@/lib/mc-data";
import { approvalSigningKey } from "@/lib/secrets";

/** How long an approval covers, from the decision, per scope kind. */
export const APPROVAL_TTL_MINUTES: Record<ApprovalScope["kind"] | "unscoped", number> = {
  launch: 4 * 60,
  flags: 24 * 60,
  merge: 72 * 60,
  unscoped: 72 * 60,
};

export function approvalExpiry(scope: ApprovalScope | undefined, decidedAt: string): string {
  const minutes = APPROVAL_TTL_MINUTES[scope?.kind ?? "unscoped"];
  return new Date(Date.parse(decidedAt) + minutes * 60_000).toISOString();
}

/** Server-side decider allowlist (PLX_MC_APPROVAL_DECIDERS, comma list of emails). Empty = any person. */
export function approvalDeciderAllowlist(): string[] {
  return (process.env.PLX_MC_APPROVAL_DECIDERS ?? "")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
}

/** Why this decider may not approve, or null. Deciders are people, never agents. */
export function deciderViolation(decidedBy: string): string | null {
  const allow = approvalDeciderAllowlist();
  const label = decidedBy.trim().toLowerCase();
  if (allow.length > 0 && !allow.includes(label)) {
    return `decider ${decidedBy} is not on the approval decider allowlist.`;
  }
  return null;
}

function canonicalScope(scope: ApprovalScope | undefined): unknown {
  if (!scope) return null;
  switch (scope.kind) {
    case "launch":
      return { kind: "launch", lane: scope.lane, promptHash: scope.promptHash.toLowerCase() };
    case "merge":
      return { kind: "merge", repo: scope.repo.toLowerCase(), pr: scope.pr, headSha: scope.headSha.toLowerCase() };
    case "flags":
      return { kind: "flags", flags: [...scope.flags].sort() };
  }
}

/** The exact bytes that are signed: fixed key order, normalised values. */
export function canonicalApprovalRecord(taskId: string, gate: ApprovalGate): string {
  return JSON.stringify({
    v: 1,
    approvalId: gate.id,
    taskId,
    status: gate.status,
    scope: canonicalScope(gate.scope),
    decidedBy: (gate.decidedBy ?? "").trim().toLowerCase(),
    decidedAt: gate.decidedAt ?? null,
    expiresAt: gate.expiresAt ?? null,
  });
}

export function signApproval(taskId: string, gate: ApprovalGate, key = approvalSigningKey()): string | null {
  if (!key) return null;
  return createHmac("sha256", key).update(canonicalApprovalRecord(taskId, gate)).digest("hex");
}

/** What a caller needs the approval to cover. Omitted fields are not checked. */
export type ApprovalExpectation =
  | { kind: "launch"; lane?: string; promptHash?: string }
  | { kind: "merge"; repo?: string; pr?: number; headSha?: string }
  | { kind: "flags"; flag?: string };

export type ApprovalCheckReason =
  | "not_approved"
  | "unsigned"
  | "bad_signature"
  | "expired"
  | "decider_not_allowed"
  | "scope_missing"
  | "scope_kind_mismatch"
  | "lane_mismatch"
  | "prompt_hash_mismatch"
  | "repo_mismatch"
  | "pr_mismatch"
  | "head_sha_mismatch"
  | "flag_not_covered";

const eq = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

function scopeReason(scope: ApprovalScope | undefined, want: ApprovalExpectation): ApprovalCheckReason | null {
  if (!scope) return "scope_missing";
  if (scope.kind !== want.kind) return "scope_kind_mismatch";
  if (scope.kind === "launch" && want.kind === "launch") {
    if (want.lane !== undefined && !eq(scope.lane, want.lane)) return "lane_mismatch";
    if (want.promptHash !== undefined && !eq(scope.promptHash, want.promptHash)) return "prompt_hash_mismatch";
  }
  if (scope.kind === "merge" && want.kind === "merge") {
    if (want.repo !== undefined && !eq(scope.repo, want.repo)) return "repo_mismatch";
    if (want.pr !== undefined && scope.pr !== want.pr) return "pr_mismatch";
    if (want.headSha !== undefined && !eq(scope.headSha, want.headSha)) return "head_sha_mismatch";
  }
  if (scope.kind === "flags" && want.kind === "flags") {
    if (want.flag !== undefined && !scope.flags.some((f) => eq(f, want.flag!))) return "flag_not_covered";
  }
  return null;
}

/**
 * Does this gate count as a signed approval for `want` right now? Checks, in
 * order: approved, signed, signature valid, unexpired, decider allowed and a
 * person, scope matches. The first failure is the reason.
 */
export function checkApproval(
  taskId: string,
  gate: ApprovalGate,
  want: ApprovalExpectation,
  options: { now?: number; key?: string | null } = {}
): { ok: true } | { ok: false; reason: ApprovalCheckReason } {
  if (gate.status !== "approved") return { ok: false, reason: "not_approved" };
  if (!gate.signature) return { ok: false, reason: "unsigned" };
  const expected = signApproval(taskId, gate, options.key === undefined ? approvalSigningKey() : options.key);
  if (!expected) return { ok: false, reason: "unsigned" };
  const a = Buffer.from(gate.signature, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "bad_signature" };
  if (!gate.expiresAt || Date.parse(gate.expiresAt) <= (options.now ?? Date.now())) {
    return { ok: false, reason: "expired" };
  }
  const decider = (gate.decidedBy ?? "").trim();
  if (!decider || isAgentId(decider) || deciderViolation(decider)) {
    return { ok: false, reason: "decider_not_allowed" };
  }
  const reason = scopeReason(gate.scope, want);
  return reason ? { ok: false, reason } : { ok: true };
}
