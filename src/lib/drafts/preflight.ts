// Draft Projects (TASK-4059): the checks a submit runs before it freezes a
// version (PRD § Preflight). Pure: the caller loads the registry, projects and
// people. Accept (step 3) runs the same checks again, because live state can
// change during review.
//
// Preflight mirrors what createProject / createBucket / createTask enforce
// (src/lib/sync/state.ts): allow-listed repos, an open parent project, known
// owners, names. Completeness covers the research rules the create functions
// do not know about.

import { isArchived, isPetraEmail, isProjectClosed } from "@/lib/mc-data/helpers";
import { normalizeRepoInputs } from "@/lib/mc-data/repos";
import type { Human, Project, Repo } from "@/lib/mc-data/types";
import { canAccessProject, type ProjectAclPrincipal } from "@/lib/permissions/project-acl";

import type { DraftContent, DraftIssue } from "./types";

export interface PreflightContext {
  registry: Record<string, Repo>;
  projects: readonly Project[];
  humans: readonly Human[];
  /** The caller, for the ACL on an existing project. */
  principal: ProjectAclPrincipal;
}

/** A known Petra person: a directory id or email, or any Petra-domain email. */
export function isKnownPerson(raw: string, humans: readonly Human[]): boolean {
  const needle = raw.trim().toLowerCase();
  if (!needle) return false;
  if (humans.some((h) => h.id.toLowerCase() === needle || (h.email ?? "").toLowerCase() === needle)) return true;
  return isPetraEmail(needle);
}

export function preflightIssues(content: DraftContent, ctx: PreflightContext): DraftIssue[] {
  const issues: DraftIssue[] = [];
  const add = (code: string, path: string, message: string) => issues.push({ code, path, message });
  const checkRepos = (repos: string[], path: string) => {
    for (const r of normalizeRepoInputs(repos, ctx.registry).rejected) add("repo_not_allowed", path, r.message);
  };
  const checkOwner = (raw: string | null, path: string, required: boolean) => {
    if (!raw) {
      if (required) add("owner_required", path, "Name an owner: a Petra person's directory id or email.");
      return;
    }
    if (!isKnownPerson(raw, ctx.humans)) add("unknown_owner", path, `"${raw}" is not a known Petra person.`);
  };

  if (!content.title.trim()) add("title_required", "title", "A draft needs a title.");

  const project = content.plan.project;
  if (project.existing) {
    const live = ctx.projects.find((p) => p.id === project.existing);
    if (!live || !canAccessProject(live, ctx.principal)) {
      add("unknown_project", "plan.project.existing", `Project ${project.existing} does not exist.`);
    } else if (isArchived(live)) {
      add("project_archived", "plan.project.existing", `Project ${live.id} is archived.`);
    } else if (isProjectClosed(live)) {
      add("project_closed", "plan.project.existing", `Project ${live.id} is closed; reopen it first.`);
    }
  } else {
    if (!project.name.trim()) add("name_required", "plan.project.name", "A new project needs a name.");
    checkOwner(project.owner, "plan.project.owner", true);
    checkRepos(project.repos, "plan.project.repos");
  }

  const buckets = content.plan.buckets;
  if (buckets.length === 0) add("buckets_required", "plan.buckets", "A plan needs at least one bucket.");
  const bucketKeys = new Set(buckets.map((b) => b.key));
  for (const b of buckets) {
    const at = `plan.buckets[${b.key}]`;
    if (!b.name.trim()) add("name_required", `${at}.name`, `Bucket ${b.key} needs a name.`);
    checkOwner(b.owner, `${at}.owner`, true);
    checkRepos(b.repos, `${at}.repos`);
  }

  const taskKeys = new Set(content.plan.tasks.map((t) => t.key));
  for (const t of content.plan.tasks) {
    const at = `plan.tasks[${t.key}]`;
    if (!t.title.trim()) add("title_required", `${at}.title`, `Task ${t.key} needs a title.`);
    if (!bucketKeys.has(t.bucket)) add("unknown_bucket", `${at}.bucket`, `Task ${t.key} names bucket ${t.bucket}, which the plan does not have.`);
    checkRepos(t.repos, `${at}.repos`);
    checkOwner(t.accountableOwner, `${at}.accountableOwner`, false);
    for (const dep of t.dependsOn) {
      if (dep === t.key) add("self_dependency", `${at}.dependsOn`, `Task ${t.key} cannot depend on itself.`);
      else if (/^T\d+$/.test(dep) && !taskKeys.has(dep)) add("unknown_dependency", `${at}.dependsOn`, `Task ${t.key} depends on ${dep}, which the plan does not have.`);
    }
  }
  return issues;
}

/** The research rules a submit needs (PRD § Research). */
export function completenessIssues(content: DraftContent): DraftIssue[] {
  const issues: DraftIssue[] = [];
  const add = (code: string, path: string, message: string) => issues.push({ code, path, message });
  const r = content.research;
  if (!r.summary.trim()) add("summary_required", "research.summary", "Write a summary of the plan.");
  if (!r.recommendation.trim()) add("recommendation_required", "research.recommendation", "Write the recommendation.");
  if (r.approaches.length < 2) add("approaches_required", "research.approaches", "Compare at least two approaches.");
  const chosen = r.approaches.filter((a) => a.chosen).length;
  if (r.approaches.length >= 2 && chosen !== 1) add("one_approach_chosen", "research.approaches", `Choose exactly one approach; ${chosen} are chosen.`);
  const refs = new Set<string>();
  for (const s of r.sources) {
    if (refs.has(s.ref)) add("duplicate_source_ref", "research.sources", `Source ref ${s.ref} is used twice.`);
    refs.add(s.ref);
  }
  r.findings.forEach((f, i) => {
    for (const ref of f.sources) {
      if (!refs.has(ref)) add("unknown_source_ref", `research.findings[${i}].sources`, `Finding ${i + 1} cites ${ref}, which is not a source.`);
    }
  });
  if (content.plan.tasks.length === 0) add("tasks_required", "plan.tasks", "A plan needs at least one task.");
  return issues;
}

export function submitIssues(content: DraftContent, ctx: PreflightContext): DraftIssue[] {
  return [...completenessIssues(content), ...preflightIssues(content, ctx)];
}
