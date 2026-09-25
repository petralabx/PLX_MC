// Wave 6 — colleague UX: the sidebar is grouped by task (My work · Plan ·
// Knowledge · Admin & health), not by system internals, and it is driven by ONE
// declarative model that the sidebar, the ⌘K palette and these tests share.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { CommandPalette } from "@/components/mc/command-palette";
import {
  NAV_GROUPS,
  createNavGroupState,
  isPlainLeftClick,
  navCommands,
  navGroupOf,
  navHref,
  visibleNavGroups,
  type NavFlags,
} from "@/components/mc/nav-model";
import { SCREEN_VALUES, type Screen } from "@/components/mc/route";
import { resetRoutingInboxFlag, setRoutingInboxEnabled } from "@/components/mc/routing-inbox/flag";

afterEach(() => resetRoutingInboxFlag());

const OFF: NavFlags = { meetingIntake: false, routingInbox: false };
const ON: NavFlags = { meetingIntake: true, routingInbox: true };

const screensOf = (flags: NavFlags, id: string): Screen[] =>
  visibleNavGroups(flags)
    .find((g) => g.id === id)!
    .items.map((i) => i.screen);

describe("nav model — grouped by task", () => {
  it("has four groups in reading order", () => {
    expect(NAV_GROUPS.map((g) => g.label)).toEqual(["My work", "Plan", "Knowledge", "Admin & health"]);
  });

  it("puts personal work first: Home, My tasks, Approvals", () => {
    expect(screensOf(OFF, "my-work")).toEqual(["home", "mine", "approvals"]);
    const home = NAV_GROUPS[0].items[0];
    expect(home.label).toBe("Home");
    expect(home.badge).toBe("needs");
    expect(NAV_GROUPS[0].items[2].badge).toBe("approvals");
  });

  it("plans with the four views plus the live project and initiative lists", () => {
    expect(screensOf(OFF, "plan")).toEqual(["board", "list", "timeline", "insights"]);
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

  it("keeps system internals in a collapsible Admin & health group; flagged screens only when on", () => {
    const admin = NAV_GROUPS.find((g) => g.id === "admin")!;
    expect(admin.collapsible).toBe(true);
    expect(NAV_GROUPS.filter((g) => g.collapsible).map((g) => g.id)).toEqual(["admin"]);
    expect(screensOf(OFF, "admin")).toEqual(["repos", "files", "sync", "loop-ledgers", "activity", "ai-spend", "matrix", "feed"]);
    expect(screensOf(ON, "admin")).toEqual([
      "repos",
      "files",
      "sync",
      "loop-ledgers",
      "activity",
      "ai-spend",
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
    // Detail screens are reached from their lists/rows, never as a bare nav item.
    expect(unlisted.sort()).toEqual(["bucket", "project", "task"]);
  });

  it("knows which group a screen belongs to (to auto-expand Admin & health)", () => {
    expect(navGroupOf("repos")).toBe("admin");
    expect(navGroupOf("routing-inbox")).toBe("admin");
    expect(navGroupOf("help")).toBe("knowledge");
    expect(navGroupOf("home")).toBe("my-work");
    expect(navGroupOf("task")).toBeNull();
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
