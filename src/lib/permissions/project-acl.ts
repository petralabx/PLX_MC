// Project-level ACL for restricted (private) Mission Control projects.
// Shared/default projects stay visible. Restricted projects fail closed:
// only allowlisted member tokens (emails, Entra oids, directory ids, or
// reviewed MCP service-principal ids) may read, list, or mutate contents.
//
// Pure helpers — do not import db / auth here. Server loaders live in
// project-acl-guard.ts so the permissions barrel stays browser-safe.

import { ApiError } from "@/lib/api/route";

export const PROJECT_VISIBILITY_SHARED = "shared" as const;
export const PROJECT_VISIBILITY_RESTRICTED = "restricted" as const;

export const PROJECT_VISIBILITIES = [
  PROJECT_VISIBILITY_SHARED,
  PROJECT_VISIBILITY_RESTRICTED,
] as const;

export type ProjectVisibility = (typeof PROJECT_VISIBILITIES)[number];

export const RESTRICTED_MIRROR_SP = {
  projects: "Projects · omitted (restricted)",
  roadmap: "Roadmap · omitted (restricted)",
  todos: "ToDos · omitted (restricted)",
} as const;

export interface ProjectAclFields {
  visibility?: string | null;
  members?: readonly string[] | null;
}

export interface ProjectAclPrincipal {
  /** Normalized identity tokens (email, oid, directory id, sp_*). */
  tokens: string[];
}

export function normalizeMemberToken(raw: string): string {
  return raw.trim().toLowerCase();
}

export function normalizeProjectMembers(members: readonly string[] | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const member of members ?? []) {
    const token = normalizeMemberToken(member);
    if (!token || seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}

export function principalFromTokens(
  ...raw: Array<string | null | undefined>
): ProjectAclPrincipal {
  return { tokens: normalizeProjectMembers(raw.filter((value): value is string => typeof value === "string")) };
}

export function mergePrincipals(
  ...principals: Array<ProjectAclPrincipal | null | undefined>
): ProjectAclPrincipal {
  return principalFromTokens(...principals.flatMap((principal) => principal?.tokens ?? []));
}

export function projectVisibility(project: ProjectAclFields | null | undefined): ProjectVisibility {
  return project?.visibility === PROJECT_VISIBILITY_RESTRICTED
    ? PROJECT_VISIBILITY_RESTRICTED
    : PROJECT_VISIBILITY_SHARED;
}

export function isRestrictedProject(project: ProjectAclFields | null | undefined): boolean {
  return projectVisibility(project) === PROJECT_VISIBILITY_RESTRICTED;
}

export function canAccessProject(
  project: ProjectAclFields | null | undefined,
  principal: ProjectAclPrincipal | null | undefined
): boolean {
  if (!isRestrictedProject(project)) return true;
  const members = new Set(normalizeProjectMembers(project?.members));
  if (members.size === 0) return false;
  return (principal?.tokens ?? []).some((token) => members.has(normalizeMemberToken(token)));
}

export function assertCanAccessProject(
  project: ProjectAclFields | null | undefined,
  principal: ProjectAclPrincipal | null | undefined
): void {
  if (canAccessProject(project, principal)) return;
  throw new ApiError(
    "project_acl_denied",
    "Not a member of this restricted project.",
    403
  );
}

export function canAccessBucket(
  bucket: { project?: string | null } | null | undefined,
  projectsById: Map<string, ProjectAclFields>,
  principal: ProjectAclPrincipal | null | undefined
): boolean {
  const projectId = bucket?.project;
  // Unparented (null/empty) stays shared-like. A non-empty id with no row
  // is a dangling parent — fail closed so ACL cannot be bypassed by omission.
  if (!projectId) return true;
  const project = projectsById.get(projectId);
  if (!project) return false;
  return canAccessProject(project, principal);
}

export function canAccessTask(
  task: { bucket: string },
  bucketsById: Map<string, { project?: string | null }>,
  projectsById: Map<string, ProjectAclFields>,
  principal: ProjectAclPrincipal | null | undefined
): boolean {
  return canAccessBucket(bucketsById.get(task.bucket), projectsById, principal);
}

export function indexById<T extends { id: string }>(rows: readonly T[]): Map<string, T> {
  return new Map(rows.map((row) => [row.id, row]));
}

export function filterProjectsByAcl<T extends ProjectAclFields & { id: string }>(
  projects: readonly T[],
  principal: ProjectAclPrincipal | null | undefined
): T[] {
  return projects.filter((project) => canAccessProject(project, principal));
}

export function filterBucketsByAcl<T extends { id: string; project?: string | null }>(
  buckets: readonly T[],
  projectsById: Map<string, ProjectAclFields>,
  principal: ProjectAclPrincipal | null | undefined
): T[] {
  return buckets.filter((bucket) => canAccessBucket(bucket, projectsById, principal));
}

export function filterTasksByAcl<T extends { bucket: string }>(
  tasks: readonly T[],
  bucketsById: Map<string, { project?: string | null }>,
  projectsById: Map<string, ProjectAclFields>,
  principal: ProjectAclPrincipal | null | undefined
): T[] {
  return tasks.filter((task) => canAccessTask(task, bucketsById, projectsById, principal));
}

export function restrictedProjectIds(
  projects: readonly (ProjectAclFields & { id: string })[]
): Set<string> {
  return new Set(projects.filter(isRestrictedProject).map((project) => project.id));
}

export function restrictedBucketIds(
  buckets: readonly { id: string; project?: string | null }[],
  restrictedProjects: ReadonlySet<string>
): Set<string> {
  return new Set(
    buckets
      .filter((bucket) => bucket.project && restrictedProjects.has(bucket.project))
      .map((bucket) => bucket.id)
  );
}

/** Hierarchy ids present in the full snapshot but hidden from this principal. */
export function hiddenHierarchyIds(input: {
  tasks: readonly { id: string }[];
  buckets: readonly { id: string }[];
  projects: readonly { id: string }[];
  visible: {
    tasks: readonly { id: string }[];
    buckets: readonly { id: string }[];
    projects: readonly { id: string }[];
  };
}): Set<string> {
  const visibleIds = new Set([
    ...input.visible.tasks.map((row) => row.id),
    ...input.visible.buckets.map((row) => row.id),
    ...input.visible.projects.map((row) => row.id),
  ]);
  const hidden = new Set<string>();
  for (const row of [...input.tasks, ...input.buckets, ...input.projects]) {
    if (row.id && !visibleIds.has(row.id)) hidden.add(row.id);
  }
  return hidden;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True when `text` mentions a hidden project/bucket/task id as a whole token. */
export function mentionsHiddenHierarchyId(
  text: string,
  hiddenIds: ReadonlySet<string>
): boolean {
  if (!text || hiddenIds.size === 0) return false;
  for (const id of hiddenIds) {
    if (!id) continue;
    const pattern = new RegExp(`(^|[^A-Za-z0-9_-])${escapeRegExp(id)}([^A-Za-z0-9_-]|$)`);
    if (pattern.test(text)) return true;
  }
  return false;
}

function stringFields(row: object): string[] {
  return Object.values(row).filter((value): value is string => typeof value === "string");
}

/**
 * Strip audit / conflict / error rows that name a hidden hierarchy id.
 * Used by GET /api/state so scoping tasks/buckets/projects is not undone by
 * side-channel metadata.
 */
export function filterStateSideChannels<
  TConflict extends { entityId: string },
  TError extends { entityId: string },
  TAudit extends { body: string },
>(input: {
  conflicts?: readonly TConflict[];
  errors?: readonly TError[];
  audit?: readonly TAudit[];
  hiddenIds: ReadonlySet<string>;
}): {
  conflicts: TConflict[];
  errors: TError[];
  audit: TAudit[];
} {
  const { hiddenIds } = input;
  const keepEntityRow = <T extends { entityId: string }>(row: T): boolean => {
    if (hiddenIds.has(row.entityId)) return false;
    return !stringFields(row).some((text) => mentionsHiddenHierarchyId(text, hiddenIds));
  };
  return {
    conflicts: (input.conflicts ?? []).filter(keepEntityRow),
    errors: (input.errors ?? []).filter(keepEntityRow),
    audit: (input.audit ?? []).filter((row) => !mentionsHiddenHierarchyId(row.body, hiddenIds)),
  };
}
