// The page path and the ? sheet (TASK-3958; portal ADR-011 v2, zone 2 and
// Keys): pagePath (which project and initiative a page sits in), the one
// shortcut list the shell and the sheet share, the single-key switch, and the
// markup of the sheet and the top bar's path. No DOM environment (vitest runs
// in Node): rendered with renderToStaticMarkup.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { pagePath, screenTitle } from "@/components/mc/nav-model";
import { setNavZonesBuildFlag } from "@/components/mc/nav-zones";
import type { Route } from "@/components/mc/route";
import { SHORTCUT_GROUPS, VIEW_CHORDS, singleKeysPref } from "@/components/mc/shortcuts";
import { ShortcutsSheet } from "@/components/mc/shortcuts-sheet";
import { Topbar } from "@/components/mc/top-bar";
import type { Bucket, Project, Task } from "@/lib/mc-data";
import { allBuckets, allProjects, allTasks, bucketById, projectById, resetStore, taskById } from "@/lib/mc-data/store";

const store = { project: projectById, initiative: bucketById, task: taskById };

beforeEach(() => resetStore());

describe("pagePath", () => {
  it("puts a project page under its project", () => {
    const [project] = allProjects();
    expect(pagePath({ screen: "project", projectId: project.id }, store)).toEqual({ project, initiative: null });
  });

  it("puts an initiative page under its project and itself", () => {
    const initiative = allBuckets().find((b) => b.project)!;
    expect(pagePath({ screen: "bucket", bucketId: initiative.id }, store)).toEqual({
      project: projectById(initiative.project!),
      initiative,
    });
  });

  it("puts a task page under its initiative and that initiative's project", () => {
    const task = allTasks().find((t) => bucketById(t.bucket)?.project)!;
    const initiative = bucketById(task.bucket)!;
    expect(pagePath({ screen: "task", taskId: task.id }, store)).toEqual({ project: projectById(initiative.project!), initiative });
  });

  it("keeps an initiative with no project, and has no path for a missing record or any other page", () => {
    const loose: Bucket = { ...allBuckets()[0], id: "BKT-LOOSE", project: undefined };
    const find = { project: (): Project | undefined => undefined, initiative: () => loose, task: (): Task | undefined => undefined };
    expect(pagePath({ screen: "bucket", bucketId: "BKT-LOOSE" }, find)).toEqual({ project: null, initiative: loose });
    expect(pagePath({ screen: "project", projectId: "PRJ-GONE" }, store)).toBeNull();
    expect(pagePath({ screen: "bucket", bucketId: "BKT-GONE" }, store)).toBeNull();
    expect(pagePath({ screen: "task", taskId: "TASK-GONE" }, store)).toBeNull();
    expect(pagePath({ screen: "project" }, store)).toBeNull();
    for (const screen of ["home", "board", "projects", "dashboard"] as const) expect(pagePath({ screen }, store), screen).toBeNull();
  });
});

describe("the shortcut list", () => {
  const rows = SHORTCUT_GROUPS.flatMap((group) => group.rows);
  const said = (keys: string) => rows.filter((row) => row.keys.includes(keys));

  it("lists every g chord the shell runs, under its screen's name", () => {
    for (const [key, screen] of Object.entries(VIEW_CHORDS)) {
      expect(said(`g ${key}`).map((row) => row.what), key).toEqual([screenTitle(screen)]);
    }
    expect(said("g 1–9")).toHaveLength(1);
    expect(said("g 0")).toHaveLength(1);
  });

  it("marks exactly the single-key shortcuts the switch turns off", () => {
    const single = rows.filter((row) => row.single).flatMap((row) => row.keys);
    expect(new Set(single)).toEqual(new Set(["?", "[", "/", "Shift+S", ...Object.keys(VIEW_CHORDS).map((k) => `g ${k}`), "g 1–9", "g 0"]));
    // ⌘K takes a modifier; the tree's and the splitter's keys act only where focus is.
    for (const keys of ["⌘+K", "Esc", "↑", "A–Z", "Alt+↑", "Shift+F10", "Enter"]) {
      expect(said(keys).every((row) => !row.single), keys).toBe(true);
    }
  });
});

describe("the single-key switch", () => {
  afterEach(() => singleKeysPref.set(true, false));

  it("is on unless turned off", () => {
    // No storage in Node: the default holds until set.
    expect(singleKeysPref.get()).toBe(true);
    singleKeysPref.set(false, false);
    expect(singleKeysPref.get()).toBe(false);
  });
});

describe("the ? sheet", () => {
  const sheet = () => renderToStaticMarkup(createElement(ShortcutsSheet, { onClose: () => {}, nav: () => {} }));

  it("is a dialog with the switch first, every group, and a link to Help", () => {
    const html = sheet();
    expect(html).toContain('role="dialog" aria-modal="true" aria-labelledby="mc-shortcuts-h"');
    expect(html).toContain('<button type="button" class="keys-switch" role="switch" aria-checked="true" data-autofocus="true">');
    const headings = [...html.matchAll(/<section class="keys-grp" aria-labelledby="([^"]+)"><h3 id="([^"]+)">([^<]+)<\/h3>/g)];
    expect(headings.map((m) => m[3].replace(/&#x27;/g, "'"))).toEqual(SHORTCUT_GROUPS.map((g) => g.title));
    // One id per heading, with no spaces, so aria-labelledby names one element.
    for (const m of headings) expect(m[1]).toBe(m[2]);
    expect(headings.map((m) => m[2])).toEqual(["mc-keys-anywhere", "mc-keys-go-to", "mc-keys-in-the-sidebar", "mc-keys-on-the-sidebar-s-edge"]);
    expect(html).toContain("<kbd>g</kbd><span class=\"then\"> then </span><kbd>b</kbd>");
    expect(html).toContain("<kbd>Shift</kbd><span class=\"plus\">+</span><kbd>S</kbd>");
    expect(html).toContain('href="/?screen=help"');
    expect(html).not.toContain("keys-row off");
  });
});

describe("the page path in the top bar", () => {
  beforeEach(() => setNavZonesBuildFlag(true));
  afterEach(() => setNavZonesBuildFlag(false));

  const topbar = (route: Route) =>
    renderToStaticMarkup(createElement(Topbar, { route, nav: () => {}, dark: false, setDark: () => {}, onOpenPalette: () => {} }));
  const crumbs = (html: string) => {
    const start = html.indexOf('<nav class="crumbs"');
    return start < 0 ? "" : html.slice(start, html.indexOf("</nav>", start));
  };

  it("shows Plan / project / initiative on a task page, each segment a menu", () => {
    const task = allTasks().find((t) => bucketById(t.bucket)?.project)!;
    const initiative = bucketById(task.bucket)!;
    const project = projectById(initiative.project!)!;
    const html = crumbs(topbar({ screen: "task", taskId: task.id }));
    expect(html).toContain('<nav class="crumbs" aria-label="Page path"><span class="crumb-root">Plan</span>');
    expect(html).toContain(
      `<button type="button" class="crumb" popoverTarget="mc-path-projects" aria-controls="mc-path-projects" aria-expanded="false" aria-label="Project: ${project.name}. Other projects">`
    );
    expect(html).toContain(`aria-label="Initiative: ${initiative.name}. Other initiatives"`);
    // The initiatives menu holds the project's initiatives, the current one checked.
    const menu = html.slice(html.indexOf('id="mc-path-initiatives"'));
    const names = [...menu.matchAll(/<span class="nm">([^<]+)<\/span>/g)].map((m) => m[1]);
    const expected = allBuckets()
      .filter((b) => b.project === project.id && !b.archivedAt)
      .map((b) => b.name)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    expect(names).toEqual(expected.map((n) => n.replace(/&/g, "&amp;")));
    expect(menu).toMatch(new RegExp(`aria-current="true"><span class="nm">${initiative.name}</span>`));
  });

  it("shows only the project on a project page, and no path elsewhere or in the default shell", () => {
    const [project] = allProjects();
    const html = crumbs(topbar({ screen: "project", projectId: project.id }));
    expect(html).toContain("Other projects");
    expect(html).not.toContain("Other initiatives");
    expect(topbar({ screen: "home" })).not.toContain('class="crumbs"');
    setNavZonesBuildFlag(false);
    expect(topbar({ screen: "project", projectId: project.id })).not.toContain('class="crumbs"');
  });
});
