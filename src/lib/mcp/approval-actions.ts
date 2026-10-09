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
import type { Task } from "@/lib/mc-data";
import { APPROVAL_WAIT_MAX_MS } from "@/lib/mc-data/policy";
import { assertTaskProjectAccess } from "@/lib/permissions/project-acl-guard";
import { aclPrincipalFromMcp, requireMcpActor } from "@/lib/routing/mutations/actors";
import type { McpIdentity } from "./auth";
import { mcpJsonResult, taskLink } from "./envelope";

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

export const requestApprovalSchema = z.object({
  taskId: z.string().min(1),
  reason: z.string().min(1).max(500),
  checkoutId: z.string().min(1).optional(),
  proposal: approvalProposalSchema.optional(),
});

export type RequestApprovalActionInput = z.infer<typeof requestApprovalSchema>;

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
    if (d.taskId !== input.taskId || !dispatchRepoMatches(d.repo, identity.repo, identity.repo)) {
      throw new ApiError("checkout_mismatch", "Checkout does not belong to this task and repo.", 409);
    }
  }
  const { gate } = await requestApprovalGate({
    taskId: input.taskId,
    reason: input.reason,
    requestedBy: identity.operatorEmail,
    runtime: identity.runtime,
    checkoutId: input.checkoutId,
    proposal: input.proposal,
  });
  return {
    taskId: input.taskId,
    checkoutId: input.checkoutId ?? null,
    gateId: gate.id,
    status: gate.status,
    inputRequired: true,
    link: taskLink(input.taskId),
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
// operator that raised the gate, and a checkoutId must belong to the caller's repo; anyone else
// gets 403 and learns nothing about the gate.
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
    if (!dispatchRepoMatches(d.repo, identity.repo, identity.repo)) {
      throw new ApiError("forbidden", "checkout belongs to another repo.", 403);
    }
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
  const state = await getApprovalGateState({
    taskId,
    gateId,
    waitMs: (input.waitSeconds ?? 0) * 1000,
  });
  if (state.requestedBy.trim().toLowerCase() !== identity.operatorEmail.trim().toLowerCase()) {
    throw new ApiError("forbidden", "approval gate was raised by another principal.", 403);
  }
  return { ...state, link: taskLink(taskId) };
}

export function registerApprovalTools(server: McpServer, identity: McpIdentity): void {
  server.tool(
    "mc_request_approval",
    "Raise a runtime approval gate on a task (approval.request). Pass checkoutId to block that checkout until approved (mc_complete_task refuses); pass proposal {summary, action?, diff?, plan?, risk?} for the human reviewer. The task freezes input-required until a human other than the requester approves or rejects it in the Approvals inbox. Agents never decide gates.",
    requestApprovalSchema.shape,
    async (args) => mcpJsonResult({ data: await actionRequestApproval(identity, args) })
  );
  server.tool(
    "mc_get_approval_gate",
    `Read an approval gate's state (pending/approved/rejected, decider, decidedAt, note) by checkoutId or taskId. waitSeconds (max ${APPROVAL_WAIT_MAX_MS / 1000}) long-polls and returns early on a decision. Only the principal that raised the gate may read it.`,
    getApprovalGateSchema.shape,
    async (args) =>
      mcpJsonResult({ data: await actionGetApprovalGate(identity, getApprovalGateSchema.parse(args)) })
  );
}
