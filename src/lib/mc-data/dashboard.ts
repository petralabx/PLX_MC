// Dashboard aggregator — pure, deterministic, unit-tested (TASK-2565).
//
// One read over the viewer's projects, buckets and tasks (the store's
// ACL-scoped snapshot): delivery progress by project and by bucket, open work by
// stage, and the tasks still to do. No React, no store reads. "Complete" is the
// done band (merged/verified), "in progress" the doing band and "not started"
// the todo band — the same split mc_list_projects and the project overview use,
// so every surface counts progress identically.
//
// A task counts toward a project only through a bucket that belongs to it.
// Tasks whose bucket is unknown, or has no project, are reported as `unfiled`
// so the screen can say why its totals differ from the raw task count.

import { STAGES, bandOf, isProjectClosed, isArchived } from "@/lib/mc-data";
import type { Band, Bucket, Project, StageKey, Task } from "@/lib/mc-data";

/** Which projects the figures cover: open ones, closed ones, or all of them. */
export type DashboardScope = "active" | "closed" | "all";

export const DASHBOARD_SCOPES: readonly DashboardScope[] = ["active", "closed", "all"];

export interface ProgressCounts {
  done: number;
  inProgress: number;
  notStarted: number;
  /** inProgress + notStarted */
  remaining: number;
  total: number;
  /** done / total (0–1); null when there are no tasks, never NaN. */
  pctDone: number | null;
}

export interface ProjectProgress extends ProgressCounts {
  project: Project;
  closed: boolean;
  /** Buckets under the project (the visible ones). */
  buckets: number;
}

export interface BucketProgress extends ProgressCounts {
  bucket: Bucket;
  project: Project;
  closed: boolean;
}

export interface ScopeSummary extends ProgressCounts {
  projects: number;
  projectsAtRisk: number;
  projectsOffTrack: number;
  buckets: number;
  bucketsAtRisk: number;
  bucketsOffTrack: number;
}

export interface RemainingTask {
  task: Task;
  bucket: Bucket;
  project: Project;
  closed: boolean;
}

export interface StageCount {
  stage: StageKey;
  name: string;
  band: Band;
  tasks: number;
}

export interface DashboardModel {
  /** Most remaining work first, then by name. */
  projects: ProjectProgress[];
  /** Grouped in project order, buckets by name within a project. */
  buckets: BucketProgress[];
  remaining: RemainingTask[];
  scopes: Record<DashboardScope, ScopeSummary>;
  /** Tasks outside every project's buckets: no figure above includes them. */
  unfiled: { tasks: number; open: number };
}

export function inScope(closed: boolean, scope: DashboardScope): boolean {
  return scope === "all" || closed === (scope === "closed");
}

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

function countTasks(tasks: readonly Task[]): ProgressCounts {
  let done = 0;
  let inProgress = 0;
  let notStarted = 0;
  for (const task of tasks) {
    const band = bandOf(task.stage);
    if (band === "done") done += 1;
    else if (band === "doing") inProgress += 1;
    else notStarted += 1;
  }
  return withTotals(done, inProgress, notStarted);
}

function sumCounts(rows: readonly ProgressCounts[]): ProgressCounts {
  return withTotals(
    rows.reduce((n, r) => n + r.done, 0),
    rows.reduce((n, r) => n + r.inProgress, 0),
    rows.reduce((n, r) => n + r.notStarted, 0)
  );
}

function withTotals(done: number, inProgress: number, notStarted: number): ProgressCounts {
  const total = done + inProgress + notStarted;
  return {
    done,
    inProgress,
    notStarted,
    remaining: inProgress + notStarted,
    total,
    pctDone: total > 0 ? done / total : null,
  };
}

export function buildDashboard(
  tasks: readonly Task[],
  buckets: readonly Bucket[],
  projects: readonly Project[]
): DashboardModel {
  const archivedBuckets = new Set(buckets.filter((b) => isArchived(b) || isArchived(projects.find((p) => p.id === b.project))).map((b) => b.id));
  tasks = tasks.filter((t) => !archivedBuckets.has(t.bucket));
  buckets = buckets.filter((b) => !archivedBuckets.has(b.id));
  projects = projects.filter((p) => !isArchived(p));
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const filedBuckets = buckets.filter((b) => b.project && projectById.has(b.project));
  const tasksByBucket = new Map<string, Task[]>(filedBuckets.map((b) => [b.id, []]));
  const unfiled: Task[] = [];
  for (const task of tasks) {
    const list = tasksByBucket.get(task.bucket);
    if (list) list.push(task);
    else unfiled.push(task);
  }

  const bucketRows = filedBuckets.map((bucket): BucketProgress => {
    const project = projectById.get(bucket.project!)!;
    return {
      bucket,
      project,
      closed: isProjectClosed(project),
      ...countTasks(tasksByBucket.get(bucket.id)!),
    };
  });

  const projectRows = projects
    .map((project): ProjectProgress => {
      const own = bucketRows.filter((r) => r.project.id === project.id);
      return { project, closed: isProjectClosed(project), buckets: own.length, ...sumCounts(own) };
    })
    .sort((a, b) => b.remaining - a.remaining || byName(a.project.name, b.project.name));

  const rank = new Map(projectRows.map((r, i) => [r.project.id, i]));
  bucketRows.sort(
    (a, b) => rank.get(a.project.id)! - rank.get(b.project.id)! || byName(a.bucket.name, b.bucket.name)
  );

  const remaining: RemainingTask[] = [];
  for (const row of bucketRows) {
    for (const task of tasksByBucket.get(row.bucket.id)!) {
      if (bandOf(task.stage) !== "done") {
        remaining.push({ task, bucket: row.bucket, project: row.project, closed: row.closed });
      }
    }
  }

  const scopes = Object.fromEntries(
    DASHBOARD_SCOPES.map((scope) => {
      const ps = projectRows.filter((r) => inScope(r.closed, scope));
      const bs = bucketRows.filter((r) => inScope(r.closed, scope));
      const summary: ScopeSummary = {
        ...sumCounts(ps),
        projects: ps.length,
        projectsAtRisk: ps.filter((r) => r.project.health === "risk").length,
        projectsOffTrack: ps.filter((r) => r.project.health === "off").length,
        buckets: bs.length,
        bucketsAtRisk: bs.filter((r) => r.bucket.health === "risk").length,
        bucketsOffTrack: bs.filter((r) => r.bucket.health === "off").length,
      };
      return [scope, summary];
    })
  ) as Record<DashboardScope, ScopeSummary>;

  return {
    projects: projectRows,
    buckets: bucketRows,
    remaining,
    scopes,
    unfiled: { tasks: unfiled.length, open: unfiled.filter((t) => bandOf(t.stage) !== "done").length },
  };
}

/** Open tasks per stage, in pipeline order (Backlog → In Review), zeros kept. */
export function openStageCounts(rows: readonly RemainingTask[]): StageCount[] {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.task.stage, (counts.get(row.task.stage) ?? 0) + 1);
  return STAGES.filter((s) => s.band !== "done").map((s) => ({
    stage: s.key,
    name: s.name,
    band: s.band,
    tasks: counts.get(s.key) ?? 0,
  }));
}
