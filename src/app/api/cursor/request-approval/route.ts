// POST /api/cursor/request-approval — mc_request_approval (TASK-629).
// An agent mid-run raises a runtime approval gate on its Task (the A2A
// input-required pattern): the task's stage freezes until a human other than
// the requester decides the gate in the Approvals inbox.

import { z } from "zod";
import { requestApprovalGate } from "@/lib/compliance/approvals";
import { taskLink } from "@/lib/mcp/envelope";
import { cursorRoute, parseCursorBody } from "@/lib/mcp/route";
import { requireMcpActor } from "@/lib/routing/mutations/actors";

const requestApprovalSchema = z.object({
  taskId: z.string().min(1),
  reason: z.string().min(1).max(500),
});

export const POST = cursorRoute("mc_request_approval", async (req, _ctx, identity, meta) => {
  const { taskId, reason } = await parseCursorBody(req, requestApprovalSchema);
  requireMcpActor(
    identity,
    "approval.request",
    { type: "task", id: taskId },
    { repositoryId: identity.repo }
  );
  const { gate } = await requestApprovalGate({
    taskId,
    reason,
    requestedBy: identity.operatorEmail,
    runtime: identity.runtime,
  });
  return {
    data: {
      taskId,
      gateId: gate.id,
      status: gate.status,
      inputRequired: true,
    },
    meta: {
      links: {
        ...meta.links,
        task: taskLink(taskId),
      },
    },
  };
});
