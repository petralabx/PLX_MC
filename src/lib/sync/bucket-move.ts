// Shared target check for moving a task to another bucket (TASK-2533): used by
// mc_update_task(s) and by inbound SharePoint Initiative changes.
// Archived buckets/projects (task 2532), retirement and project closure (task 2530)
// all refuse new task placements.
import { ApiError } from "@/lib/api/route";
import type { Bucket, Project } from "@/lib/mc-data/types";

type ArchivableBucket = Bucket & { archived?: boolean; archivedAt?: string | null };
type StatefulProject = Project & { status?: string };

/** Closed-project rule (TASK-2530), shared by every path that moves work into a project. */
export function closedProjectViolation(project: Project | undefined): string | null {
  return (project as StatefulProject | undefined)?.status === "closed" ? `project ${project!.id} is closed` : null;
}

/** Reject moving a task or bucket into a closed project (409 project_closed); `what` names the thing moved. */
export function assertMoveTargetProjectOpen(project: Project | undefined, what: string): void {
  const violation = closedProjectViolation(project);
  if (!violation) return;
  throw new ApiError(
    "project_closed",
    `Cannot move ${what}: ${violation}. Reopen it first (mc_update_project status=active).`,
    409
  );
}

export function bucketMoveTargetViolation(
  bucket: Bucket | undefined,
  project: Project | undefined
): string | null {
  if (!bucket) return "unknown bucket";
  const archived = bucket as ArchivableBucket;
  if (archived.archived === true || archived.archivedAt) return `bucket ${bucket.id} is archived`;
  if (project?.archivedAt) return `project ${project.id} is archived`;
  if (bucket.project && !project) return `unknown project ${bucket.project}`;
  return closedProjectViolation(project);
}
