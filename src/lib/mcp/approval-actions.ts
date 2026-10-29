// mc_request_approval (TASK-629) — shared by POST /api/cursor/request-approval
// and the HTTP MCP transport. An agent mid-run raises a runtime approval gate on
// its Task (the A2A input-required pattern): the task's stage freezes until a
// human other than the requester decides the gate in the Approvals inbox.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ApiError } from "@/lib/api/route";
import { getApprovalGateState, requestApprovalGate } from "@/lib/compliance/approvals";
import * as complianceRepo from "@/lib/compliance/repo";
import { dispatchRepoMatches } from "@/lib/compliance/service";
import { getEntity } from "@/lib/sync/repo";
import type { ApprovalGate, Task } from "@/lib/mc-data";
import { checkApproval } from "@/lib/compliance/approval-signature";
import { APPROVAL_WAIT_MAX_MS } from "@/lib/mc-data/policy";
import { assertTaskProjectAccess } from "@/lib/permissions/project-acl-guard";
import { aclPrincipalFromMcp, requireMcpActor } from "@/lib/routing/mutations/actors";
import type { McpIdentity } from "./auth";
import { resolveCheckoutRepo } from "./checkout-repo";
import { gateLink, mcpJsonResult, taskLink } from "./envelope";
import { checkoutRef } from "./read-actions";

export const PROPOSAL_MAX_BYTES = 32 * 1024;

// Structured proposal an agent attaches to a gate. Strict: unknown keys are rejected so the
// stored payload round-trips exactly. Total serialized size is capped at PROPOSAL_MAX_BYTES.
export const approvalProposalSchema = z
  .object({
    summary: z.string().min(1).max(1000),
    action: z.string().min(1).max(500).optional(),
    diff: z.string().max(PROPOSAL_MAX_BYTES).optional(),
    plan: z.string().max(PROPOSAL_MAX_BYTES).optional(),
    risk: z.enum(["low", "medium", "high", "critical"]).optional(),
  })
  .strict()
  .refine((p) => Buffer.byteLength(JSON.stringify(p), "utf8") <= PROPOSAL_MAX_BYTES, {
    message: `proposal exceeds ${PROPOSAL_MAX_BYTES} bytes`,
  });

const hex64 = z.string().trim().regex(/^[0-9a-fA-F]{64}$/, "must be a 64-character hex SHA-256");
const laneId = z.string().trim().regex(/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/, "must be <runtime>/<lane>");
const repoSlug = z.string().trim().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, "must be owner/name");
const headSha = z.string().trim().regex(/^[0-9a-fA-F]{40}$/, "must be a 40-character commit SHA");

// TASK-3408: what an approval covers. launch = one lane, one prompt; merge = one
// PR at one head; flags = named override flags.
export const approvalScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("launch"), lane: laneId, promptHash: hex64 }).strict(),
  z.object({ kind: z.literal("merge"), repo: repoSlug, pr: z.number().int().positive(), headSha }).strict(),
  z.object({ kind: z.literal("flags"), flags: z.array(z.string().trim().min(1).max(64)).min(1).max(20) }).strict(),
]);

export const requestApprovalSchema = z.object({
  taskId: z.string().min(1),
  reason: z.string().min(1).max(500),
  checkoutId: z.string().min(1).optional(),
  proposal: approvalProposalSchema.optional(),
  scope: approvalScopeSchema.optional(),
  sourceRef: z.string().trim().min(1).max(500).optional(),
});

export type RequestApprovalActionInput = z.infer<typeof requestApprovalSchema>;

// A checkout may carry a Hub-connector `repo` override (AGENTS.md), so its repo can differ from
// identity.repo. Same policy as mc_checkout_task: the default repo, or an allowlisted slug, and the
// principal must hold `capability` on that repo. Anything else fails closed.
function authorizeCheckoutRepo(
  identity: McpIdentity,
  dispatchRepo: string,
  capability: "approval.request" | "task.read",
  taskId: string
): void {
  if (dispatchRepoMatches(dispatchRepo, identity.repo, identity.repo)) return;
  const repo = resolveCheckoutRepo(identity.repo, dispatchRepo);
  requireMcpActor(identity, capability, { type: "task", id: taskId }, { repositoryId: repo });
}

export async function actionRequestApproval(
  identity: McpIdentity,
  input: RequestApprovalActionInput
) {
  requireMcpActor(
    identity,
    "approval.request",
    { type: "task", id: input.taskId },
    { repositoryId: identity.repo }
  );
  // Same restricted-project guard as every other MCP task write (progress,
  // checkout, complete): no gates on a task the principal cannot see.
  await assertTaskProjectAccess(input.taskId, aclPrincipalFromMcp(identity));
  if (input.checkoutId) {
    const d = await complianceRepo.getDispatch(input.checkoutId);
    if (!d || d.revoked || d.releasedAt || new Date(d.expiresAt).getTime() <= Date.now()) {
      throw new ApiError("invalid_checkout", "Unknown, revoked, released, or expired checkout.", 409);
    }
    if (d.taskId !== input.taskId) {
      throw new ApiError("checkout_mismatch", "Checkout does not belong to this task.", 409);
    }
    authorizeCheckoutRepo(identity, d.repo, "approval.request", input.taskId);
  }
  const { gate } = await requestApprovalGate({
    taskId: input.taskId,
    reason: input.reason,
    requestedBy: identity.operatorEmail,
    requestedByPrincipal: identity.servicePrincipalId,
    runtime: identity.runtime,
    checkoutId: input.checkoutId,
    checkoutRef: input.checkoutId ? checkoutRef(input.checkoutId) : undefined,
    proposal: input.proposal,
    scope: input.scope,
    sourceRef: input.sourceRef,
  });
  return {
    taskId: input.taskId,
    checkoutRef: input.checkoutId ? checkoutRef(input.checkoutId) : null,
    gateId: gate.id,
    // Cite this id, never free text, when the work depends on the approval (TASK-3408).
    approvalId: gate.id,
    status: gate.status,
    scope: gate.scope ?? null,
    inputRequired: true,
    link: taskLink(input.taskId),
    // TASK-3559: send the approver here; it opens this gate on the Approvals screen.
    gateLink: gateLink(gate.id),
  };
}

// ─── mc_verify_approval (TASK-3408, TASK-3444) ───────────────────────────────

export const verifyApprovalSchema = z
  .object({
    taskId: z.string().trim().min(1),
    approvalId: z.string().trim().regex(/^apg_[0-9a-f]+$/).optional(),
    expect: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("launch"), lane: laneId.optional(), promptHash: hex64.optional() }).strict(),
      z.object({ kind: z.literal("merge"), repo: repoSlug.optional(), pr: z.number().int().positive().optional(), headSha: headSha.optional() }).strict(),
      z.object({ kind: z.literal("flags"), flag: z.string().trim().min(1).max(64).optional() }).strict(),
      // TASK-3630: the gated-creator approval (TASK-3530). It has no signed gate, so approvalId does not apply.
      z.object({ kind: z.literal("creator") }).strict(),
    ]),
  })
  .strict();

export type VerifyApprovalActionInput = z.infer<typeof verifyApprovalSchema>;

/** A task's gated-creator approval (TASK-3530) as mc_verify_approval reports it; null when the task needs none. */
function creatorApprovalView(task: Task) {
  const ca = task.creatorApproval;
  if (!ca) return null;
  return {
    principal: ca.principal,
    status: ca.status,
    requestedAt: ca.requestedAt,
    approvedBy: ca.approvedBy ?? null,
    approvedAt: ca.approvedAt ?? null,
  };
}

/**
 * Is there a signed approval on this task that covers `expect` now? Any
 * principal holding task.read may ask, the launcher included (TASK-3444): the
 * answer carries the decision, scope, expiry and decider, never the proposal.
 * With approvalId, only that gate is checked; without it, any covering gate.
 */
export async function actionVerifyApproval(identity: McpIdentity, input: VerifyApprovalActionInput) {
  requireMcpActor(identity, "task.read", { type: "task", id: input.taskId });
  await assertTaskProjectAccess(input.taskId, aclPrincipalFromMcp(identity));
  const row = await getEntity("task", input.taskId);
  if (!row) throw new ApiError("not_found", `unknown task ${input.taskId}`, 404);
  const task = row.data as unknown as Task;
  // TASK-3630: every answer carries the gated-creator approval next to the signed gates.
  const creatorApproval = creatorApprovalView(task);
  const want = input.expect;
  if (want.kind === "creator") {
    if (input.approvalId) {
      throw new ApiError("invalid_request", "The creator approval has no approval id. Drop approvalId.", 400);
    }
    const pending = creatorApproval?.status === "pending";
    return {
      taskId: input.taskId,
      ok: !pending,
      reason: pending ? "creator_approval_pending" : null,
      approval: null,
      creatorApproval,
      checkedAt: new Date().toISOString(),
      link: taskLink(input.taskId),
      gateLink: null,
    };
  }
  const gates = (task.approvalGates ?? []).filter(
    (g) => !input.approvalId || g.id === input.approvalId
  );
  if (input.approvalId && gates.length === 0) {
    throw new ApiError("not_found", `unknown approval ${input.approvalId} on ${input.taskId}`, 404);
  }
  const results = gates.map((gate) => ({ gate, result: checkApproval(input.taskId, gate, want) }));
  const covering = results.find((r) => r.result.ok);
  const shown = covering ?? results[results.length - 1];
  const view = (g: ApprovalGate) => ({
    approvalId: g.id,
    status: g.status,
    scope: g.scope ?? null,
    decidedBy: g.decidedBy ?? null,
    decidedAt: g.decidedAt ?? null,
    expiresAt: g.expiresAt ?? null,
    signed: !!g.signature,
  });
  return {
    taskId: input.taskId,
    ok: !!covering,
    reason: covering ? null : shown ? (shown.result as { reason: string }).reason : "no_approval",
    approval: shown ? view(shown.gate) : null,
    creatorApproval,
    checkedAt: new Date().toISOString(),
    link: taskLink(input.taskId),
    gateLink: shown ? gateLink(shown.gate.id) : null,
  };
}

export const getApprovalGateSchema = z
  .object({
    checkoutId: z.string().min(1).optional(),
    taskId: z.string().min(1).optional(),
    gateId: z.string().min(1).optional(),
    waitSeconds: z
      .number()
      .min(0)
      .max(APPROVAL_WAIT_MAX_MS / 1000)
      .optional()
      .describe(`Optional long-poll, returns early on decision; hard cap ${APPROVAL_WAIT_MAX_MS / 1000}s`),
  })
  .refine((v) => !!v.checkoutId !== !!v.taskId, {
    message: "provide exactly one of checkoutId or taskId",
  });

export type GetApprovalGateActionInput = z.infer<typeof getApprovalGateSchema>;

// mc_get_approval_gate: the agent resume signal. Read-only (task.read). The caller must be the
// authenticated service principal that raised the gate (not the spoofable operator-email header),
// and a checkoutId must be in a repo the principal may use; anyone else gets 403 and learns nothing.
// Output carries checkoutRef only: the usable dsp_* id is never returned.
export async function actionGetApprovalGate(
  identity: McpIdentity,
  input: GetApprovalGateActionInput
) {
  requireMcpActor(identity, "task.read", undefined, { repositoryId: identity.repo });
  let taskId = input.taskId;
  let gateId = input.gateId;
  if (input.checkoutId) {
    const d = await complianceRepo.getDispatch(input.checkoutId);
    if (!d) throw new ApiError("not_found", `unknown checkout ${input.checkoutId}`, 404);
    authorizeCheckoutRepo(identity, d.repo, "task.read", d.taskId);
    taskId = d.taskId;
    gateId ??= d.approvalGateId ?? undefined;
    if (!gateId) throw new ApiError("not_found", "checkout has no approval gate.", 404);
  }
  if (!taskId) throw new ApiError("invalid_request", "taskId or checkoutId required.", 400);
  await assertTaskProjectAccess(taskId, aclPrincipalFromMcp(identity));
  if (!gateId) {
    const row = await getEntity("task", taskId);
    const gates = (row?.data as unknown as Task | undefined)?.approvalGates ?? [];
    gateId = gates[gates.length - 1]?.id;
    if (!gateId) throw new ApiError("not_found", `task ${taskId} has no approval gate.`, 404);
  }
  let state: Awaited<ReturnType<typeof getApprovalGateState>>;
  try {
    state = await getApprovalGateState({
      taskId,
      gateId,
      // Bound to the authenticated API-key principal, not the caller-supplied operator header.
      requesterPrincipal: identity.servicePrincipalId,
      waitMs: (input.waitSeconds ?? 0) * 1000,
    });
  } catch (err) {
    if (err instanceof ApiError) throw err;
    // TASK-3779: an unexpected failure (e.g. a malformed stored gate) is a named,
    // logged error with a clear reason, never a bare 500.
    const kind = err instanceof Error ? err.name : typeof err;
    console.error("mc_get_approval_gate read failed", { taskId, gateId, err });
    throw new ApiError(
      "approval_gate_read_failed",
      `could not read approval gate ${gateId} on ${taskId}: unexpected ${kind} while loading the stored gate. The gate is unchanged; retry, or report this gate id to an operator.`,
      503
    );
  }
  return { ...state, link: taskLink(taskId), gateLink: gateLink(state.gateId) };
}

export function registerApprovalTools(server: McpServer, identity: McpIdentity): void {
  server.tool(
    "mc_request_approval",
    "Raise a runtime approval gate on a task (approval.request). Pass checkoutId to block that checkout until approved (mc_complete_task refuses); pass proposal {summary, action?, diff?, plan?, risk?} for the human reviewer. The task freezes input-required until a human other than the requester approves or rejects it in the Approvals inbox. Send the approver gateLink: it opens this gate on the Approvals screen. Agents never decide gates.",
    requestApprovalSchema.shape,
    async (args) => mcpJsonResult({ data: await actionRequestApproval(identity, args) })
  );
  server.tool(
    "mc_verify_approval",
    "Check whether a signed approval on a task covers what you are about to do (TASK-3408): expect {kind: launch, lane?, promptHash?} | {kind: merge, repo?, pr?, headSha?} | {kind: flags, flag?} | {kind: creator}. ok is true only when a person approved it, the signature is valid, it has not expired, the decider is allowed and the scope matches; otherwise reason names the first failure. Optional approvalId checks one gate. Every answer also carries creatorApproval: the gated-creator approval (principal, status pending or approved, approvedBy, approvedAt), or null when the task needs none. {kind: creator} checks only that approval: ok unless it is pending (reason creator_approval_pending). Readable by any principal with task.read, the launcher included; never returns the proposal.",
    verifyApprovalSchema.shape,
    async (args) => mcpJsonResult({ data: await actionVerifyApproval(identity, verifyApprovalSchema.parse(args)) })
  );
  server.tool(
    "mc_get_approval_gate",
    `Read an approval gate's state (pending/approved/rejected, decider, decidedAt, note) by checkoutId or taskId. waitSeconds (max ${APPROVAL_WAIT_MAX_MS / 1000}) long-polls and returns early on a decision. Only the service principal that raised the gate may read it. Never returns the usable checkout id (checkoutRef only).`,
    getApprovalGateSchema.shape,
    async (args) =>
      mcpJsonResult({ data: await actionGetApprovalGate(identity, getApprovalGateSchema.parse(args)) })
  );
}
