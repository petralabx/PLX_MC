// GET /api/uat-tickets — the BKT-UAT tickets view (TASK-3706): each UAT ticket
// task's filed time and lease, and the portal read. Session read (the
// /api/in-flight gate) behind the bucket's project ACL.

import { route } from "@/lib/api/route";
import { loadUatTickets } from "@/lib/compliance/uat-tickets";
import { assertBucketProjectAccess } from "@/lib/permissions/project-acl-guard";
import { aclPrincipalFromAuthorized, requireSessionActor } from "@/lib/routing/mutations/actors";
import { UAT_TICKET_BUCKET } from "@/lib/tasks/uat-tickets";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const authorized = await requireSessionActor("task.read", { type: "bucket", id: UAT_TICKET_BUCKET });
  await assertBucketProjectAccess(UAT_TICKET_BUCKET, aclPrincipalFromAuthorized(authorized));
  return loadUatTickets();
});
