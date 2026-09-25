// The shell's nav forms (ADR-005): below 1025px the sidebar is a drawer — on
// phone opened from More → All screens, on tablet from the 64px icon rail's
// toggle — and ≥1025 it is the labelled sidebar. The open/close state machine
// and Tab wrap are pure (nav-model.ts); the markup is rendered with
// renderToStaticMarkup; the CSS contract is read from src/styles.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";

import { NavScrim, Sidebar } from "@/components/mc/chrome";
import { nextDrawerOpen, wrapFocusIndex, type DrawerEvent } from "@/components/mc/nav-model";
import { Topbar } from "@/components/mc/top-bar";
import { resetStore } from "@/lib/mc-data/store";

beforeEach(() => resetStore());

const DISMISS: DrawerEvent[] = ["close", "escape", "backdrop", "navigate"];

describe("drawer open/close state", () => {
  it("the toggle toggles it", () => {
    expect(nextDrawerOpen(false, "toggle")).toBe(true);
    expect(nextDrawerOpen(true, "toggle")).toBe(false);
  });

  it("every dismiss path closes it — close button, Esc, backdrop tap, nav item click", () => {
    for (const event of DISMISS) expect(nextDrawerOpen(true, event), event).toBe(false);
  });

  it("a dismiss while closed is a no-op (desktop nav clicks never open it)", () => {
    for (const event of DISMISS) expect(nextDrawerOpen(false, event), event).toBe(false);
  });

  it("wraps Tab and Shift+Tab inside an open layer", () => {
    expect(wrapFocusIndex(5, 4, false)).toBe(0); // Tab off the last → first
    expect(wrapFocusIndex(5, 0, true)).toBe(4); // Shift+Tab off the first → last
    expect(wrapFocusIndex(5, -1, false)).toBe(0); // focus outside → first
    expect(wrapFocusIndex(5, 2, false)).toBeNull(); // mid-list: the browser moves it
    expect(wrapFocusIndex(5, 2, true)).toBeNull();
    expect(wrapFocusIndex(0, -1, false)).toBeNull();
  });
});

const topbar = () =>
  renderToStaticMarkup(
    createElement(Topbar, {
      route: { screen: "board" },
      nav: () => {},
      dark: false,
      setDark: () => {},
      onOpenPalette: () => {},
    })
  );

const sidebar = (drawerOpen: boolean) =>
  renderToStaticMarkup(
    createElement(Sidebar, {
      route: { screen: "home" },
      nav: () => {},
      counts: {},
      onNewProject: () => {},
      onNewInitiative: () => {},
      drawerOpen,
      onDrawer: () => {},
    })
  );

describe("shell markup", () => {
  it("puts the drawer toggle on the rail, labelled and controlling the nav", () => {
    const closed = sidebar(false);
    expect(closed).toMatch(/^<nav class="mc-side" id="mc-nav" aria-label="Main"/);
    expect(closed).toContain(
      'class="iconbtn rail-toggle" aria-label="Open navigation" aria-expanded="false" aria-controls="mc-nav" data-testid="nav-drawer-toggle"'
    );
    expect(sidebar(true)).toMatch(/^<nav class="mc-side open" id="mc-nav"/);
    expect(sidebar(true)).toContain('aria-expanded="true" aria-controls="mc-nav"');
  });

  it("opens the nav as a drawer with a close button and a backdrop", () => {
    expect(sidebar(false)).toContain('class="iconbtn side-close" aria-label="Close navigation"');
    const scrim = (open: boolean) => renderToStaticMarkup(createElement(NavScrim, { open, onDrawer: () => {} }));
    expect(scrim(false)).toBe("");
    expect(scrim(true)).toBe('<div class="mc-scrim" aria-hidden="true" data-testid="nav-drawer-scrim"></div>');
  });

  it("has no hamburger in the top bar any more", () => {
    expect(topbar()).not.toContain("hamburger");
    expect(topbar()).not.toContain("nav-drawer-toggle");
  });

  it("marks the ⌘K shortcut as a keyboard hint (hidden on touch devices)", () => {
    expect(topbar()).toContain('<span class="key kbd-hint">⌘K</span>');
  });

  it("shows the workspace as a static label — no chevron, no control", () => {
    const html = topbar();
    const ws = html.slice(html.indexOf('<span class="ws"'), html.indexOf('<span class="title"'));
    expect(ws).toContain("PLX Engineering");
    expect(ws).not.toMatch(/▾|<button|chev/);
  });

  it("gives the phone an accessible search control and a screen title that is not a heading", () => {
    const html = topbar();
    expect(html).toContain('aria-label="Search, jump or create"');
    expect(html).toContain('<span class="title">Board</span>');
    expect(html).not.toContain("<h1");
  });

  it("makes the sync pill a real link to the sync console", () => {
    expect(topbar()).toMatch(/<a href="\/\?screen=sync" class="topsync pending"[^>]*data-testid="nav-sync-console"/);
  });

  it("never claims Synced before the server answers", () => {
    expect(topbar()).toContain("Checking…");
    expect(topbar()).not.toContain("Synced");
  });
});

describe("shell CSS contract (ADR-005)", () => {
  const styles = join(import.meta.dirname, "..", "src/styles");
  const shell = readFileSync(join(styles, "mc-shell.css"), "utf8");
  // Width *media* queries only — container queries (@container) are the sanctioned
  // tool for everything that answers to a width inside the shell.
  const widthQueries = (css: string) =>
    [...css.matchAll(/@media[^{]*/g)].flatMap((media) =>
      [...media[0].matchAll(/\((max|min)-width:\s*(\d+)px\)/g)].map((m) => `${m[1]}-${m[2]}`)
    );

  it("declares the MC cascade-layer order first", () => {
    const firstRule = shell.replace(/\/\*[\s\S]*?\*\//g, "").trim();
    expect(firstRule.startsWith("@layer mc.tokens, mc.legacy, mc.shell, mc.screens, mc.state;")).toBe(true);
  });

  it("authors mobile-first: width tiers are min-width 641 / 1025 / 1600 / 2200 only", () => {
    const widths = widthQueries(shell);
    expect(widths.length).toBeGreaterThan(0);
    expect(new Set(widths)).toEqual(new Set(["min-641", "min-1025", "min-1600", "min-2200"]));
  });

  it("keeps the new wide tiers out of every other MC stylesheet", () => {
    for (const file of readdirSync(styles).filter((f) => f.endsWith(".css") && f !== "mc-shell.css")) {
      const widths = widthQueries(readFileSync(join(styles, file), "utf8"));
      expect(widths.filter((w) => w.startsWith("min-")), file).toEqual([]);
    }
    expect(widthQueries(readFileSync(join(styles, "mc-surface.css"), "utf8"))).toEqual([]);
  });

  it("uses tokens only — no raw colour", () => {
    const code = shell.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(code).not.toMatch(/\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\s*\(/);
  });

  it("drives drawers and sheets from the brand drawer/scrim tokens and locks body scroll", () => {
    expect(shell).toContain("z-index: var(--p-z-drawer)");
    expect(shell).toContain("z-index: var(--p-z-scrim)");
    expect(shell).toContain("background: var(--p-scrim)");
    expect(shell).toContain("width: var(--p-drawer-w)");
    expect(shell).toMatch(/body\.mc-lock\s*\{\s*overflow: hidden;/);
  });

  it("gives toast dismiss and shell buttons 44px targets where touch applies", () => {
    expect(shell).toMatch(/\.mc \.mc-notices \.mc-notice \.x::after \{[^}]*width: var\(--p-touch\);[^}]*height: var\(--p-touch\);/);
    expect(shell).toMatch(/@media \(pointer: coarse\) \{[^@]*\.mc \.mc-offline \.btn,[^{]*\.mc \.mc-pane \.pane-head \.btn[^{]*\{[^}]*min-height: var\(--p-touch\);/);
  });

  it("animates only when motion is welcome, and hides the ⌘K hint on touch", () => {
    expect(shell).toMatch(/@media \(prefers-reduced-motion: no-preference\)\s*\{[^}]*\.mc \.mc-side \{[^}]*transition:/);
    expect(shell).toMatch(/@media \(hover: none\), \(pointer: coarse\)\s*\{[^}]*\.mc \.kbd-hint \{\s*display: none;/);
  });
});
