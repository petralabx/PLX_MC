// Wave 6 — colleague UX: below 1025px the sidebar is a slide-in drawer (the
// RESPONSIVE.md §3 drawer protocol) instead of a horizontal strip that ate
// ~60% of a phone screen. The open/close state machine and the focus protocol
// are pure (nav-model.ts); the markup is rendered with renderToStaticMarkup.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";

import { NavScrim, Sidebar, Topbar } from "@/components/mc/chrome";
import {
  drawerFocusTarget,
  nextDrawerOpen,
  wrapFocusIndex,
  type DrawerEvent,
} from "@/components/mc/nav-model";
import { resetStore } from "@/lib/mc-data/store";

beforeEach(() => resetStore());

const DISMISS: DrawerEvent[] = ["close", "escape", "backdrop", "navigate"];

describe("drawer open/close state", () => {
  it("the hamburger toggles it", () => {
    expect(nextDrawerOpen(false, "toggle")).toBe(true);
    expect(nextDrawerOpen(true, "toggle")).toBe(false);
  });

  it("every dismiss path closes it — close button, Esc, backdrop tap, nav item click", () => {
    for (const event of DISMISS) expect(nextDrawerOpen(true, event), event).toBe(false);
  });

  it("a dismiss while closed is a no-op (desktop nav clicks never open it)", () => {
    for (const event of DISMISS) expect(nextDrawerOpen(false, event), event).toBe(false);
  });
});

describe("drawer focus protocol", () => {
  it("moves focus into the drawer on open and back to the hamburger on close", () => {
    expect(drawerFocusTarget(false, true)).toBe("panel");
    expect(drawerFocusTarget(true, false)).toBe("toggle");
  });

  it("never moves focus when nothing changed (e.g. a desktop sidebar click)", () => {
    expect(drawerFocusTarget(false, false)).toBeNull();
    expect(drawerFocusTarget(true, true)).toBeNull();
  });

  it("wraps Tab and Shift+Tab inside the open drawer", () => {
    expect(wrapFocusIndex(5, 4, false)).toBe(0); // Tab off the last → first
    expect(wrapFocusIndex(5, 0, true)).toBe(4); // Shift+Tab off the first → last
    expect(wrapFocusIndex(5, -1, false)).toBe(0); // focus outside → first
    expect(wrapFocusIndex(5, 2, false)).toBeNull(); // mid-list: the browser moves it
    expect(wrapFocusIndex(5, 2, true)).toBeNull();
    expect(wrapFocusIndex(0, -1, false)).toBeNull();
  });
});

const topbar = (drawerOpen: boolean) =>
  renderToStaticMarkup(
    createElement(Topbar, {
      nav: () => {},
      dark: false,
      setDark: () => {},
      onOpenPalette: () => {},
      drawerOpen,
      onToggleDrawer: () => {},
    })
  );

const sidebar = (drawerOpen: boolean) =>
  renderToStaticMarkup(
    createElement(Sidebar, {
      route: { screen: "home" },
      nav: () => {},
      onNewProject: () => {},
      onNewInitiative: () => {},
      drawerOpen,
      onDrawer: () => {},
    })
  );

describe("drawer markup", () => {
  it("puts a labelled hamburger that controls the nav in the topbar's left slot", () => {
    const closed = topbar(false);
    const left = closed.slice(closed.indexOf('<div class="l">'), closed.indexOf('<div class="r">'));
    expect(left).toContain(
      'class="iconbtn hamburger" aria-label="Open navigation" aria-expanded="false" aria-controls="mc-nav" data-testid="nav-drawer-toggle"'
    );
    expect(topbar(true)).toContain('aria-expanded="true" aria-controls="mc-nav"');
  });

  it("marks the ⌘K shortcut as a keyboard hint (hidden on touch devices)", () => {
    expect(topbar(false)).toContain('<span class="key kbd-hint">⌘K</span>');
  });

  it("opens the nav as a drawer with a close button and a backdrop", () => {
    const closed = sidebar(false);
    expect(closed).toMatch(/^<nav class="mc-side" id="mc-nav"/);
    expect(closed).toContain('<button type="button" class="side-close" aria-label="Close navigation">');
    expect(sidebar(true)).toMatch(/^<nav class="mc-side open" id="mc-nav"/);

    const scrim = (open: boolean) => renderToStaticMarkup(createElement(NavScrim, { open, onDrawer: () => {} }));
    expect(scrim(false)).toBe("");
    expect(scrim(true)).toBe('<div class="mc-scrim" aria-hidden="true" data-testid="nav-drawer-scrim"></div>');
  });
});

describe("responsive CSS contract (RESPONSIVE.md)", () => {
  const css = readFileSync(join(import.meta.dirname, "..", "src/styles/mc-app.css"), "utf8");

  it("uses only the canonical 1024px / 640px width breakpoints", () => {
    const widths = [...css.matchAll(/\((?:max|min)-width:\s*(\d+)px\)/g)].map((m) => m[1]);
    expect(widths.length).toBeGreaterThan(0);
    expect(new Set(widths)).toEqual(new Set(["1024", "640"]));
  });

  it("drives the drawer from the brand drawer/scrim tokens and locks body scroll", () => {
    const tablet = css.slice(css.indexOf("@media (max-width:1024px)"));
    expect(tablet).toContain("z-index:var(--p-z-drawer)");
    expect(tablet).toContain("z-index:var(--p-z-scrim)");
    expect(tablet).toContain("background:var(--p-scrim)");
    expect(tablet).toContain("width:min(280px, 85vw)");
    expect(tablet).toMatch(/body\.mc-sb-open\s*\{\s*overflow:hidden;/);
  });

  it("animates only when motion is welcome, and hides the ⌘K hint on touch", () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: no-preference\)\s*\{[^}]*\.mc \.mc-side \{[^}]*transition:/);
    expect(css).toMatch(/@media \(hover: none\)\s*\{[^}]*\.mc \.kbd-hint \{\s*display:none;/);
  });
});
