// The zoned sidebar's width and rail from 1025px (TASK-3957; portal ADR-011 v2,
// Width; MC ADR-006): the stored values and their limits, what a key or a drag
// on the splitter does, the boot script that paints the person's choice onto
// <html> before the first paint, paintSide, and the controls in the markup (the
// splitter, the rail's expand button, the rail's Projects flyout, the top bar's
// collapse button). No DOM environment (vitest runs in Node): the boot script
// and paintSide run against a stand-in <html>; markup comes from
// renderToStaticMarkup, which reads the prefs' server values (the defaults).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Sidebar } from "@/components/mc/chrome";
import { setNavZonesBuildFlag } from "@/components/mc/nav-zones";
import {
  SIDE_BOOT_SCRIPT,
  SIDE_DEFAULT,
  SIDE_MAX,
  SIDE_MIN,
  SIDE_SNAP,
  clampSideWidth,
  decodeSideWidth,
} from "@/components/mc/side-boot";
import { dragSideWidth, paintSide, sideKeyAction } from "@/components/mc/side-width";
import { Topbar } from "@/components/mc/top-bar";

// A stand-in <html>: its style properties and attributes.
function fakeRoot() {
  const style = new Map<string, string>();
  const attrs = new Map<string, string>();
  return {
    style: {
      setProperty: (name: string, value: string) => style.set(name, value),
      removeProperty: (name: string) => style.delete(name),
    },
    setAttribute: (name: string, value: string) => attrs.set(name, value),
    removeAttribute: (name: string) => attrs.delete(name),
    styles: style,
    attrs,
  };
}

// Runs the boot script with this storage and <html>, as <head> would.
function boot(stored: Record<string, string>, root = fakeRoot(), throws = false) {
  const storage = {
    getItem: (key: string) => {
      if (throws) throw new Error("SecurityError");
      return stored[key] ?? null;
    },
  };
  new Function("window", "document", SIDE_BOOT_SCRIPT)({ localStorage: storage }, { documentElement: root });
  return root;
}

describe("the sidebar's widths", () => {
  it("are 232 to 400px, 248px by default, collapsing below 160px (portal ADR-011 v2, revised by TASK-4010)", () => {
    expect([SIDE_MIN, SIDE_DEFAULT, SIDE_MAX, SIDE_SNAP]).toEqual([232, 248, 400, 160]);
  });

  it("keeps a stored width only when it is a whole number in range", () => {
    expect(["232", "320", "400"].map(decodeSideWidth)).toEqual([232, 320, 400]);
    for (const raw of [null, "", " ", "231", "401", "300.5", "abc", "1e9"]) expect(decodeSideWidth(raw), String(raw)).toBeNull();
  });

  it("clamps and rounds a width to the range", () => {
    expect([100, 231.4, 300.6, 999].map(clampSideWidth)).toEqual([232, 232, 301, 400]);
  });
});

describe("the splitter's keys", () => {
  it("moves 16px with ← and →, 64px with Shift, never past the range", () => {
    expect(sideKeyAction(300, "ArrowRight", false)).toEqual({ width: 316 });
    expect(sideKeyAction(300, "ArrowLeft", false)).toEqual({ width: 284 });
    expect(sideKeyAction(300, "ArrowRight", true)).toEqual({ width: 364 });
    expect(sideKeyAction(300, "ArrowLeft", true)).toEqual({ width: 236 });
    expect(sideKeyAction(390, "ArrowRight", true)).toEqual({ width: 400 });
    expect(sideKeyAction(240, "ArrowLeft", false)).toEqual({ width: 232 });
  });

  it("goes to the ends with Home and End, collapses with Enter, and ignores other keys", () => {
    expect(sideKeyAction(300, "Home", false)).toEqual({ width: 232 });
    expect(sideKeyAction(300, "End", false)).toEqual({ width: 400 });
    expect(sideKeyAction(300, "Enter", false)).toEqual({ rail: true });
    for (const key of ["ArrowUp", "ArrowDown", " ", "Escape", "a"]) expect(sideKeyAction(300, key, false), key).toBeNull();
  });
});

describe("a drag on the splitter", () => {
  it("follows the pointer within the range", () => {
    expect(dragSideWidth(248, 72)).toEqual({ width: 320, collapse: false });
    expect(dragSideWidth(248, 400)).toEqual({ width: 400, collapse: false });
  });

  it("stops at 232px until the pointer passes 160px, and collapses past it", () => {
    expect(dragSideWidth(248, -48)).toEqual({ width: 232, collapse: false });
    expect(dragSideWidth(248, -88)).toEqual({ width: 232, collapse: false });
    expect(dragSideWidth(248, -89)).toEqual({ width: 232, collapse: true });
  });
});

describe("the boot script (before the first paint)", () => {
  it("paints a stored width and the rail onto <html>", () => {
    const root = boot({ "mc.side.w": "320", "mc.side.rail": "1" });
    expect([...root.styles]).toEqual([["--mc-side-w", "320px"]]);
    expect([...root.attrs]).toEqual([["data-mc-side", "rail"]]);
  });

  it("leaves the defaults for nothing stored, a width out of range, or a rail that is not on", () => {
    const cases: Record<string, string>[] = [{}, { "mc.side.w": "999" }, { "mc.side.w": "200" }, { "mc.side.w": "x", "mc.side.rail": "0" }];
    for (const stored of cases) {
      const root = boot(stored);
      expect([...root.styles, ...root.attrs], JSON.stringify(stored)).toEqual([]);
    }
  });

  it("does nothing, and throws nothing, when storage is blocked", () => {
    const root = boot({}, fakeRoot(), true);
    expect([...root.styles, ...root.attrs]).toEqual([]);
  });
});

describe("paintSide", () => {
  const real = globalThis.document;
  afterEach(() => {
    (globalThis as { document?: unknown }).document = real;
  });

  it("copies a width and the rail onto <html>, and clears them for the defaults", () => {
    const root = fakeRoot();
    (globalThis as { document?: unknown }).document = { documentElement: root };
    paintSide(352, true);
    expect([...root.styles, ...root.attrs]).toEqual([
      ["--mc-side-w", "352px"],
      ["data-mc-side", "rail"],
    ]);
    paintSide(null, false);
    expect([...root.styles, ...root.attrs]).toEqual([]);
  });
});

describe("the controls in the zoned shell", () => {
  beforeEach(() => setNavZonesBuildFlag(true));
  afterEach(() => setNavZonesBuildFlag(false));

  const sidebar = () =>
    renderToStaticMarkup(
      createElement(Sidebar, { route: { screen: "home" }, nav: () => {}, counts: {}, onNewProject: () => {}, onNewInitiative: () => {} })
    );
  const topbar = () =>
    renderToStaticMarkup(
      createElement(Topbar, { route: { screen: "home" }, nav: () => {}, dark: false, setDark: () => {}, onOpenPalette: () => {} })
    );

  it("gives the sidebar a focusable window splitter, after the nav", () => {
    const html = sidebar();
    expect(html).toContain(
      '<div class="side-resize" role="separator" tabindex="0" aria-orientation="vertical" aria-label="Resize sidebar" aria-controls="mc-nav" aria-valuemin="232" aria-valuemax="400" aria-valuenow="248" aria-valuetext="248 pixels"'
    );
    expect(html.indexOf('class="side-resize"')).toBeGreaterThan(html.indexOf("</nav>"));
  });

  it("puts an expand button in the splitter's place, for the rail", () => {
    expect(sidebar()).toContain(
      '<button type="button" class="side-expand" aria-label="Expand sidebar" aria-controls="mc-nav" aria-expanded="true" title="Expand sidebar ([)">'
    );
  });

  it("gives the rail a Projects button that opens a flyout with every active project and the filter", () => {
    const html = sidebar();
    expect(html).toMatch(
      /<button type="button" class="item rail-fly" data-tree-key="rail:projects" tabindex="-1" title="Projects" popoverTarget="mc-nav-projects-flyout" aria-controls="mc-nav-projects-flyout" aria-expanded="false">/
    );
    const fly = html.slice(html.indexOf('id="mc-nav-projects-flyout"'));
    expect(fly).toMatch(/^id="mc-nav-projects-flyout" popover="auto" class="mc-flyout projects-fly" role="group" aria-label="Projects"/);
    expect(fly).toContain('aria-label="Filter projects and initiatives"');
    expect(fly).toContain('href="/?screen=project&amp;projectId=PRJ-PORTAL-GOLIVE"');
  });

  it("gives the top bar a collapse button left of the logo", () => {
    const html = topbar();
    // next/image puts a preload <link> ahead of the header.
    expect(html.slice(html.indexOf("<header"))).toMatch(
      /^<header class="mc-top"><button type="button" class="iconbtn side-toggle" aria-label="Collapse sidebar" aria-expanded="true" aria-controls="mc-nav" title="Collapse sidebar \(\[\)">/
    );
  });

  it("has none of them in the default shell", () => {
    setNavZonesBuildFlag(false);
    for (const html of [sidebar(), topbar()]) {
      for (const cls of ["side-resize", "side-expand", "rail-fly", "projects-fly", "side-toggle"]) expect(html, cls).not.toContain(cls);
    }
  });
});
