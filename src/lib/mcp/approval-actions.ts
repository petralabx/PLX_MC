// mc_request_approval (TASK-629) — shared by POST /api/cursor/request-approval
// and the HTTP MCP transport. An agent mid-run raises a runtime approval gate on
// its Task (the A2A input-required pattern): the task's stage freezes until a
// human other than the requester decides the gate in the Approvals inbox.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { requestApprovalGate } from "@/lib/compliance/approvals";
import { assertTaskProjectAccess } from "@/lib/permissions/project-acl-guard";
import { aclPrincipalFromMcp, requireMcpActor } from "@/lib/routing/mutations/actors";
import type { McpIdentity } from "./auth";
import { mcpJsonResult, taskLink } from "./envelope";

export const requestApprovalSchema = z.object({
  taskId: z.string().min(1),
  reason: z.string().min(1).max(500),
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
  const { gate } = await requestApprovalGate({
    taskId: input.taskId,
    reason: input.reason,
    requestedBy: identity.operatorEmail,
    runtime: identity.runtime,
  });
  return {
    taskId: input.taskId,
    gateId: gate.id,
    status: gate.status,
    inputRequired: true,
    link: taskLink(input.taskId),
  };
}

export function registerApprovalTools(server: McpServer, identity: McpIdentity): void {
  server.tool(
    "mc_request_approval",
    "Raise a runtime approval gate on a task (approval.request). The task freezes input-required until a human other than the requester approves or rejects it in the Approvals inbox. Agents never decide gates.",
    requestApprovalSchema.shape,
    async (args) => mcpJsonResult({ data: await actionRequestApproval(identity, args) })
  );
}
