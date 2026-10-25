// TASK-3843: the zoned shell's phone chrome. The tabs are Home, My tasks,
// Projects, Search and More; the strip under the top bar shows a tab's
// screens; the More sheet holds Reporting, Knowledge, Admin & health and Help.
// With the flag off, the classic tabs stay. No DOM environment (vitest runs in
// Node): rendered with renderToStaticMarkup.
import { createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { BottomTabs, GroupStrip, NewTaskFab } from "@/components/mc/bottom-tabs";
import { MoreSheet } from "@/components/mc/more-sheet";
import { setNavZonesBuildFlag } from "@/components/mc/nav-zones";
import type { Route } from "@/components/mc/route";
import { resetStore } from "@/lib/mc-data/store";

const FLAGS = { meetingIntake: false, routingInbox: false };

const tabs = (route: Route, searchOpen = false) =>
  renderToStaticMarkup(
    createElement(BottomTabs, {
      route,
      nav: () => {},
      counts: {},
      moreOpen: false,
      onMore: () => {},
      moreRef: createRef<HTMLButtonElement>(),
      searchOpen,
      onSearch: () => {},
    })
  );
const strip = (route: Route) => renderToStaticMarkup(createElement(GroupStrip, { route, nav: () => {}, flags: FLAGS }));
const fab = (route: Route) => renderToStaticMarkup(createElement(NewTaskFab, { route, onNewTask: () => {} }));
const sheet = (route: Route) =>
  renderToStaticMarkup(
    createElement(MoreSheet, {
      open: true,
      onClose: () => {},
      onAllScreens: () => {},
      route,
      nav: () => {},
      flags: FLAGS,
      counts: {},
      dark: false,
      setDark: () => {},
    })
  );

/** Each tab's [label, kind, current]: a link (with its href) or a button. */
function tabRow(html: string): [string, string, boolean][] {
  return Array.from(
    html.matchAll(/<(a|button)([^>]*)>(?:(?!<\/(?:a|button)>)[\s\S])*?<span class="lb">([^<]+)<\/span>/g),
    (m) => [m[3], m[1] === "a" ? (m[2].match(/href="([^"]+)"/)?.[1] ?? "?") : "button", /aria-current="page"/.test(m[2])]
  );
}

beforeEach(() => resetStore());
afterEach(() => setNavZonesBuildFlag(false));

describe("zoned phone tabs", () => {
  it("are Home, My tasks, Projects, Search and More, and the page's tab is current", () => {
    setNavZonesBuildFlag(true);
    expect(tabRow(tabs({ screen: "timeline" }))).toEqual([
      ["Home", "/", false],
      ["My tasks", "/?screen=mine", false],
      ["Projects", "/?screen=projects", true],
      ["Search", "button", false],
      ["More", "button", false],
    ]);
    expect(tabRow(tabs({ screen: "approvals" }))[0]).toEqual(["Home", "/", true]);
    // With ⌘K open, Search is the open tab and the page's tab steps back, as for More.
    const open = tabs({ screen: "timeline" }, true);
    expect(open).toContain('<button type="button" class="on" aria-haspopup="dialog" aria-expanded="true">');
    expect(tabRow(open).filter(([, , current]) => current)).toEqual([]);
  });

  it("show Home and Approvals under Home, and All work and Projects under Projects", () => {
    setNavZonesBuildFlag(true);
    expect(strip({ screen: "approvals" })).toMatch(/^<nav class="mc-subnav" aria-label="Home screens">/);
    // Lit on List, All work stays on List.
    expect(strip({ screen: "list" })).toContain('<a href="/?screen=list" aria-current="page">All work</a>');
    expect(strip({ screen: "projects" })).toContain('<a href="/?screen=board">All work</a>');
    expect(strip({ screen: "list" })).toContain('<a href="/?screen=projects">Projects</a>');
    expect(strip({ screen: "mine" })).toBe("");
    expect(strip({ screen: "dashboard" })).toBe("");
  });

  it("keep New task on Home, My tasks and Projects, never on More's screens or over a task", () => {
    setNavZonesBuildFlag(true);
    for (const screen of ["home", "mine", "board", "projects"] as const) expect(fab({ screen })).toContain("mc-fab");
    expect(fab({ screen: "dashboard" })).toBe("");
    expect(fab({ screen: "task", taskId: "TASK-1" })).toBe("");
  });

  it("put Reporting, Knowledge, Admin & health's three sections and Help in More", () => {
    setNavZonesBuildFlag(true);
    const html = sheet({ screen: "brain-ask" });
    const groups = Array.from(html.matchAll(/<div class="grp-h" id="[^"]+">([^<]+)<\/div>/g), (m) => m[1]);
    expect(groups).toEqual(["Reporting", "Knowledge", "Operations", "Sync and data", "Engineering", "Help"]);
    expect(html).toContain('href="/?screen=brain-ask" aria-current="page"');
    for (const screen of ["feed", "sync", "repos", "help"]) expect(html).toContain(`href="/?screen=${screen}"`);
    expect(html).toContain("All screens, projects and initiatives");
  });

  it("stay the classic tabs and sheet with the flag off", () => {
    expect(tabRow(tabs({ screen: "board" })).map(([label]) => label)).toEqual(["My work", "Plan", "Knowledge", "More"]);
    const groups = Array.from(sheet({ screen: "home" }).matchAll(/<div class="grp-h" id="[^"]+">([^<]+)<\/div>/g), (m) => m[1]);
    expect(groups).toEqual(["Reporting", "Admin &amp; health"]);
  });
});
