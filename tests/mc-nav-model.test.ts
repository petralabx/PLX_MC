// Wave 6 — colleague UX: the sidebar is grouped by task (My work · Plan ·
// Knowledge · Reporting · Admin & health), not by system internals, and it is driven by ONE
// declarative model that the sidebar, the ⌘K palette and these tests share.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { CommandPalette } from "@/components/mc/command-palette";
import {
  ADMIN_FLYOUT,
  ALL_WORK_NAV_ITEM,
  GROUP_TAB,
  HELP_NAV_ITEM,
  NAV_GROUPS,
  NAV_TABS,
  PANE_SCREENS,
  PROJECTS_NAV_ITEM,
  ZONED_NAV_GROUPS,
  ZONED_NAV_TABS,
  createNavGroupState,
  createTabMemory,
  createZonedTabMemory,
  filterProjectTree,
  isNavItemCurrent,
  isPaneScreen,
  navItemTarget,
  isPlainLeftClick,
  isScreen,
  navCommands,
  navGroupOf,
  navHref,
  openTaskCounts,
  projectTree,
  revealScrollTop,
  screenTitle,
  tabOf,
  tabScreens,
  treeKeyAction,
  visibleAdminFlyout,
  visibleNavGroups,
  visibleZonedNavGroups,
  zonedNavPlaceOf,
  zonedTabOf,
  zonedTabScreens,
  type NavFlags,
  type TreeRow,
} from "@/components/mc/nav-model";
import { SCREEN_VALUES, type Screen } from "@/components/mc/route";
import type { Bucket, Project, Task } from "@/lib/mc-data";
import { resetRoutingInboxFlag, setRoutingInboxEnabled } from "@/components/mc/routing-inbox/flag";

afterEach(() => resetRoutingInboxFlag());

const OFF: NavFlags = { meetingIntake: false, routingInbox: false };
const ON: NavFlags = { meetingIntake: true, routingInbox: true };

const screensOf = (flags: NavFlags, id: string): Screen[] =>
  visibleNavGroups(flags)
    .find((g) => g.id === id)!
    .items.map((i) => i.screen);

describe("nav model — grouped by task", () => {
  it("has five groups in reading order", () => {
    expect(NAV_GROUPS.map((g) => g.label)).toEqual(["My work", "Plan", "Knowledge", "Reporting", "Admin & health"]);
  });

  it("puts personal work first: Home, Dashboard, My tasks, Approvals", () => {
    expect(screensOf(OFF, "my-work")).toEqual(["home", "dashboard", "mine", "approvals"]);
    const [home, dashboard] = NAV_GROUPS[0].items;
    expect(home.label).toBe("Home");
    expect(home.badge).toBe("needs");
    // The Dashboard sits directly under Home (TASK-2565).
    expect(dashboard.label).toBe("Dashboard");
    expect(NAV_GROUPS[0].items.find((i) => i.screen === "approvals")!.badge).toBe("approvals");
  });

  it("plans with the four views plus the live project and initiative lists", () => {
    expect(screensOf(OFF, "plan")).toEqual(["board", "list", "timeline", "insights", "drafts"]);
    expect(NAV_GROUPS.find((g) => g.id === "plan")!.lists).toEqual(["projects", "initiatives"]);
  });

  it("gathers reference material under Knowledge, ending with Help", () => {
    expect(screensOf(OFF, "knowledge")).toEqual([
      "brain-ask",
      "governance-sops",
      "skills-directory",
      "architecture",
      "help",
    ]);
  });

  it("puts Goals & production under Reporting (TASK-2896)", () => {
    expect(screensOf(OFF, "reporting")).toEqual(["goals"]);
    expect(screenTitle("goals")).toBe("Goals & production");
    expect(navCommands(OFF).map((c) => c.label)).toEqual(
      expect.arrayContaining(["Go to Goals & production", "Go to Production goals", "Go to Revenue goal"])
    );
  });

  it("keeps system internals in a collapsible Admin & health group; flagged screens only when on", () => {
    const admin = NAV_GROUPS.find((g) => g.id === "admin")!;
    expect(admin.collapsible).toBe(true);
    expect(NAV_GROUPS.filter((g) => g.collapsible).map((g) => g.id)).toEqual(["admin"]);
    expect(screensOf(OFF, "admin")).toEqual([
      "repos",
      "files",
      "sync",
      "loop-ledgers",
      "activity",
      "ai-spend",
      "ci-scorecard",
      "uat-scorecard",
      "matrix",
      "feed",
    ]);
    expect(screensOf(ON, "admin")).toEqual([
      "repos",
      "files",
      "sync",
      "loop-ledgers",
      "activity",
      "ai-spend",
      "ci-scorecard",
      "uat-scorecard",
      "matrix",
      "feed",
      "intake",
      "routing-inbox",
    ]);
  });

  it("speaks the colleague's language — no jargon labels", () => {
    const labels = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.label));
    expect(labels).toContain("SharePoint sync issues");
    for (const label of labels) {
      expect(label).not.toMatch(/bucket|sync \/ conflicts|system of record/i);
    }
  });

  it("lists every screen at most once, and orphans only the detail screens", () => {
    const listed = visibleNavGroups(ON).flatMap((g) => g.items.map((i) => i.screen));
    expect(new Set(listed).size).toBe(listed.length);
    const unlisted = SCREEN_VALUES.filter((s) => !listed.includes(s));
    // Detail screens are reached from their lists/rows, never as a bare nav
    // item; the Projects page is the zoned sidebar's (TASK-3841).
    expect(unlisted.sort()).toEqual(["bucket", "project", "projects", "task"]);
  });

  it("knows which group a screen belongs to (to auto-expand Admin & health)", () => {
    expect(navGroupOf("repos")).toBe("admin");
    expect(navGroupOf("routing-inbox")).toBe("admin");
    expect(navGroupOf("help")).toBe("knowledge");
    expect(navGroupOf("goals")).toBe("reporting");
    expect(navGroupOf("home")).toBe("my-work");
    expect(navGroupOf("task")).toBeNull();
  });
});

// TASK-3840 — the zoned sidebar (behind the nav-zones flag, portal ADR-011):
// personal work first, then Plan, Reporting and Knowledge, with system tools in
// the footer's Admin & health flyout. Same items as above, only placed anew.
describe("zoned sidebar model", () => {
  const zonedScreensOf = (flags: NavFlags, id: string): Screen[] =>
    visibleZonedNavGroups(flags)
      .find((g) => g.id === id)!
      .items.map((i) => i.screen);
  const flyoutOf = (flags: NavFlags) =>
    visibleAdminFlyout(flags).map((section) => [section.label, section.items.map((i) => i.screen)]);

  it("reads My work, Plan, Reporting, then a collapsible Knowledge", () => {
    expect(ZONED_NAV_GROUPS.map((g) => g.label)).toEqual(["My work", "Plan", "Reporting", "Knowledge"]);
    expect(zonedScreensOf(OFF, "my-work")).toEqual(["home", "mine", "approvals"]);
    // Board, List and Timeline share the All work row (TASK-3843).
    expect(zonedScreensOf(OFF, "plan")).toEqual(["board", "projects", "drafts"]);
    expect(ZONED_NAV_GROUPS.find((g) => g.id === "plan")!.items[0]).toBe(ALL_WORK_NAV_ITEM);
    expect(ZONED_NAV_GROUPS.find((g) => g.id === "plan")!.lists).toEqual(["project-tree"]);
    expect(zonedScreensOf(OFF, "reporting")).toEqual(["dashboard", "insights", "goals", "ai-spend", "ci-scorecard", "uat-scorecard"]);
    expect(zonedScreensOf(OFF, "knowledge")).toEqual(["brain-ask", "governance-sops", "skills-directory", "architecture"]);
    expect(ZONED_NAV_GROUPS.filter((g) => g.collapsible).map((g) => g.id)).toEqual(["knowledge"]);
  });

  it("puts system tools in the Admin & health flyout; flagged screens only when on", () => {
    expect(flyoutOf(OFF)).toEqual([
      ["Operations", ["feed"]],
      ["Sync and data", ["sync", "files", "loop-ledgers"]],
      ["Engineering", ["repos", "activity", "matrix"]],
    ]);
    expect(flyoutOf(ON)[0]).toEqual(["Operations", ["feed", "intake", "routing-inbox"]]);
    for (const flags of [OFF, ON, { ...OFF, meetingIntake: true }, { ...OFF, routingInbox: true }]) {
      for (const section of visibleAdminFlyout(flags)) expect(section.items.length).toBeGreaterThan(0);
    }
    expect(HELP_NAV_ITEM.screen).toBe("help");
  });

  it("places every sidebar screen exactly once: in a zone, the flyout, or the footer's Help", () => {
    const placed = [
      ...visibleZonedNavGroups(ON).flatMap((g) => g.items.flatMap((i) => [i.screen, ...(i.also ?? [])])),
      ...visibleAdminFlyout(ON).flatMap((section) => section.items.map((i) => i.screen)),
      HELP_NAV_ITEM.screen,
    ];
    expect(new Set(placed).size).toBe(placed.length);
    // Every classic screen, plus the Projects page (TASK-3841).
    const classic = visibleNavGroups(ON).flatMap((g) => g.items.map((i) => i.screen));
    expect([...placed].sort()).toEqual([...classic, "projects"].sort());
  });

  it("reuses the classic items: same URL, icon, badge and flag; only two labels change", () => {
    const classic = new Map(NAV_GROUPS.flatMap((g) => g.items).map((i) => [i.screen, i]));
    const zoned = [...ZONED_NAV_GROUPS.flatMap((g) => g.items), ...ADMIN_FLYOUT.flatMap((s) => s.items), HELP_NAV_ITEM];
    expect(zoned.filter((item) => !classic.has(item.screen))).toEqual([PROJECTS_NAV_ITEM]);
    // All work is Board's item, renamed, standing for List and Timeline too (TASK-3843).
    expect(ALL_WORK_NAV_ITEM).toEqual({
      ...classic.get("board"),
      label: "All work",
      hint: "board, list and timeline",
      also: ["list", "timeline"],
    });
    const renamed: Record<string, string> = {};
    for (const item of zoned.filter((i) => classic.has(i.screen) && i !== ALL_WORK_NAV_ITEM)) {
      const { label, ...rest } = classic.get(item.screen)!;
      const { label: zonedLabel, ...zonedRest } = item;
      expect(zonedRest, item.screen).toEqual(rest);
      if (zonedLabel !== label) renamed[item.screen] = zonedLabel;
    }
    expect(renamed).toEqual({ sync: "SharePoint sync", help: "Help and shortcuts" });
    for (const { label } of zoned) expect(label).not.toMatch(/bucket|sync \/ conflicts|system of record/i);
  });

  it("knows where a screen sits (to expand Knowledge and light the flyout's toggle)", () => {
    expect(zonedNavPlaceOf("home")).toBe("my-work");
    expect(zonedNavPlaceOf("dashboard")).toBe("reporting");
    expect(zonedNavPlaceOf("skills-directory")).toBe("knowledge");
    expect(zonedNavPlaceOf("repos")).toBe("admin");
    expect(zonedNavPlaceOf("routing-inbox")).toBe("admin");
    expect(zonedNavPlaceOf("help")).toBe("help");
    expect(zonedNavPlaceOf("task")).toBeNull();
  });

  it("leaves the classic phone tabs and the palette on the classic groups", () => {
    expect(tabScreens("plan", OFF).map((i) => i.screen)).toEqual(["board", "list", "timeline", "insights", "drafts"]);
    expect(tabOf("dashboard")).toBe("my-work");
    expect(navCommands(OFF).map((c) => c.label)).toContain("Go to SharePoint sync issues");
  });
});

// TASK-3843 — the zoned shell's phone tabs, strip and tab memory.
describe("zoned phone tabs", () => {
  it("reads Home, My tasks, Projects, Search and More; Search and More open a dialog, not a screen", () => {
    expect(ZONED_NAV_TABS.map((t) => t.label)).toEqual(["Home", "My tasks", "Projects", "Search", "More"]);
    expect(ZONED_NAV_TABS.filter((t) => t.home).map((t) => t.home)).toEqual(["home", "mine", "projects"]);
    expect(ZONED_NAV_TABS.filter((t) => t.badge).map((t) => [t.id, t.badge])).toEqual([
      ["home", "needs"],
      ["more", "sync"],
    ]);
  });

  it("puts every screen under one tab: Approvals with Home, Plan and its detail screens with Projects", () => {
    const byTab: Record<string, Screen[]> = {};
    for (const screen of SCREEN_VALUES) (byTab[zonedTabOf(screen)] ??= []).push(screen);
    expect(byTab.home).toEqual(["home", "approvals"]);
    expect(byTab.mine).toEqual(["mine"]);
    expect([...byTab.projects].sort()).toEqual(["board", "bucket", "drafts", "list", "project", "projects", "task", "timeline"]);
    expect(byTab.search).toBeUndefined();
    expect(byTab.more).toHaveLength(SCREEN_VALUES.length - 11);
    for (const screen of ["dashboard", "brain-ask", "repos", "sync", "help"] as const) expect(byTab.more).toContain(screen);
  });

  it("lights All work for Board, List and Timeline, in the sidebar and in the strip", () => {
    for (const screen of ["board", "list", "timeline"] as const) {
      expect(isNavItemCurrent(ALL_WORK_NAV_ITEM, screen)).toBe(true);
      expect(zonedNavPlaceOf(screen)).toBe("plan");
    }
    expect(isNavItemCurrent(ALL_WORK_NAV_ITEM, "projects")).toBe(false);
    // Lit, it keeps the view; elsewhere it opens Board.
    expect(navItemTarget(ALL_WORK_NAV_ITEM, "timeline")).toBe("timeline");
    expect(navItemTarget(ALL_WORK_NAV_ITEM, "projects")).toBe("board");
    // The phone title follows the row: All work, zoned; the view's name, classic.
    expect(screenTitle("list", true)).toBe("All work");
    expect(screenTitle("list")).toBe("List");
    expect(screenTitle("dashboard", true)).toBe("Dashboard");
    expect(zonedTabScreens("home", OFF).map((i) => i.screen)).toEqual(["home", "approvals"]);
    expect(zonedTabScreens("projects", OFF).map((i) => i.label)).toEqual(["All work", "Projects", "Drafts"]);
    for (const tab of ["mine", "search", "more"] as const) expect(zonedTabScreens(tab, OFF)).toEqual([]);
  });

  it("remembers each zoned tab's last screen, the Projects page included, never a detail screen", () => {
    const data = new Map<string, string>();
    const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
    const memory = createZonedTabMemory(() => storage);
    memory.remember("timeline");
    expect(memory.last("projects")).toBe("timeline");
    memory.remember("projects");
    memory.remember("task");
    memory.remember("project");
    memory.remember("bucket");
    expect(memory.last("projects")).toBe("projects");
    memory.remember("approvals");
    expect(memory.last("home")).toBe("approvals");
    memory.remember("dashboard");
    expect(memory.last("more")).toBeUndefined();
    // Its own keys: the classic tabs' memory is untouched.
    expect([...data.keys()].sort()).toEqual(["mc.tab.home.last", "mc.tab.projects.last"]);
    expect(createZonedTabMemory(() => storage).last("projects")).toBe("projects");
    expect(createTabMemory(() => storage).last("plan")).toBeUndefined();
  });
});

// TASK-3841, v2 TASK-3955 — the zoned sidebar's Projects tree.
describe("projects tree model", () => {
  const project = (id: string, name: string, extra: Partial<Project> = {}): Project => ({
    id,
    name,
    owner: "greg",
    health: "track",
    target: "—",
    started: "2026.10.01",
    desc: "",
    repos: [],
    sync: { state: "pending", ts: "—", sp: "Projects · unprovisioned" },
    prd: null,
    ...extra,
  });
  const initiative = (id: string, projectId: string | null): Bucket => ({
    id,
    name: id,
    owner: "greg",
    health: "track",
    target: "—",
    started: "2026.10.01",
    desc: "",
    repos: [],
    sync: { state: "pending", ts: "—", sp: "Roadmap · unprovisioned" },
    prd: null,
    project: projectId,
  });
  const names = (tree: ReturnType<typeof projectTree>) => tree.map((n) => n.project.name);
  const task = (bucket: string, extra: Partial<Task>): Task => ({ id: `T-${bucket}`, bucket, stage: "approved", assignee: "greg", coassignees: [], ...extra }) as Task;

  it("nests each initiative under its project, the projects A to Z", () => {
    const projects = [project("P1", "Zeta"), project("P2", "Alpha"), project("P3", "Mine")];
    const tree = projectTree(projects, [initiative("B1", "P1"), initiative("B2", "P2"), initiative("B3", "P1")]);
    expect(names(tree)).toEqual(["Alpha", "Mine", "Zeta"]);
    expect(tree.map((n) => n.initiatives.map((b) => b.id))).toEqual([["B2"], [], ["B1", "B3"]]);
  });

  // The sidebar (portal ADR-011 v2, Lists 1): no cap, no View all.
  it("lists every project A to Z with no viewer, numbers in order", () => {
    const projects = Array.from({ length: 12 }, (_, i) => project(`P${i + 1}`, `Project ${12 - i}`));
    expect(names(projectTree(projects, []))).toEqual(Array.from({ length: 12 }, (_, i) => `Project ${i + 1}`));
  });

  it("filters by project or initiative name, keeping a matched project's initiatives", () => {
    const tree = projectTree(
      [project("P1", "BC Go-Live"), project("P2", "Portal"), project("P3", "Dell disk health")],
      [{ ...initiative("B1", "P1"), name: "BC cutover" }, { ...initiative("B2", "P2"), name: "Portal cutover" }, { ...initiative("B3", "P2"), name: "WMS" }]
    );
    const shown = (query: string) =>
      filterProjectTree(tree, query).map((n) => `${n.project.name}: ${n.initiatives.map((b) => b.name).join(", ")}`);
    expect(shown("  ")).toHaveLength(3);
    expect(shown("PORTAL")).toEqual(["Portal: Portal cutover, WMS"]);
    expect(shown("cutover")).toEqual(["BC Go-Live: BC cutover", "Portal: Portal cutover"]);
    expect(shown("disk")).toEqual(["Dell disk health: "]);
    expect(shown("nothing")).toEqual([]);
  });

  it("counts open tasks per initiative and per project, leaving merged, verified and cancelled out", () => {
    const initiatives = [initiative("B1", "P1"), initiative("B2", "P1"), initiative("B3", null)];
    const tasks = [
      task("B1", { id: "T1", stage: "approved" }),
      task("B1", { id: "T2", stage: "progress" }),
      task("B1", { id: "T3", stage: "merged" }),
      task("B2", { id: "T4", stage: "verified" }),
      task("B2", { id: "T5", stage: "cancelled" }),
      task("B2", { id: "T6", stage: "review" }),
      task("B3", { id: "T7", stage: "approved" }),
    ];
    const { byInitiative, byProject } = openTaskCounts(tasks, initiatives);
    expect(Object.fromEntries(byInitiative)).toEqual({ B1: 2, B2: 1, B3: 1 });
    expect(Object.fromEntries(byProject)).toEqual({ P1: 3 });
  });

});

// TASK-3955 — the zoned sidebar's keyboard tree (portal ADR-011 v2, Keys 5).
describe("treeKeyAction", () => {
  const rows: TreeRow[] = [
    { key: "screen:home", parent: null, open: null, label: "Home" },
    { key: "project:P1", parent: null, open: true, label: "BC Go-Live" },
    { key: "bucket:B1", parent: "project:P1", open: null, label: "BC cutover" },
    { key: "project:P2", parent: null, open: false, label: "Portal" },
    { key: "group:knowledge", parent: null, open: false, label: "Knowledge" },
    { key: "help", parent: null, open: null, label: "Help and shortcuts" },
  ];

  it("moves with the arrows, Home and End, and stops at the ends", () => {
    expect(treeKeyAction(rows, 0, "ArrowDown")).toEqual({ focus: 1 });
    expect(treeKeyAction(rows, 2, "ArrowUp")).toEqual({ focus: 1 });
    expect(treeKeyAction(rows, 0, "ArrowUp")).toBeNull();
    expect(treeKeyAction(rows, 5, "ArrowDown")).toBeNull();
    expect(treeKeyAction(rows, 3, "Home")).toEqual({ focus: 0 });
    expect(treeKeyAction(rows, 1, "End")).toEqual({ focus: 5 });
  });

  it("opens a closed group with →, enters an open one, and closes or climbs with ←", () => {
    expect(treeKeyAction(rows, 3, "ArrowRight")).toEqual({ toggle: 3 });
    expect(treeKeyAction(rows, 1, "ArrowRight")).toEqual({ focus: 2 });
    expect(treeKeyAction(rows, 0, "ArrowRight")).toBeNull();
    expect(treeKeyAction(rows, 1, "ArrowLeft")).toEqual({ toggle: 1 });
    expect(treeKeyAction(rows, 2, "ArrowLeft")).toEqual({ focus: 1 });
    expect(treeKeyAction(rows, 3, "ArrowLeft")).toBeNull();
  });

  it("jumps to the next row starting with a letter, wrapping, in either case", () => {
    expect(treeKeyAction(rows, 0, "b")).toEqual({ focus: 1 });
    expect(treeKeyAction(rows, 1, "b")).toEqual({ focus: 2 });
    expect(treeKeyAction(rows, 2, "B")).toEqual({ focus: 1 });
    expect(treeKeyAction(rows, 5, "h")).toEqual({ focus: 0 });
    expect(treeKeyAction(rows, 0, "z")).toBeNull();
    expect(treeKeyAction(rows, 0, " ")).toBeNull();
    expect(treeKeyAction(rows, 0, "Enter")).toBeNull();
  });
});

describe("nav links are real URLs", () => {
  it("serializes through the route contract", () => {
    expect(navHref({ screen: "home" })).toBe("/");
    expect(navHref({ screen: "board" })).toBe("/?screen=board");
    expect(navHref({ screen: "project", projectId: "PRJ-1" })).toBe("/?screen=project&projectId=PRJ-1");
  });

  it("only a plain primary click is taken over by client-side nav", () => {
    const click = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };
    expect(isPlainLeftClick(click)).toBe(true);
    // New tab / window / download stay with the browser.
    expect(isPlainLeftClick({ ...click, metaKey: true })).toBe(false);
    expect(isPlainLeftClick({ ...click, ctrlKey: true })).toBe(false);
    expect(isPlainLeftClick({ ...click, shiftKey: true })).toBe(false);
    expect(isPlainLeftClick({ ...click, altKey: true })).toBe(false);
    expect(isPlainLeftClick({ ...click, button: 1 })).toBe(false);
  });
});

// TASK-3837: a deep link to a row low in the sidebar scrolls the sidebar so the
// current row shows. Rects are viewport-relative; the sidebar spans 100–700.
describe("revealScrollTop", () => {
  const view = { top: 100, bottom: 700 };

  it("leaves a fully visible row where it is", () => {
    expect(revealScrollTop(view, { top: 400, bottom: 432 }, 50)).toBe(50);
    expect(revealScrollTop(view, { top: 100, bottom: 132 }, 0)).toBe(0);
  });

  it("centres a row below the fold", () => {
    // Row 1000–1032: its centre (1016) moves to the view's centre (400).
    expect(revealScrollTop(view, { top: 1000, bottom: 1032 }, 0)).toBe(616);
  });

  it("centres a row above the view, never past the top", () => {
    expect(revealScrollTop(view, { top: -200, bottom: -168 }, 900)).toBe(316);
    expect(revealScrollTop(view, { top: 60, bottom: 92 }, 10)).toBe(0);
  });
});

describe("⌘K palette commands come from the same model", () => {
  it("offers every visible item as 'Go to …', Approvals included", () => {
    const labels = navCommands(OFF).map((c) => c.label);
    expect(labels).toContain("Go to Home");
    expect(labels).toContain("Go to Approvals");
    expect(labels).toContain("Go to Help");
    expect(labels).not.toContain("Go to Routing inbox");
    expect(navCommands(ON).map((c) => c.label)).toContain("Go to Routing inbox");
  });

  it("keeps search synonyms that land on the sync screen", () => {
    const sync = navCommands(OFF).filter((c) => c.screen === "sync");
    expect(sync.map((c) => c.label)).toEqual([
      "Go to SharePoint sync issues",
      "Go to Conflicts",
      "Go to Review queue",
    ]);
  });

  it("is what the palette renders (Approvals, sync synonyms, Routing inbox when on)", () => {
    const noop = () => {};
    const palette = () =>
      renderToStaticMarkup(
        createElement(CommandPalette, {
          onClose: noop,
          nav: noop,
          onOpenNewTask: noop,
          onOpenNewInitiative: noop,
          onOpenNewProject: noop,
        })
      );
    setRoutingInboxEnabled(false);
    const off = palette();
    for (const label of ["Go to Home", "Go to Approvals", "Go to SharePoint sync issues", "Go to Conflicts", "Go to Help"]) {
      expect(off).toContain(`<span>${label}</span>`);
    }
    expect(off).not.toContain("Go to Routing inbox");
    setRoutingInboxEnabled(true);
    expect(palette()).toContain("<span>Go to Routing inbox</span>");
  });

  it("gives every command a unique key", () => {
    const keys = navCommands(ON).map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("Admin & health expanded state", () => {
  const memoryStorage = () => {
    const data = new Map<string, string>();
    return {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    };
  };

  it("is collapsed by default and remembered across reloads", () => {
    const storage = memoryStorage();
    const first = createNavGroupState(() => storage);
    expect(first.isOpen("admin")).toBe(false);
    first.setOpen("admin", true);
    expect(first.isOpen("admin")).toBe(true);
    // A fresh page load reads the remembered choice.
    expect(createNavGroupState(() => storage).isOpen("admin")).toBe(true);
  });

  it("still expands when storage is unavailable or throws", () => {
    const throwing = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    for (const getStorage of [() => null, () => throwing, () => { throw new Error("denied"); }]) {
      const state = createNavGroupState(getStorage);
      expect(state.isOpen("admin")).toBe(false);
      expect(() => state.setOpen("admin", true)).not.toThrow();
      expect(state.isOpen("admin")).toBe(true);
    }
  });

  it("notifies subscribers so the sidebar re-renders", () => {
    const state = createNavGroupState(() => null);
    let calls = 0;
    const unsubscribe = state.subscribe(() => {
      calls += 1;
    });
    state.setOpen("admin", true);
    unsubscribe();
    state.setOpen("admin", false);
    expect(calls).toBe(1);
  });
});

// ─── ADR-005: every nav surface derives from the same model ──────────────────

describe("phone tabs — one per group, derived from the model", () => {
  it("has My work · Plan · Knowledge · More, and each group maps to exactly one tab", () => {
    expect(NAV_TABS.map((t) => t.label)).toEqual(["My work", "Plan", "Knowledge", "More"]);
    // Reporting has no tab of its own: it sits in the More sheet with Admin & health.
    expect(NAV_GROUPS.map((g) => GROUP_TAB[g.id])).toEqual(["my-work", "plan", "knowledge", "more", "more"]);
    // Tab landing screens are nav items of their own group, never hand-listed elsewhere.
    for (const tab of NAV_TABS.filter((t) => t.home)) expect(tabOf(tab.home!), tab.id).toBe(tab.id);
    expect(NAV_TABS.find((t) => t.id === "more")!.home).toBeUndefined();
  });

  it("puts every screen under a tab: nav items under their group's, detail screens under Plan", () => {
    for (const group of NAV_GROUPS) {
      for (const item of group.items) expect(tabOf(item.screen), item.screen).toBe(GROUP_TAB[group.id]);
    }
    for (const detail of ["task", "bucket", "project"] as const) expect(tabOf(detail)).toBe("plan");
    for (const screen of SCREEN_VALUES) expect(NAV_TABS.map((t) => t.id)).toContain(tabOf(screen));
  });

  it("gives each tab's group strip that group's visible items; More has none", () => {
    expect(tabScreens("plan", OFF).map((i) => i.screen)).toEqual(["board", "list", "timeline", "insights", "drafts"]);
    expect(tabScreens("my-work", OFF).map((i) => i.screen)).toEqual(["home", "dashboard", "mine", "approvals"]);
    expect(tabScreens("more", ON)).toEqual([]);
  });

  it("names the phone title from the nav label, or the detail screen's noun", () => {
    expect(screenTitle("board")).toBe("Board");
    expect(screenTitle("sync")).toBe("SharePoint sync issues");
    expect(screenTitle("task")).toBe("Task");
    expect(screenTitle("bucket")).toBe("Initiative");
    expect(screenTitle("project")).toBe("Project");
  });

  it("gives every nav item a Lucide icon name", () => {
    for (const item of NAV_GROUPS.flatMap((g) => g.items)) expect(item.lucide, item.screen).toMatch(/^[A-Z][A-Za-z0-9]+$/);
  });

  it("validates screen names from storage or URLs", () => {
    expect(isScreen("board")).toBe(true);
    expect(isScreen("not-a-screen")).toBe(false);
    expect(isScreen("")).toBe(false);
  });
});

describe("context pane screens (≥1600)", () => {
  it("are the collections a task is opened from — never the task page itself", () => {
    expect([...PANE_SCREENS]).toEqual(["board", "list", "mine", "approvals"]);
    expect(isPaneScreen("list")).toBe(true);
    expect(isPaneScreen("task")).toBe(false);
    expect(isPaneScreen("home")).toBe(false);
  });
});

describe("tab memory — each tab returns to its last screen", () => {
  const memoryStorage = () => {
    const data = new Map<string, string>();
    return {
      data,
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    };
  };

  it("remembers the last screen per tab, across reloads", () => {
    const storage = memoryStorage();
    const memory = createTabMemory(() => storage);
    expect(memory.last("plan")).toBeUndefined();
    memory.remember("list");
    memory.remember("brain-ask");
    expect(memory.last("plan")).toBe("list");
    expect(memory.last("knowledge")).toBe("brain-ask");
    expect(createTabMemory(() => storage).last("plan")).toBe("list");
  });

  it("never lands a tab on a detail screen, and More is a sheet, not a landing spot", () => {
    const storage = memoryStorage();
    const memory = createTabMemory(() => storage);
    memory.remember("board");
    memory.remember("task");
    memory.remember("project");
    memory.remember("repos");
    expect(memory.last("plan")).toBe("board");
    expect(memory.last("more")).toBeUndefined();
    expect(storage.data.size).toBe(1);
  });

  it("ignores garbage or another tab's screen found in storage", () => {
    const storage = memoryStorage();
    storage.data.set("mc.tab.plan.last", "not-a-screen");
    storage.data.set("mc.tab.knowledge.last", "board");
    storage.data.set("mc.tab.my-work.last", "task");
    const memory = createTabMemory(() => storage);
    expect(memory.last("plan")).toBeUndefined();
    expect(memory.last("knowledge")).toBeUndefined();
    expect(memory.last("my-work")).toBeUndefined();
  });

  it("still remembers for the page when storage is unavailable or throws", () => {
    const throwing = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    for (const getStorage of [() => null, () => throwing, () => { throw new Error("denied"); }]) {
      const memory = createTabMemory(getStorage);
      expect(memory.last("plan")).toBeUndefined();
      expect(() => memory.remember("timeline")).not.toThrow();
      expect(memory.last("plan")).toBe("timeline");
    }
  });

  it("notifies subscribers only when a tab's screen actually changes", () => {
    const memory = createTabMemory(() => null);
    let calls = 0;
    const unsubscribe = memory.subscribe(() => {
      calls += 1;
    });
    memory.remember("list");
    memory.remember("list");
    memory.remember("task");
    unsubscribe();
    memory.remember("board");
    expect(calls).toBe(1);
  });
});
