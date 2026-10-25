// POST /api/tasks/{id}/creator-approval — clear a pending creator approval
// (TASK-3530). Session human only. The approver is the session Entra oid,
// never a body field, and only the creator approvers in permissions/grants.ts
// pass. Each approval and each refused attempt lands in mc_events.

import { z } from "zod";
import { parseBody, route } from "@/lib/api/route";
import { approveCreatorApproval } from "@/lib/compliance/approvals";
import { assertTaskProjectAccess } from "@/lib/permissions/project-acl-guard";
import {
  aclPrincipalFromAuthorized,
  requireSessionActor,
} from "@/lib/routing/mutations/actors";

const creatorApprovalSchema = z.object({
  note: z.string().max(1000).optional(),
}).strict();

export const POST = route(async (req, ctx) => {
  const { id } = await ctx.params;
  const { note } = await parseBody(req, creatorApprovalSchema);
  // task.read only resolves the session; the approver allowlist is the gate.
  const authorized = await requireSessionActor("task.read", { type: "task", id });
  // A restricted project's task is approved, and its approval read, only by a member.
  await assertTaskProjectAccess(id, aclPrincipalFromAuthorized(authorized));
  const { task } = await approveCreatorApproval({
    taskId: id,
    approverOid: authorized.actorId,
    approverLabel: authorized.auditLabel,
    note,
  });
  return { taskId: task.id, creatorApproval: task.creatorApproval };
});
