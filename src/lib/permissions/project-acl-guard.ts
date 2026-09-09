// Server-only project ACL loaders. Import from routes/actions, not the
// permissions barrel (keeps `pg` out of the browser bundle).

import { ApiError } from "@/lib/api/route";
import type { Bucket, Project, Task } from "@/lib/mc-data/types";
import { getBuckets, getEntity, getProjects } from "@/lib/sync/repo";
import {
  assertCanAccessProject,
  filterBucketsByAcl,
  filterProjectsByAcl,
  filterTasksByAcl,
  indexById,
  type ProjectAclPrincipal,
} from "./project-acl";

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
  principal: ProjectAclPrincipal
): Promise<void> {
  if (!projectId) return;
  const projects = await getProjects();
  const project = projects.find((row) => row.id === projectId);
  if (!project) return;
  assertCanAccessProject(project, principal);
}

export async function assertBucketProjectAccess(
  bucketId: string,
  principal: ProjectAclPrincipal
): Promise<void> {
  const buckets = await getBuckets();
  const bucket = buckets.find((row) => row.id === bucketId);
  if (!bucket) return;
  await assertProjectIdAccess(bucket.project, principal);
}

export async function assertTaskProjectAccess(
  taskId: string,
  principal: ProjectAclPrincipal
): Promise<void> {
  const row = await getEntity("task", taskId);
  if (!row) throw new ApiError("not_found", `unknown task ${taskId}`, 404);
  const task = row.data as unknown as Task;
  await assertBucketProjectAccess(task.bucket, principal);
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
