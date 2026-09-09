// POST /api/tasks — create a task. Actor = Entra oid from session (P8).

import { z } from "zod";
import { parseBody, route } from "@/lib/api/route";
import {
  aclPrincipalFromAuthorized,
  requireSessionActor,
} from "@/lib/routing/mutations/actors";
import { assertBucketProjectAccess } from "@/lib/permissions/project-acl-guard";
import { createTask } from "@/lib/sync";

const STAGES = ["backlog", "specced", "approved", "planned", "progress", "qa", "review", "merged", "verified"] as const;

const createTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  bucket: z.string().min(1),
  stage: z.enum(STAGES).optional(),
  priority: z.enum(["urgent", "high", "medium", "low"]).optional(),
  assignee: z.string().nullable().optional(),
  coassignees: z.array(z.string()).optional(),
  // Deprecated — ignored for identity; session oid is authoritative.
  reporter: z.string().min(1).optional(),
  accountableOwner: z.string().nullable().optional(),
  humanOnly: z.boolean().optional(),
  reqs: z.array(z.string()).optional(),
  repos: z.array(z.string()).optional(),
  targetEnv: z.enum(["staging", "production"]).optional(),
  estimate: z.enum(["S", "M", "L"]).optional(),
  labels: z.array(z.string()).optional(),
  due: z.string().optional(),
});

export const POST = route(async (req) => {
  const body = await parseBody(req, createTaskSchema);
  const authorized = await requireSessionActor("task.create", {
    type: "bucket",
    id: body.bucket,
  });
  await assertBucketProjectAccess(body.bucket, aclPrincipalFromAuthorized(authorized));
  return createTask(
    {
      ...body,
      reporter: authorized.auditLabel,
      accountableOwner: body.accountableOwner ?? authorized.actorId,
    },
    { source: "human", actorId: authorized.actorId }
  );
});
