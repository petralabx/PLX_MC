// Every task sits in a bucket of a project (TASK-4005, Vince 2026-10-26): no door
// creates a task in a bucket that belongs to no project. createTask (UI, REST,
// MCP mc_create_task, draft accept) and routing's createConfirmedTask
// (mc_create_routed_task) both ask this before any write.

import { ApiError } from "@/lib/api/route";

/** Throws 422 bucket_without_project unless the bucket names a project that exists. */
export function assertBucketHasProject(
  bucket: { id: string; project?: string | null },
  projects: readonly { id: string }[]
): void {
  const projectId = bucket.project?.trim();
  if (projectId && projects.some((p) => p.id === projectId)) return;
  throw new ApiError(
    "bucket_without_project",
    projectId
      ? `Bucket ${bucket.id} names project ${projectId}, which does not exist. Move the bucket into a project, then create the task.`
      : `Bucket ${bucket.id} belongs to no project. Every task sits in a bucket of a project: move the bucket into a project, then create the task.`,
    422
  );
}
