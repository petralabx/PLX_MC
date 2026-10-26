// GET /api/approvals — the Approvals inbox source (TASK-631): every pending
// runtime approval gate on the tasks the session's project ACL lets them see
// (TASK-3713). Session-authenticated read. A creator approver (vince@, cos@)
// also gets the tasks that wait for creator approval (TASK-3629); everyone
// else gets an empty creatorApprovals list.

import { listPendingApprovals, listPendingCreatorApprovals } from "@/lib/compliance/approvals";
import { route } from "@/lib/api/route";
import { isCreatorApprover } from "@/lib/permissions";
import { aclPrincipalFromAuthorized, requireSessionActor } from "@/lib/routing/mutations/actors";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const authorized = await requireSessionActor("task.read");
  const principal = aclPrincipalFromAuthorized(authorized);
  const creatorApprovals = isCreatorApprover(authorized.actorId) ? await listPendingCreatorApprovals(principal) : [];
  const approvals = (await listPendingApprovals(principal)).map((row) => ({
    taskId: row.taskId,
    taskTitle: row.taskTitle,
    stage: row.stage,
    gate: row.gate,
    // Pointer at the task's existing evidence bundle. No new column.
    evidence: row.evidence,
  }));
  return { approvals, creatorApprovals };
});
