// TASK-3841: the Projects page lists every open project with its initiatives,
// then the initiatives that belong to no open project under No project.
// Closed and archived records stay off it, as they stay out of the sidebar.
// No DOM environment (vitest runs in Node) — rendered with renderToStaticMarkup.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";

import { ProjectsView } from "@/components/mc/projects-view";
import {
  __setStateLoaderForTests,
  allBuckets,
  allProjects,
  allTasks,
  hydrate,
  openConflicts,
  openErrors,
  resetStore,
} from "@/lib/mc-data/store";

beforeEach(() => resetStore());

const render = () =>
  renderToStaticMarkup(createElement(ProjectsView, { route: { screen: "projects" }, nav: () => {} }));

describe("Projects page", () => {
  it("lists the open project with its initiatives, as real links", () => {
    const html = render();
    expect(html).toContain('data-testid="projects-screen"');
    expect(html).toContain("<h1>Projects</h1>");
    expect(html).toContain("<b>1</b> project</span>");
    // No viewer on the server render, so nothing is "yours" yet.
    expect(html).toContain('id="pj-h-others">All projects</h2>');
    expect(html).toContain('href="/?screen=project&amp;projectId=PRJ-PORTAL-GOLIVE" class="pj-name"');
    for (const bucket of allBuckets()) {
      expect(html).toContain(`href="/?screen=bucket&amp;bucketId=${bucket.id}" class="pj-init"`);
    }
    expect(html).not.toContain("No project");
  });

  it("puts initiatives without an open project under No project, and leaves closed and archived ones off", async () => {
    const [project] = allProjects();
    const [bucket] = allBuckets();
    __setStateLoaderForTests(async () => ({
      tasks: allTasks().slice(0, 1),
      risks: [],
      files: [],
      conflicts: openConflicts(),
      errors: openErrors(),
      audit: [],
      counts: {},
      lastSweep: "2026.10.24 · 12:00",
      projects: [
        project,
        { ...project, id: "PRJ-DONE", name: "Done project", status: "closed" as const },
        { ...project, id: "PRJ-OLD", name: "Archived project", archivedAt: "2026-10-01T00:00:00Z" },
      ],
      buckets: [
        bucket,
        { ...bucket, id: "BKT-LOOSE", name: "Loose ends", project: null },
        { ...bucket, id: "BKT-DONE", name: "Done work", project: "PRJ-DONE" },
        { ...bucket, id: "BKT-GONE", name: "Archived work", project: null, archivedAt: "2026-10-01T00:00:00Z" },
      ],
    }));
    await hydrate();
    const html = render();
    expect(html).toContain('id="pj-h-none">No project</h2>');
    expect(html).toContain('href="/?screen=bucket&amp;bucketId=BKT-LOOSE" class="pj-init"');
    for (const hidden of ["Done project", "Done work", "Archived project", "Archived work"]) {
      expect(html).not.toContain(hidden);
    }
  });
});
