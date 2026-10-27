// Project-ACL filter for the /api/events export: an event bound to a task in a
// restricted project (e.g. task.updated before/after diffs) is withheld from
// principals outside that project. So is an event whose payload names such a
// project or bucket, or a pr.task_link event that names such a task. Events with
// no task, or for a task the Hub does not hold, are not project-scoped and pass.
import type { Bucket, Project, Task } from "@/lib/mc-data/types";
import { loadProjectAclMaps } from "@/lib/permissions/project-acl-guard";
import { canAccessBucket, canAccessProject, canAccessTask, type ProjectAclPrincipal } from "@/lib/permissions/project-acl";
import { getEntities } from "@/lib/sync/repo";
import type { EventRow } from "./repo";
import { PR_TASK_LINK_EVENT } from "./types";

/**
 * ACL maps a caller already holds; taskById must cover every task the events
 * name, including payload.taskIds of any pr.task_link event passed in.
 */
export interface ProjectAclPreload {
  projectsById: Map<string, Project>;
  bucketsById: Map<string, Bucket>;
  taskById: Map<string, { bucket: string }>;
}

export async function filterEventsByProjectAcl(
  events: readonly EventRow[],
  principal: ProjectAclPrincipal,
  // The Dashboard's In flight poll passes its own maps, so a poll every 20 s
  // never reads the whole task table.
  preload?: ProjectAclPreload
): Promise<EventRow[]> {
  if (!events.some((event) => event.taskId || event.payload.projectId || event.payload.bucketId || event.kind === PR_TASK_LINK_EVENT)) {
    return [...events];
  }
  const { projectsById, bucketsById, taskById } = preload ?? (await loadAclMaps());
  const taskAllowed = (taskId: string) => {
    const task = taskById.get(taskId);
    return !task || canAccessTask(task, bucketsById, projectsById, principal);
  };
  return events.filter((event) => {
    if (typeof event.payload.projectId === "string") {
      const project = projectsById.get(event.payload.projectId);
      if (project && !canAccessProject(project, principal)) return false;
    }
    if (typeof event.payload.bucketId === "string") {
      const bucket = bucketsById.get(event.payload.bucketId);
      if (bucket && !canAccessBucket(bucket, projectsById, principal)) return false;
    }
    if (!namedTaskIds(event).every(taskAllowed)) return false;
    return !event.taskId || taskAllowed(event.taskId);
  });
}

// A pr.task_link event (TASK-4004) sets taskId only when the PR linked, but every
// outcome names its tasks in payload.taskIds; each one the Hub holds scopes it.
function namedTaskIds(event: EventRow): string[] {
  if (event.kind !== PR_TASK_LINK_EVENT || !Array.isArray(event.payload.taskIds)) return [];
  return event.payload.taskIds.filter((id): id is string => typeof id === "string");
}

async function loadAclMaps(): Promise<ProjectAclPreload> {
  const [{ projectsById, bucketsById }, tasks] = await Promise.all([
    loadProjectAclMaps(),
    getEntities("task"),
  ]);
  return {
    projectsById,
    bucketsById,
    taskById: new Map(tasks.map((row) => [row.id, row.data as unknown as Task])),
  };
}
