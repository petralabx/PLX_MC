// GET /api/approvals/projects — the signed-in person's projects on the
// Approvals screen (TASK-3720): the projects they are a member of, own, or
// hold an open task in, with every open question (to anyone) and every
// pending gate on those projects' tasks. The project ACL bounds all of it, on
// the server. Session-authenticated read.

import { route } from "@/lib/api/route";
import { listProjectApprovals } from "@/lib/compliance/my-projects";
import { aclPrincipalFromAuthorized, requireSessionActor } from "@/lib/routing/mutations/actors";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const authorized = await requireSessionActor("task.read");
  return listProjectApprovals(aclPrincipalFromAuthorized(authorized));
});
