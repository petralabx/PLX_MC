// Server-only project ACL loaders. Import from routes/actions, not the
// permissions barrel (keeps `pg` out of the browser bundle).

import type { TxQuery } from "@/lib/db";
import { ApiError } from "@/lib/api/route";
import type { Bucket, Project, Task } from "@/lib/mc-data/types";
import { getBuckets, getEntity, getProjects } from "@/lib/sync/repo";
import { recordPermissionDecision } from "./decision-log";
import {
  assertCanAccessProject,
  canAccessProject,
  filterBucketsByAcl,
  filterProjectsByAcl,
  filterTasksByAcl,
  indexById,
  isRestrictedProject,
  type ProjectAclPrincipal,
} from "./project-acl";
import { POLICY_VERSION } from "./types";

function recordRestrictedProjectDecision(
  projectId: string,
  principal: ProjectAclPrincipal,
  allowed: boolean
): void {
  const actorId = principal.tokens[0] ?? "unknown";
  void recordPermissionDecision({
    site: "permissions.project-acl",
    actorKind: actorId.startsWith("sp_") ? "service" : "human",
    actorId,
    capability: "project.access",
    resourceType: "project",
    resourceId: projectId,
    allowed,
    reasonCode: allowed ? "allowed" : "context_denied",
    policyVersion: POLICY_VERSION,
  });
}

export async function loadProjectAclMaps(): Promise<{
  projects: Project[];
  buckets: Bucket[];
  projectsById: Map<string, Project>;
  bucketsById: Map<string, Bucket>;
}> {
  const [projects, buckets] = await Promise.all([getProjects(), getBuckets()]);
  return {
    projects,
    buckets,
    projectsById: indexById(projects),
    bucketsById: indexById(buckets),
  };
}

export async function assertProjectIdAccess(
  projectId: string | null | undefined,
  principal: ProjectAclPrincipal,
  q?: TxQuery
): Promise<void> {
  if (!projectId) return;
  const projects = await getProjects(q);
  const project = projects.find((row) => row.id === projectId);
  if (!project) {
    throw new ApiError("not_found", `unknown project ${projectId}`, 404);
  }
  if (isRestrictedProject(project)) {
    recordRestrictedProjectDecision(projectId, principal, canAccessProject(project, principal));
  }
  assertCanAccessProject(project, principal);
}

export async function assertBucketProjectAccess(
  bucketId: string,
  principal: ProjectAclPrincipal,
  q?: TxQuery
): Promise<void> {
  const buckets = await getBuckets(q);
  const bucket = buckets.find((row) => row.id === bucketId);
  if (!bucket) return;
  await assertProjectIdAccess(bucket.project, principal, q);
}

export async function assertTaskProjectAccess(
  taskId: string,
  principal: ProjectAclPrincipal,
  q?: TxQuery
): Promise<void> {
  const row = await getEntity("task", taskId, q);
  if (!row) throw new ApiError("not_found", `unknown task ${taskId}`, 404);
  const task = row.data as unknown as Task;
  await assertBucketProjectAccess(task.bucket, principal, q);
}

export function scopeHierarchy<TTask extends { bucket: string }, TBucket extends Bucket, TProject extends Project>(
  input: {
    tasks?: readonly TTask[];
    buckets?: readonly TBucket[];
    projects?: readonly TProject[];
    principal: ProjectAclPrincipal;
  }
): {
  tasks: TTask[];
  buckets: TBucket[];
  projects: TProject[];
} {
  const projects = input.projects ?? [];
  const buckets = input.buckets ?? [];
  const projectsById = indexById(projects);
  const bucketsById = indexById(buckets);
  return {
    projects: filterProjectsByAcl(projects, input.principal),
    buckets: filterBucketsByAcl(buckets, projectsById, input.principal),
    tasks: filterTasksByAcl(input.tasks ?? [], bucketsById, projectsById, input.principal),
  };
}
