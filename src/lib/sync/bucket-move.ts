// Shared target check for moving a task to another bucket (TASK-2533): used by
// mc_update_task(s) and by inbound SharePoint Initiative changes.
// Archived buckets (task 2532) and closed projects (task 2530) are not on this
// base, so each guard only fires when the record exposes its flag today.
import type { Bucket, Project } from "@/lib/mc-data/types";

type ArchivableBucket = Bucket & { archived?: boolean; archivedAt?: string | null };
type StatefulProject = Project & { status?: string };

export function bucketMoveTargetViolation(
  bucket: Bucket | undefined,
  project: Project | undefined
): string | null {
  if (!bucket) return "unknown bucket";
  const archived = bucket as ArchivableBucket;
  if (archived.archived === true || archived.archivedAt) return `bucket ${bucket.id} is archived`;
  if (bucket.project && !project) return `unknown project ${bucket.project}`;
  if ((project as StatefulProject | undefined)?.status === "closed") return `project ${project!.id} is closed`;
  return null;
}
