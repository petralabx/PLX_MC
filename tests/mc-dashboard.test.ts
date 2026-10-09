// Dashboard aggregator (TASK-2565) — a pure function of injected tasks, buckets
// and projects. Invariants under test: the complete / in progress / not started
// split follows the stage bands; every project's totals are the sum of its
// buckets; the active and closed scopes partition the projects and add up to
// "all"; tasks outside every project's buckets are reported as unfiled and
// counted nowhere else; empty sets never produce NaN; and the counts agree with
// the project overview's own rollup on the same tasks.

import { describe, expect, it } from "vitest";

import { BUCKETS, PROJECTS, TASKS, bandOf } from "@/lib/mc-data";
import type { Bucket, Project, Task } from "@/lib/mc-data";
import { DASHBOARD_SCOPES, buildDashboard, inScope, openStageCounts } from "@/lib/mc-data/dashboard";
import { projectProgress } from "@/components/mc/project-overview.helpers";

let seq = 0;
const task = (over: Partial<Task>): Task => ({ ...TASKS[0], id: `TASK-T${++seq}`, ...over }) as Task;
const project = (over: Partial<Project>): Project => ({ ...PROJECTS[0], ...over }) as Project;
const bucket = (over: Partial<Bucket>): Bucket => ({ ...BUCKETS[0], ...over }) as Bucket;

const open = project({ id: "PRJ-OPEN", name: "Open project", health: "risk", status: "active" });
const shut = project({ id: "PRJ-SHUT", name: "Shut project", health: "off", status: "closed" });
const b1 = bucket({ id: "BKT-1", name: "P1 — first", project: open.id, health: "track" });
const b2 = bucket({ id: "BKT-2", name: "P2 — second", project: open.id, health: "risk" });
const b3 = bucket({ id: "BKT-3", name: "Wrap-up", project: shut.id, health: "off" });
const loose = bucket({ id: "BKT-LOOSE", name: "No project", project: null });

const tasks = [
  task({ bucket: b1.id, stage: "merged" }),
  task({ bucket: b1.id, stage: "verified" }),
  task({ bucket: b1.id, stage: "progress" }),
  task({ bucket: b1.id, stage: "backlog" }),
  task({ bucket: b2.id, stage: "review" }),
  task({ bucket: b2.id, stage: "qa" }),
  task({ bucket: b2.id, stage: "planned" }),
  task({ bucket: b3.id, stage: "merged" }),
  task({ bucket: loose.id, stage: "backlog" }),
  // A bucket value that names no bucket at all (seen in live data).
  task({ bucket: "Planned", stage: "merged" }),
];
// Buckets deliberately out of order: the model sorts them.
const model = buildDashboard(tasks, [b3, loose, b2, b1], [shut, open]);
const row = (id: string) => model.buckets.find((r) => r.bucket.id === id)!;

describe("buildDashboard — bucket and project progress", () => {
  it("splits each bucket's tasks by stage band", () => {
    expect(row(b1.id)).toMatchObject({ done: 2, inProgress: 1, notStarted: 1, remaining: 2, total: 4, pctDone: 0.5 });
    expect(row(b2.id)).toMatchObject({ done: 0, inProgress: 2, notStarted: 1, remaining: 3, total: 3, pctDone: 0 });
    expect(row(b3.id)).toMatchObject({ done: 1, remaining: 0, total: 1, pctDone: 1, closed: true });
  });

  it("makes every project's totals the sum of its buckets", () => {
    for (const p of model.projects) {
      const own = model.buckets.filter((b) => b.project.id === p.project.id);
      for (const key of ["done", "inProgress", "notStarted", "remaining", "total"] as const) {
        expect(p[key], `${p.project.id}.${key}`).toBe(own.reduce((n, b) => n + b[key], 0));
      }
      expect(p.buckets).toBe(own.length);
    }
  });

  it("orders projects by remaining work and buckets by project, then name", () => {
    expect(model.projects.map((p) => p.project.id)).toEqual([open.id, shut.id]);
    expect(model.buckets.map((b) => b.bucket.id)).toEqual([b1.id, b2.id, b3.id]);
  });

  it("lists only open tasks as remaining, each with its bucket and project", () => {
    expect(model.remaining).toHaveLength(5);
    for (const r of model.remaining) {
      expect(bandOf(r.task.stage)).not.toBe("done");
      expect(r.task.bucket).toBe(r.bucket.id);
      expect(r.bucket.project).toBe(r.project.id);
    }
  });
});

describe("buildDashboard — scopes", () => {
  it("partitions projects into active and closed, which add up to all", () => {
    expect(model.scopes.active).toMatchObject({ projects: 1, done: 2, remaining: 5, total: 7 });
    expect(model.scopes.closed).toMatchObject({ projects: 1, done: 1, remaining: 0, total: 1 });
    const keys = ["projects", "buckets", "done", "inProgress", "notStarted", "remaining", "total"] as const;
    for (const key of keys) {
      expect(model.scopes.all[key], key).toBe(model.scopes.active[key] + model.scopes.closed[key]);
    }
  });

  it("counts at-risk and off-track projects and buckets in each scope", () => {
    expect(model.scopes.active).toMatchObject({
      projectsAtRisk: 1,
      projectsOffTrack: 0,
      buckets: 2,
      bucketsAtRisk: 1,
      bucketsOffTrack: 0,
    });
    expect(model.scopes.closed).toMatchObject({ projectsOffTrack: 1, buckets: 1, bucketsOffTrack: 1 });
  });

  it("treats a project with no status as active", () => {
    const legacy = project({ id: "PRJ-LEGACY", status: undefined });
    const m = buildDashboard([], [], [legacy]);
    expect(m.scopes.active.projects).toBe(1);
    expect(m.scopes.closed.projects).toBe(0);
  });

  it("inScope: all covers both; active and closed are exclusive", () => {
    expect(inScope(false, "active")).toBe(true);
    expect(inScope(true, "active")).toBe(false);
    expect(inScope(true, "closed")).toBe(true);
    expect(inScope(false, "closed")).toBe(false);
    expect(inScope(true, "all") && inScope(false, "all")).toBe(true);
  });
});

describe("buildDashboard — unfiled tasks and empty sets", () => {
  it("reports tasks outside every project's buckets as unfiled and counts them nowhere else", () => {
    expect(model.unfiled).toEqual({ tasks: 2, open: 1 });
    expect(model.scopes.all.total + model.unfiled.tasks).toBe(tasks.length);
    expect(model.remaining.some((r) => r.task.bucket === loose.id)).toBe(false);
    expect(model.buckets.some((r) => r.bucket.id === loose.id)).toBe(false);
  });

  it("never divides by zero", () => {
    const m = buildDashboard([], [b1], [open]);
    expect(m.buckets[0].pctDone).toBeNull();
    expect(m.projects[0].pctDone).toBeNull();
    for (const scope of DASHBOARD_SCOPES) expect(m.scopes[scope].pctDone).toBeNull();
    expect(buildDashboard([], [], [])).toMatchObject({ projects: [], buckets: [], remaining: [] });
  });
});

describe("openStageCounts", () => {
  it("counts open tasks per stage in pipeline order, keeping zeros", () => {
    const counts = openStageCounts(model.remaining);
    expect(counts.map((c) => c.stage)).toEqual(["backlog", "specced", "approved", "planned", "progress", "qa", "review"]);
    expect(counts.map((c) => c.tasks)).toEqual([1, 0, 0, 1, 1, 1, 1]);
    expect(counts.reduce((n, c) => n + c.tasks, 0)).toBe(model.remaining.length);
    expect(counts.filter((c) => c.band === "doing").map((c) => c.stage)).toEqual(["progress", "qa", "review"]);
  });
});

describe("buildDashboard on the seed data", () => {
  const seed = buildDashboard(TASKS, BUCKETS, PROJECTS);

  it("accounts for every task once: in a project's figures or as unfiled", () => {
    expect(seed.scopes.all.total + seed.unfiled.tasks).toBe(TASKS.length);
  });

  it("agrees with the project overview's rollup for every project", () => {
    for (const p of seed.projects) {
      const ids = new Set(BUCKETS.filter((b) => b.project === p.project.id).map((b) => b.id));
      const overview = projectProgress(TASKS.filter((t) => ids.has(t.bucket)));
      expect({ done: p.done, doing: p.inProgress, total: p.total }).toEqual({
        done: overview.done,
        doing: overview.doing,
        total: overview.total,
      });
    }
  });
});
