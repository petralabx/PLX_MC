// "My projects" on the Approvals screen (TASK-3720). A project is one of the
// viewer's projects when they are on its member list, own it, or are assigned
// (assignee or coassignee) an open task in it. Open means not in a terminal
// stage (isClosedStage) and not in an archived bucket or project (isArchived).
// An archived or closed project is never listed, whatever the reason.
// The project ACL always bounds it: the hierarchy is scoped first, so a
// restricted project the viewer cannot access is never theirs, even when they
// hold a task in it. Owner, assignee and member ids match the way the ACL
// matches members: normalizeMemberToken over the principal's email, oid and
// directory ids.

import {
  approvalEvidenceRef,
  isArchived,
  isClosedStage,
  pendingApprovalGates,
  type ApprovalsProjectsResponse,
  type Bucket,
  type MyProject,
  type MyProjectReason,
  type Project,
  type ProjectGateRow,
  type ProjectQuestionRow,
  type Task,
} from "@/lib/mc-data";
import {
  indexById,
  normalizeMemberToken,
  normalizeProjectMembers,
  type ProjectAclPrincipal,
} from "@/lib/permissions/project-acl";
import { loadProjectAclMaps, scopeHierarchy } from "@/lib/permissions/project-acl-guard";
import { getEntities } from "@/lib/sync/repo";

export interface ProjectHierarchy {
  tasks: readonly Task[];
  buckets: readonly Bucket[];
  projects: readonly Project[];
  principal: ProjectAclPrincipal;
}

type Scoped = { tasks: Task[]; buckets: Bucket[]; projects: Project[] };

// Over a hierarchy already scoped to the principal.
function mine(scoped: Scoped, principal: ProjectAclPrincipal): MyProject[] {
  const tokens = new Set(principal.tokens.map(normalizeMemberToken));
  const holds = (raw: string | null | undefined) => !!raw && tokens.has(normalizeMemberToken(raw));
  const bucketsById = indexById(scoped.buckets);
  const projectsById = indexById(scoped.projects);
  const assigned = new Set<string>();
  for (const task of scoped.tasks) {
    const bucket = bucketsById.get(task.bucket);
    const project = bucket?.project ? projectsById.get(bucket.project) : undefined;
    if (!project || isClosedStage(task.stage) || isArchived(bucket) || isArchived(project)) continue;
    if (holds(task.assignee) || (task.coassignees ?? []).some(holds)) assigned.add(project.id);
  }
  return scoped.projects.flatMap((project) => {
    // An archived or closed project has no live work to follow, whoever owns it.
    if (isArchived(project) || project.status === "closed") return [];
    const reasons: MyProjectReason[] = [];
    if (normalizeProjectMembers(project.members).some((member) => tokens.has(member))) reasons.push("member");
    if (holds(project.owner)) reasons.push("owner");
    if (assigned.has(project.id)) reasons.push("assignee");
    return reasons.length > 0 ? [{ id: project.id, name: project.name, reasons }] : [];
  });
}

/** The viewer's projects, in project order. Pure. */
export function myProjects(input: ProjectHierarchy): MyProject[] {
  return mine(scopeHierarchy(input), input.principal);
}

/**
 * Every open question (to anyone) and every pending gate on the tasks of the
 * viewer's projects, oldest first. Pure. A question's text is already on the
 * task's activity, and the task itself is readable through GET /api/state, for
 * everyone the ACL admits, so this widens nothing.
 */
export function projectApprovals(input: ProjectHierarchy): ApprovalsProjectsResponse {
  const scoped = scopeHierarchy(input);
  const projects = mine(scoped, input.principal);
  const ids = new Set(projects.map((project) => project.id));
  const bucketsById = indexById(scoped.buckets);
  const questions: ProjectQuestionRow[] = [];
  const gates: ProjectGateRow[] = [];
  for (const task of scoped.tasks) {
    const projectId = bucketsById.get(task.bucket)?.project;
    if (!projectId || !ids.has(projectId)) continue;
    const row = { taskId: task.id, taskTitle: task.title, stage: task.stage, projectId };
    for (const question of task.questions ?? []) {
      if (question.status === "open") questions.push({ ...row, question });
    }
    for (const gate of pendingApprovalGates(task)) {
      gates.push({ ...row, gate, evidence: approvalEvidenceRef(task.evidence) });
    }
  }
  questions.sort((a, b) => a.question.askedAt.localeCompare(b.question.askedAt));
  gates.sort((a, b) => a.gate.requestedAt.localeCompare(b.gate.requestedAt));
  return { projects, questions, gates };
}

async function loadHierarchy(principal: ProjectAclPrincipal): Promise<ProjectHierarchy> {
  const [rows, { projects, buckets }] = await Promise.all([getEntities("task"), loadProjectAclMaps()]);
  return { tasks: rows.map((row) => row.data as unknown as Task), buckets, projects, principal };
}

/** GET /api/approvals/projects for this principal. */
export async function listProjectApprovals(principal: ProjectAclPrincipal): Promise<ApprovalsProjectsResponse> {
  return projectApprovals(await loadHierarchy(principal));
}

/** The principal's projects, read now. */
export async function loadMyProjects(principal: ProjectAclPrincipal): Promise<MyProject[]> {
  return myProjects(await loadHierarchy(principal));
}
