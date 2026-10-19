// Shared target check for moving a task to another bucket (TASK-2533): used by
// mc_update_task(s) and by inbound SharePoint Initiative changes.
// Archived buckets/projects (task 2532), retirement and project closure (task 2530)
// all refuse new task placements.
import { ApiError } from "@/lib/api/route";
import type { Bucket, Project, Task } from "@/lib/mc-data/types";
import { isRestrictedProject } from "@/lib/permissions/project-acl";

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

/**
 * Uploaded evidence (TASK-3166) sits in the shared SharePoint library, which a
 * restricted project's access rules do not cover. MC never moves, deletes or
 * re-permissions those files, so it refuses to put such a task under a
 * restricted project (409 shared_evidence); `what` names the change.
 */
export function assertNoSharedEvidenceInRestricted(
  project: Project | undefined,
  tasks: readonly Pick<Task, "id" | "evidence">[],
  what: string
): void {
  if (!isRestrictedProject(project)) return;
  const ids = tasks.filter((task) => (task.evidence?.artifacts?.length ?? 0) > 0).map((task) => task.id);
  if (ids.length === 0) return;
  throw new ApiError(
    "shared_evidence",
    `Cannot ${what}: ${ids.join(", ")} ${ids.length === 1 ? "has" : "have"} evidence files in the shared SharePoint evidence library, ` +
      `which project ${project!.id}'s access rules do not cover. A person must relocate the files first.`,
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
