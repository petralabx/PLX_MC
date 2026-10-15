// TASK-2977: the top-bar avatar is the account menu trigger, and the menu
// holds who is signed in plus Sign out. Markup via renderToStaticMarkup; the
// CSS contract (PLX tokens only, no raw colour) is read from src/styles.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/actions", () => ({ signOutAction: vi.fn(), signInAgainAction: vi.fn() }));

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

  it("is styled with PLX tokens only", () => {
    const css = readFileSync(join(process.cwd(), "src/styles/mc-shell.css"), "utf8");
    const block = css.slice(css.indexOf("/* Account menu"), css.indexOf(".mc .usermenu-item .ic"));
    expect(block.length).toBeGreaterThan(0);
    expect(block).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(block).not.toMatch(/rgba?\(/i);
    expect(block).toContain("var(--p-paper)");
  });
});
