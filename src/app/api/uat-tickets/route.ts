// GET /api/uat-tickets — the BKT-UAT tickets view and its on-demand drift
// check (TASK-3706): each UAT ticket task's filed time and lease, the portal
// read, and the drift findings. Session read (the /api/in-flight gate) behind
// the bucket's project ACL. Fixes run through PATCH /api/tasks/{id} and POST /api/tasks.

import { route } from "@/lib/api/route";
import { loadUatTickets } from "@/lib/compliance/uat-tickets";
import { canAccessBucket } from "@/lib/permissions/project-acl";
import { assertBucketProjectAccess, loadProjectAclMaps } from "@/lib/permissions/project-acl-guard";
import { aclPrincipalFromAuthorized, requireSessionActor } from "@/lib/routing/mutations/actors";
import { UAT_TICKET_BUCKET } from "@/lib/tasks/uat-tickets";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const authorized = await requireSessionActor("task.read", { type: "bucket", id: UAT_TICKET_BUCKET });
  const principal = aclPrincipalFromAuthorized(authorized);
  await assertBucketProjectAccess(UAT_TICKET_BUCKET, principal);
  // Ticket tasks count in any bucket (TASK-3973), except buckets of restricted projects this viewer can't read.
  const { buckets, projectsById } = await loadProjectAclMaps();
  const hidden = buckets.filter((bucket) => !canAccessBucket(bucket, projectsById, principal)).map((bucket) => bucket.id);
  return loadUatTickets(new Date(), hidden);
});
