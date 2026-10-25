// TASK-2977: the top-bar avatar is the account menu trigger, and the menu
// holds who is signed in, the "Try the new navigation" switch (TASK-3855) and
// Sign out. Markup via renderToStaticMarkup; the CSS contract (PLX tokens
// only, no raw colour) is read from src/styles.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/actions", () => ({ signOutAction: vi.fn(), signInAgainAction: vi.fn() }));

import { setNavZonesBuildFlag } from "@/components/mc/nav-zones";
import { UserMenu, UserMenuPanel } from "@/components/mc/user-menu";
import type { Human } from "@/lib/mc-data/types";

const vince: Human = {
  id: "vince",
  kind: "human",
  name: "Vince Alton",
  init: "VA",
  role: "Owner",
  online: true,
  email: "vince@petrasoap.com",
};

describe("UserMenu", () => {
  it("renders the avatar as a closed menu button", () => {
    const html = renderToStaticMarkup(createElement(UserMenu, { viewer: vince }));
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-label="Account: Vince Alton"');
    expect(html).toContain(">VA<");
    expect(html).not.toContain("Sign out");
  });

  it("the open panel shows who is signed in and a Sign out menu item", () => {
    const html = renderToStaticMarkup(createElement(UserMenuPanel, { viewer: vince }));
    expect(html).toContain('role="menu"');
    expect(html).toContain("Vince Alton");
    expect(html).toContain("vince@petrasoap.com");
    expect(html).toContain("Owner");
    expect(html).toMatch(/role="menuitem"[^>]*>.*Sign out/);
  });

  it("offers the navigation switch first, off by default, before Sign out", () => {
    const html = renderToStaticMarkup(createElement(UserMenuPanel, { viewer: vince }));
    expect(html).toMatch(/role="menuitemcheckbox" aria-checked="false" data-testid="nav-switch">.*Try the new navigation/);
    expect(html.indexOf("Try the new navigation")).toBeLessThan(html.indexOf("Sign out"));
  });

  it("offers no switch when the whole build has the new navigation", () => {
    setNavZonesBuildFlag(true);
    try {
      const html = renderToStaticMarkup(createElement(UserMenuPanel, { viewer: vince }));
      expect(html).not.toContain("Try the new navigation");
      expect(html).toMatch(/role="menuitem"[^>]*>.*Sign out/);
    } finally {
      setNavZonesBuildFlag(false);
    }
  });

  it("is styled with PLX tokens only", () => {
    const css = readFileSync(join(process.cwd(), "src/styles/mc-shell.css"), "utf8");
    // The menu and the navigation switch's track and knob.
    const block = css.slice(css.indexOf("/* Account menu"), css.indexOf("  .mc .iconbtn {"));
    expect(block).toContain(".mc .usermenu-switch");
    expect(block.length).toBeGreaterThan(0);
    expect(block).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(block).not.toMatch(/rgba?\(/i);
    expect(block).toContain("var(--p-paper)");
  });
});
