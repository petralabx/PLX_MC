// POST /api/approvals/decide — decide a runtime approval gate (TASK-629/630).
// Session human only (approval.decide); the decider is the session audit
// label, never a body field, and separation of duties rejects the requester
// deciding their own gate. On a restricted project only members decide
// (TASK-3713). Every decision lands in mc_events.

import { z } from "zod";
import { parseBody, route } from "@/lib/api/route";
import { decideApprovalGate } from "@/lib/compliance/approvals";
import { assertTaskProjectAccess } from "@/lib/permissions/project-acl-guard";
import { aclPrincipalFromAuthorized, requireSessionActor } from "@/lib/routing/mutations/actors";

const decideSchema = z.object({
  taskId: z.string().min(1),
  gateId: z.string().min(1),
  decision: z.enum(["approved", "rejected"]),
  note: z.string().max(1000).optional(),
  renderedScope: z.string().max(10000).optional(),
  renderedSourceRef: z.string().max(500).optional(),
});

export const POST = route(async (req) => {
  const { taskId, gateId, decision, note, renderedScope, renderedSourceRef } = await parseBody(req, decideSchema);
  const authorized = await requireSessionActor("approval.decide", {
    type: "task",
    id: taskId,
  });
  await assertTaskProjectAccess(taskId, aclPrincipalFromAuthorized(authorized));
  const { gate, task } = await decideApprovalGate({
    taskId,
    gateId,
    decision,
    decidedBy: authorized.auditLabel,
    note,
    renderedScope,
    renderedSourceRef,
  });
  return { gate, taskId: task.id, inputRequired: (task.approvalGates ?? []).some((g) => g.status === "pending") };
});
