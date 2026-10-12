// GET /api/approvals/audit — read-only audit export of approval proposal+decision
// pairs (TASK-630): approval.requested joined to approval.decided by gateId, plus
// any rejected self-approval attempts (approval.denied). Same task.read gate and
// project-ACL filtering as the inbox and the /api/events export.

import { route } from "@/lib/api/route";
import { listApprovalAudit } from "@/lib/compliance/approvals";
import { filterEventsByProjectAcl } from "@/lib/compliance/events-acl";
import { aclPrincipalFromSession, requireSessionActor } from "@/lib/routing/mutations/actors";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  await requireSessionActor("task.read");
  const principal = await aclPrincipalFromSession();
  const approvals = await listApprovalAudit({ filter: (events) => filterEventsByProjectAcl(events, principal) });
  return { approvals };
});
