// Declarative navigation model (Wave 6 — colleague UX). ONE source for the
// sidebar (chrome.tsx), the ⌘K palette's Navigate group (command-palette.tsx)
// and tests/mc-nav-model.test.ts. Grouped by what a colleague is doing — My
// work · Plan · Knowledge · Admin & health — not by system internals. Pure: no
// React, no store reads (badge counts are resolved by the sidebar).
import type { Route, Screen } from "./route";
import { routeToUrl } from "./route";

export type NavGroupId = "my-work" | "plan" | "knowledge" | "admin";
/** Which live count the sidebar shows beside an item. */
export type NavBadge = "needs" | "approvals" | "sync" | "agents" | "ai-spend";
/** Feature flags that gate an item (off → hidden from sidebar and palette). */
export type NavFlag = "meetingIntake" | "routingInbox";
/** Live record lists the sidebar renders after a group's items. */
export type NavList = "projects" | "initiatives";

export interface NavItem {
  screen: Screen;
  label: string;
  /** Decorative glyph — aria-hidden in the sidebar. */
  icon: string;
  /** Palette hint (also searchable). */
  hint?: string;
  badge?: NavBadge;
  flag?: NavFlag;
  /** Extra ⌘K entries that land on the same screen (search synonyms). */
  aliases?: { label: string; hint: string }[];
}

export interface NavGroup {
  id: NavGroupId;
  label: string;
  /** Collapsed by default; the sidebar remembers the expanded state. */
  collapsible?: boolean;
  items: NavItem[];
  lists?: NavList[];
}

export interface NavFlags {
  meetingIntake: boolean;
  routingInbox: boolean;
}

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    id: "my-work",
    label: "My work",
    items: [
      { screen: "home", label: "Home", icon: "⌂", hint: "what needs me", badge: "needs" },
      { screen: "mine", label: "My tasks", icon: "☉" },
      { screen: "approvals", label: "Approvals", icon: "✓", badge: "approvals" },
    ],
  },
  {
    id: "plan",
    label: "Plan",
    items: [
      { screen: "board", label: "Board", icon: "▦" },
      { screen: "list", label: "List", icon: "≣" },
      { screen: "timeline", label: "Timeline", icon: "▭" },
      { screen: "insights", label: "Insights", icon: "◔" },
    ],
    lists: ["projects", "initiatives"],
  },
  {
    id: "knowledge",
    label: "Knowledge",
    items: [
      { screen: "brain-ask", label: "Ask the Brain", icon: "?" },
      { screen: "governance-sops", label: "SOP guide", icon: "§" },
      { screen: "skills-directory", label: "Skills directory", icon: "◈" },
      { screen: "architecture", label: "Architecture", icon: "⬡" },
      { screen: "help", label: "Help", icon: "ⓘ", hint: "glossary" },
    ],
  },
  {
    id: "admin",
    label: "Admin & health",
    collapsible: true,
    items: [
      { screen: "repos", label: "Repos", icon: "❮❯" },
      { screen: "files", label: "Files", icon: "❒" },
      {
        screen: "sync",
        label: "SharePoint sync issues",
        icon: "⇄",
        hint: "review queue",
        badge: "sync",
        aliases: [
          { label: "Conflicts", hint: "sync console" },
          { label: "Review queue", hint: "sync conflicts" },
        ],
      },
      { screen: "loop-ledgers", label: "Loop ledgers", icon: "◰" },
      { screen: "ai-spend", label: "AI spend", icon: "◎", badge: "ai-spend" },
      { screen: "matrix", label: "Traceability", icon: "⊞" },
      { screen: "feed", label: "Agent activity", icon: "◉", badge: "agents" },
      { screen: "intake", label: "Meeting intake", icon: "🗒", flag: "meetingIntake" },
      { screen: "routing-inbox", label: "Routing inbox", icon: "»", flag: "routingInbox" },
    ],
  },
];

/** The groups with flag-gated items removed when their flag is off. */
export function visibleNavGroups(flags: NavFlags): NavGroup[] {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.flag || flags[item.flag]),
  }));
}

/** The group a screen's nav item lives in (null for detail screens). */
export function navGroupOf(screen: Screen): NavGroupId | null {
  return NAV_GROUPS.find((g) => g.items.some((i) => i.screen === screen))?.id ?? null;
}

/** A nav link's href — the shared Route ⇄ URL serializer (route.ts). */
export function navHref(route: Route): string {
  return routeToUrl(route);
}

/**
 * Nav links are real <a href>s; only a plain primary click becomes a
 * client-side nav(). Modified or middle clicks (new tab, new window, download)
 * are left to the browser.
 */
export function isPlainLeftClick(event: {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

export interface NavCommand {
  key: string;
  icon: string;
  label: string;
  hint?: string;
  screen: Screen;
}

const slug = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, "-");

/** ⌘K "Go to …" commands for every visible item, plus its search synonyms. */
export function navCommands(flags: NavFlags): NavCommand[] {
  return visibleNavGroups(flags).flatMap((group) =>
    group.items.flatMap((item) => [
      { key: `nav:${item.screen}`, icon: item.icon, label: `Go to ${item.label}`, hint: item.hint, screen: item.screen },
      ...(item.aliases ?? []).map((alias) => ({
        key: `nav:${slug(alias.label)}`,
        icon: item.icon,
        label: `Go to ${alias.label}`,
        hint: alias.hint,
        screen: item.screen,
      })),
    ])
  );
}

// ─── Collapsible group state (Admin & health) ───────────────────────────────
// Remembered in localStorage when it is available; always held in memory so
// the group still opens when storage is blocked, full, or throws.

type NavStorage = Pick<Storage, "getItem" | "setItem">;

export interface NavGroupState {
  isOpen(id: NavGroupId): boolean;
  setOpen(id: NavGroupId, open: boolean): void;
  subscribe(listener: () => void): () => void;
}

const storageKey = (id: NavGroupId) => `mc.nav.${id}.open`;

export function createNavGroupState(getStorage: () => NavStorage | null): NavGroupState {
  const memory = new Map<NavGroupId, boolean>();
  const listeners = new Set<() => void>();
  const storage = (): NavStorage | null => {
    try {
      return getStorage();
    } catch {
      return null; // storage access itself can throw (blocked site data)
    }
  };
  return {
    isOpen(id) {
      const held = memory.get(id);
      if (held !== undefined) return held;
      try {
        return storage()?.getItem(storageKey(id)) === "1";
      } catch {
        return false; // unreadable → the default (collapsed)
      }
    },
    setOpen(id, open) {
      memory.set(id, open);
      try {
        storage()?.setItem(storageKey(id), open ? "1" : "0");
      } catch {
        // not persisted (private mode / quota) — still open for this page
      }
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

// ─── Drawer (≤1024px) — RESPONSIVE.md §3 drawer protocol ────────────────────
// The hamburger toggles; the close button, Esc, a backdrop tap and any nav
// item click all dismiss.
export type DrawerEvent = "toggle" | "close" | "escape" | "backdrop" | "navigate";

export function nextDrawerOpen(open: boolean, event: DrawerEvent): boolean {
  return event === "toggle" ? !open : false;
}

/** Where focus goes on a drawer transition: into it on open, back to the hamburger on close. */
export function drawerFocusTarget(wasOpen: boolean, isOpen: boolean): "panel" | "toggle" | null {
  if (!wasOpen && isOpen) return "panel";
  if (wasOpen && !isOpen) return "toggle";
  return null;
}

/**
 * Keep Tab inside the open drawer (the page behind it is under the scrim).
 * Returns the index to focus when Tab / Shift+Tab would leave the drawer, or
 * null to let the browser move focus normally.
 */
export function wrapFocusIndex(count: number, current: number, shift: boolean): number | null {
  if (count === 0) return null;
  if (shift) return current <= 0 ? count - 1 : null;
  return current < 0 || current === count - 1 ? 0 : null;
}
