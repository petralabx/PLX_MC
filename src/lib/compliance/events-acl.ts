// Project-ACL filter for the /api/events export: an event bound to a task in a
// restricted project (e.g. task.updated before/after diffs) is withheld from
// principals outside that project. Events with no task, or for a task the Hub
// does not hold, are not project-scoped and pass through.
import type { Task } from "@/lib/mc-data/types";
import { loadProjectAclMaps } from "@/lib/permissions/project-acl-guard";
import { canAccessTask, type ProjectAclPrincipal } from "@/lib/permissions/project-acl";
import { getEntities } from "@/lib/sync/repo";
import type { EventRow } from "./repo";

export async function filterEventsByProjectAcl(
  events: readonly EventRow[],
  principal: ProjectAclPrincipal
): Promise<EventRow[]> {
  if (!events.some((event) => event.taskId)) return [...events];
  const [{ projectsById, bucketsById }, tasks] = await Promise.all([
    loadProjectAclMaps(),
    getEntities("task"),
  ]);
  const taskById = new Map(tasks.map((row) => [row.id, row.data as unknown as Task]));
  return events.filter((event) => {
    const task = event.taskId ? taskById.get(event.taskId) : undefined;
    return !task || canAccessTask(task, bucketsById, projectsById, principal);
  });
}
