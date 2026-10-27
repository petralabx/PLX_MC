// The command palette's Recent and Starred groups, and the recents model
// (TASK-3853). In the zoned shell the palette opens on the pages the person
// opened last in this browser, newest first and without the page it opened
// over, then on their stars with the g 1 to g 6 keys that open them. The
// default shell's palette is unchanged. No DOM environment (vitest runs in
// Node): rendered with renderToStaticMarkup.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CommandPalette, __resetRecentsForTests, rememberRecent } from "@/components/mc/command-palette";
import { RECENTS_CAP, RECENTS_KEPT, createRecents, navCommands, recentKeyOf, type RecentKey } from "@/components/mc/nav-model";
import { setNavZonesBuildFlag } from "@/components/mc/nav-zones";
import type { Route } from "@/components/mc/route";
import { __resetStarsForTests } from "@/components/mc/use-stars";
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

const memoryStorage = () => {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
  };
};

describe("recentKeyOf", () => {
  it("keys a screen, a project, an initiative and a task by what they open", () => {
    expect(recentKeyOf({ screen: "goals" })).toBe("screen:goals");
    expect(recentKeyOf({ screen: "list" })).toBe("screen:list");
    expect(recentKeyOf({ screen: "project", projectId: "PRJ-A" })).toBe("project:PRJ-A");
    expect(recentKeyOf({ screen: "bucket", bucketId: "BKT-B" })).toBe("bucket:BKT-B");
    expect(recentKeyOf({ screen: "task", taskId: "TASK-1" })).toBe("task:TASK-1");
    expect(recentKeyOf({ screen: "task" })).toBeNull();
  });
});

describe("createRecents", () => {
  it("lists the newest first, once each, keeps RECENTS_KEPT, and keeps them in storage", () => {
    const storage = memoryStorage();
    const recents = createRecents(() => storage);
    for (let i = 1; i <= RECENTS_KEPT + 2; i++) recents.visit(`task:TASK-${i}`);
    recents.visit("task:TASK-5");
    const list = recents.list();
    expect(list).toHaveLength(RECENTS_KEPT);
    expect(list.slice(0, 3)).toEqual(["task:TASK-5", "task:TASK-14", "task:TASK-13"]);
    expect(list.filter((k) => k === "task:TASK-5")).toHaveLength(1);
    // A second browser tab reads the same list back.
    expect(createRecents(() => storage).list()).toEqual(list);
  });

  it("keeps another tab's visits: each visit reads storage again before it writes", () => {
    const storage = memoryStorage();
    const tabA = createRecents(() => storage);
    const tabB = createRecents(() => storage);
    expect(tabB.list()).toEqual([]);
    tabA.visit("task:TASK-1");
    tabA.visit("task:TASK-2");
    tabB.visit("screen:goals");
    expect(JSON.parse(storage.map.get("mc.nav.recents") ?? "[]")).toEqual(["screen:goals", "task:TASK-2", "task:TASK-1"]);
    expect(tabB.list()).toEqual(["screen:goals", "task:TASK-2", "task:TASK-1"]);
  });

  it("holds one array until the next visit, and tells its listeners", () => {
    const recents = createRecents(() => memoryStorage());
    let told = 0;
    recents.subscribe(() => told++);
    recents.visit("screen:goals");
    const first = recents.list();
    expect(recents.list()).toBe(first);
    recents.visit("screen:goals");
    expect(told).toBe(1);
    recents.visit("screen:home");
    expect(recents.list()).not.toBe(first);
    expect(told).toBe(2);
  });

  it("starts empty on unreadable or foreign storage, and still works without storage", () => {
    const junk = memoryStorage();
    junk.map.set("mc.nav.recents", '["screen:goals", 7, "javascript:alert(1)", "task:TASK-1"]');
    expect(createRecents(() => junk).list()).toEqual(["screen:goals", "task:TASK-1"]);
    junk.map.set("mc.nav.recents", "{not json");
    expect(createRecents(() => junk).list()).toEqual([]);
    const blocked = createRecents(() => {
      throw new Error("blocked");
    });
    blocked.visit("screen:goals");
    expect(blocked.list()).toEqual(["screen:goals"]);
  });
});

describe("the palette's Recent and Starred groups", () => {
  beforeEach(() => {
    resetStore();
    __resetRecentsForTests();
    __resetStarsForTests();
    setNavZonesBuildFlag(true);
  });
  afterEach(() => setNavZonesBuildFlag(false));

  const noop = () => {};
  const palette = (route?: Route) =>
    renderToStaticMarkup(
      createElement(CommandPalette, { onClose: noop, nav: noop, route, onOpenNewTask: noop, onOpenNewInitiative: noop, onOpenNewProject: noop })
    );
  const text = (html: string) =>
    html.replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  // Each group's title and its rows' labels and hints, in order, as text.
  const groups = (html: string) =>
    [...html.matchAll(/<div class="cgrp"><div class="gh">([^<]+)<\/div>(.*?)(?=<div class="cgrp">|$)/g)].map((m) => ({
      title: m[1],
      rows: [...m[2].matchAll(/<span>([^<]+)<\/span>(?:<span class="hint">([^<]+)<\/span>)?/g)].map((r) => [text(r[1]), text(r[2] ?? "")]),
    }));
  const visit = (...keys: RecentKey[]) => keys.forEach((key) => rememberRecent(key));

  it("opens on Recent, newest first, without the page it opened over", () => {
    const [task] = allTasks();
    const [bucket] = allBuckets();
    visit("screen:goals", `bucket:${bucket.id}`, `task:${task.id}`, "screen:home");
    const [recent] = groups(palette({ screen: "home" }));
    expect(recent.title).toBe("Recent");
    expect(recent.rows.map(([label]) => label)).toEqual([
      `${task.id} · ${task.title}`,
      `Initiative · ${bucket.name}`,
      "Go to Goals & production",
    ]);
  });

  it("shows at most RECENTS_CAP, after leaving out the page under the palette", () => {
    const tasks = allTasks().slice(0, RECENTS_CAP + 2);
    expect(tasks).toHaveLength(RECENTS_CAP + 2);
    visit(...tasks.map((t): RecentKey => `task:${t.id}`));
    const [recent] = groups(palette({ screen: "task", taskId: tasks.at(-1)!.id }));
    expect(recent.rows).toHaveLength(RECENTS_CAP);
    expect(recent.rows[0][0]).toBe(`${tasks.at(-2)!.id} · ${tasks.at(-2)!.title}`);
  });

  it("still lists a closed project: the palette's Projects group leaves it out", async () => {
    const [project] = allProjects();
    __setStateLoaderForTests(async () => ({
      tasks: allTasks(),
      risks: [],
      files: [],
      conflicts: openConflicts(),
      errors: openErrors(),
      audit: [],
      counts: {},
      lastSweep: "2026.10.25 · 04:00",
      projects: [project, { ...project, id: "PRJ-DONE", name: "Done project", status: "closed" as const }],
      buckets: allBuckets(),
    }));
    await hydrate();
    visit("project:PRJ-DONE");
    __resetStarsForTests(["project:PRJ-DONE"]);
    const html = groups(palette({ screen: "home" }));
    expect(html.find((g) => g.title === "Recent")?.rows).toEqual([["Project · Done project", "PRJ-DONE"]]);
    expect(html.find((g) => g.title === "Starred")?.rows[0]).toEqual(["Project · Done project", "g 1"]);
    expect(html.find((g) => g.title === "Projects")?.rows.map(([label]) => label)).not.toContain("Project · Done project");
  });

  it("leaves out a recent whose record is gone", () => {
    visit("project:PRJ-GONE", "task:TASK-GONE", "screen:goals");
    const [recent] = groups(palette({ screen: "home" }));
    expect(recent.rows.map(([label]) => label)).toEqual(["Go to Goals & production"]);
  });

  it("lists the stars next, in their order, with the g keys that open them", () => {
    const [bucket] = allBuckets();
    __resetStarsForTests(["screen:board", "project:PRJ-PORTAL-GOLIVE", `bucket:${bucket.id}`]);
    const starred = groups(palette({ screen: "home" })).find((g) => g.title === "Starred");
    expect(starred?.rows).toEqual([
      ["Go to All work", "g 1"],
      ["Project · PLX Portal Go-Live", "g 2"],
      [`Initiative · ${bucket.name}`, "g 3"],
      ["Star this page", "Shift S"],
    ]);
  });

  it("opens the tenth star with g 0, and leaves out a gone star, which keeps its slot", async () => {
    __setStateLoaderForTests(async () => ({
      tasks: allTasks(),
      risks: [],
      files: [],
      conflicts: openConflicts(),
      errors: openErrors(),
      audit: [],
      counts: {},
      lastSweep: "2026.10.26 · 04:00",
      projects: allProjects(),
      buckets: allBuckets(),
    }));
    await hydrate();
    const screens = ["home", "mine", "approvals", "board", "goals", "help", "dashboard", "feed"].map((s) => `screen:${s}`);
    __resetStarsForTests([...screens.slice(0, 2), "project:PRJ-GONE", ...screens.slice(2), "screen:sync"]);
    const starred = groups(palette({ screen: "insights" })).find((g) => g.title === "Starred");
    expect(starred?.rows.map(([, hint]) => hint)).toEqual(["g 1", "g 2", "g 4", "g 5", "g 6", "g 7", "g 8", "g 9", "g 0", "Shift S"]);
  });

  it("closes Starred with Unstar this page and Edit starred, and searches them once in Starred", () => {
    __resetStarsForTests(["screen:goals"]);
    const editing = (route: Route) =>
      renderToStaticMarkup(
        createElement(CommandPalette, {
          onClose: noop,
          nav: noop,
          route,
          onOpenNewTask: noop,
          onOpenNewInitiative: noop,
          onOpenNewProject: noop,
          onEditStarred: noop,
        })
      );
    const opened = groups(editing({ screen: "goals" }));
    expect(opened.find((g) => g.title === "Starred")?.rows).toEqual([
      ["Go to Goals & production", "g 1"],
      ["Unstar this page", "Shift S"],
      ["Edit starred", "Alt ↑ ↓ to move"],
    ]);
    // Each group shows once: React keys the groups by title.
    const titles = opened.map((g) => g.title);
    expect(new Set(titles).size).toBe(titles.length);
    // No page star where a page cannot be starred, as on a task.
    const [task] = allTasks();
    expect(groups(editing({ screen: "task", taskId: task.id })).flatMap((g) => g.rows.map(([label]) => label))).not.toContain(
      "Star this page"
    );
  });

  it("opens straight on Create when there are no recents and no stars", () => {
    expect(groups(palette({ screen: "home" }))[0].title).toBe("Create");
  });

  it("offers the Projects page in the zoned shell, from the shared nav model", () => {
    expect(palette()).toContain("<span>Go to Projects</span>");
    const flags = { meetingIntake: false, routingInbox: false };
    expect(navCommands(flags, true).map((c) => c.key)).toEqual([...navCommands(flags).map((c) => c.key), "nav:projects"]);
  });

  it("leaves the default shell's palette as it was", () => {
    setNavZonesBuildFlag(false);
    visit("screen:goals");
    __resetStarsForTests(["screen:goals"]);
    const html = palette({ screen: "home" });
    expect(groups(html)[0].title).toBe("Create");
    expect(html).not.toContain(">Recent<");
    expect(html).not.toContain(">Starred<");
    expect(html).not.toContain("Go to Projects");
  });
});
