// Declarative navigation model (Wave 6 — colleague UX). ONE source for every
// nav surface: the sidebar / rail / drawer (chrome.tsx), the phone bottom tabs,
// group strip and More sheet (bottom-tabs.tsx, more-sheet.tsx), the ⌘K
// palette's Navigate group (command-palette.tsx) and tests/mc-nav-model.test.ts.
// Grouped by what a colleague is doing — My work · Plan · Knowledge · Admin &
// health — not by system internals. Pure: no React, no store reads (badge
// counts are resolved by the shell; icon names map to Lucide in nav-icon.tsx).
import type { Route, Screen } from "./route";
import { SCREEN_VALUES, routeToUrl } from "./route";

export type NavGroupId = "my-work" | "plan" | "knowledge" | "admin";
/** Which live count the sidebar shows beside an item. */
export type NavBadge = "needs" | "approvals" | "sync" | "agents" | "ai-spend";
/** Feature flags that gate an item (off → hidden from sidebar and palette). */
export type NavFlag = "meetingIntake" | "routingInbox";
/** Live record lists the sidebar renders after a group's items. */
export type NavList = "projects" | "initiatives";

/**
 * Lucide icon names (design system: Lucide, small, currentColor). Resolved to
 * components in nav-icon.tsx so this model stays React-free.
 */
export type NavIconName =
  | "House" | "CircleUser" | "SquareCheck" | "SquareKanban" | "List" | "CalendarRange" | "ChartPie"
  | "BookOpen" | "ClipboardList" | "Wrench" | "Network" | "CircleHelp" | "GitBranch" | "Activity"
  | "File" | "RefreshCw" | "FileText" | "CircleDollarSign" | "Grid3x3" | "Radio" | "Inbox" | "Route"
  | "Ellipsis";

export interface NavItem {
  screen: Screen;
  label: string;
  /** Decorative glyph for the ⌘K palette rows (the nav surfaces use `lucide`). */
  icon: string;
  /** Decorative Lucide icon for the sidebar, rail, tabs and More sheet (aria-hidden). */
  lucide: NavIconName;
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
      { screen: "home", label: "Home", icon: "⌂", lucide: "House", hint: "what needs me", badge: "needs" },
      { screen: "mine", label: "My tasks", icon: "☉", lucide: "CircleUser" },
      { screen: "approvals", label: "Approvals", icon: "✓", lucide: "SquareCheck", badge: "approvals" },
    ],
  },
  {
    id: "plan",
    label: "Plan",
    items: [
      { screen: "board", label: "Board", icon: "▦", lucide: "SquareKanban" },
      { screen: "list", label: "List", icon: "≣", lucide: "List" },
      { screen: "timeline", label: "Timeline", icon: "▭", lucide: "CalendarRange" },
      { screen: "insights", label: "Insights", icon: "◔", lucide: "ChartPie" },
    ],
    lists: ["projects", "initiatives"],
  },
  {
    id: "knowledge",
    label: "Knowledge",
    items: [
      { screen: "brain-ask", label: "Ask the Brain", icon: "?", lucide: "BookOpen" },
      { screen: "governance-sops", label: "SOP guide", icon: "§", lucide: "ClipboardList" },
      { screen: "skills-directory", label: "Skills directory", icon: "◈", lucide: "Wrench" },
      { screen: "architecture", label: "Architecture", icon: "⬡", lucide: "Network" },
      { screen: "help", label: "Help", icon: "ⓘ", lucide: "CircleHelp", hint: "glossary" },
    ],
  },
  {
    id: "admin",
    label: "Admin & health",
    collapsible: true,
    items: [
      { screen: "repos", label: "Repos", icon: "❮❯", lucide: "GitBranch" },
      { screen: "files", label: "Files", icon: "❒", lucide: "File" },
      {
        screen: "sync",
        label: "SharePoint sync issues",
        icon: "⇄",
        lucide: "RefreshCw",
        hint: "review queue",
        badge: "sync",
        aliases: [
          { label: "Conflicts", hint: "sync console" },
          { label: "Review queue", hint: "sync conflicts" },
        ],
      },
      { screen: "loop-ledgers", label: "Loop ledgers", icon: "◰", lucide: "FileText" },
      { screen: "activity", label: "Repo activity", icon: "↯", lucide: "Activity", hint: "cross-repo freshness" },
      { screen: "ai-spend", label: "AI spend", icon: "◎", lucide: "CircleDollarSign", badge: "ai-spend" },
      { screen: "matrix", label: "Traceability", icon: "⊞", lucide: "Grid3x3" },
      { screen: "feed", label: "Agent activity", icon: "◉", lucide: "Radio", badge: "agents" },
      { screen: "intake", label: "Meeting intake", icon: "🗒", lucide: "Inbox", flag: "meetingIntake" },
      { screen: "routing-inbox", label: "Routing inbox", icon: "»", lucide: "Route", flag: "routingInbox" },
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

// ─── Phone tabs (<641px) — ADR-005 ──────────────────────────────────────────
// Four bottom tabs, one per group; Admin & health lives behind "More". Detail
// screens (task / bucket / project) belong to Plan, the tab they open from.

export type NavTabId = "my-work" | "plan" | "knowledge" | "more";

export interface NavTab {
  id: NavTabId;
  label: string;
  lucide: NavIconName;
  /** Where a tap lands when the tab has no remembered screen (More opens a sheet). */
  home?: Screen;
  /** Count badge on the tab (same vocabulary as the sidebar). */
  badge?: NavBadge;
}

export const GROUP_TAB: Record<NavGroupId, NavTabId> = {
  "my-work": "my-work",
  plan: "plan",
  knowledge: "knowledge",
  admin: "more",
};

export const NAV_TABS: readonly NavTab[] = [
  { id: "my-work", label: "My work", lucide: "House", home: "home", badge: "needs" },
  { id: "plan", label: "Plan", lucide: "SquareKanban", home: "board" },
  { id: "knowledge", label: "Knowledge", lucide: "BookOpen", home: "brain-ask" },
  { id: "more", label: "More", lucide: "Ellipsis", badge: "sync" },
];

const DETAIL_TAB: Partial<Record<Screen, NavTabId>> = { task: "plan", bucket: "plan", project: "plan" };
const DETAIL_TITLE: Partial<Record<Screen, string>> = { task: "Task", bucket: "Initiative", project: "Project" };

/** The tab a screen lives under (detail screens → the tab they open from). */
export function tabOf(screen: Screen): NavTabId {
  const group = navGroupOf(screen);
  return group ? GROUP_TAB[group] : (DETAIL_TAB[screen] ?? "my-work");
}

/** The phone group strip for a tab: that group's visible items (More has none). */
export function tabScreens(tab: NavTabId, flags: NavFlags): NavItem[] {
  if (tab === "more") return [];
  return visibleNavGroups(flags).find((group) => GROUP_TAB[group.id] === tab)?.items ?? [];
}

/** The phone top-bar title: the nav label, or the detail screen's noun. */
export function screenTitle(screen: Screen): string {
  for (const group of NAV_GROUPS) {
    const item = group.items.find((i) => i.screen === screen);
    if (item) return item.label;
  }
  return DETAIL_TITLE[screen] ?? "Mission Control";
}

export function isScreen(value: string): value is Screen {
  return (SCREEN_VALUES as readonly string[]).includes(value);
}

/**
 * Collection screens that keep a context pane beside the list at ≥1600px
 * (ADR-005). Opening a task from one of them fills the pane instead of
 * leaving the collection; below 1600 the same URL shows the pane as an overlay.
 */
export const PANE_SCREENS: readonly Screen[] = ["board", "list", "mine", "approvals"];

export function isPaneScreen(screen: Screen): boolean {
  return PANE_SCREENS.includes(screen);
}

// Last screen per tab ("Plan" returns to List if that is where you were).
// Same storage contract as the group state below: localStorage when it works,
// always held in memory so a blocked or full storage still remembers.
const tabKey = (tab: NavTabId) => `mc.tab.${tab}.last`;

export interface TabMemory {
  last(tab: NavTabId): Screen | undefined;
  remember(screen: Screen): void;
  subscribe(listener: () => void): () => void;
}

export function createTabMemory(getStorage: () => NavStorage | null): TabMemory {
  const memory = new Map<NavTabId, Screen>();
  const listeners = new Set<() => void>();
  const storage = (): NavStorage | null => {
    try {
      return getStorage();
    } catch {
      return null;
    }
  };
  return {
    last(tab) {
      const held = memory.get(tab);
      if (held) return held;
      try {
        const raw = storage()?.getItem(tabKey(tab));
        return raw && isScreen(raw) && tabOf(raw) === tab && !DETAIL_TAB[raw] ? raw : undefined;
      } catch {
        return undefined;
      }
    },
    remember(screen) {
      const tab = tabOf(screen);
      // Detail screens are not landing spots, and More opens a sheet.
      if (tab === "more" || DETAIL_TAB[screen] || memory.get(tab) === screen) return;
      memory.set(tab, screen);
      try {
        storage()?.setItem(tabKey(tab), screen);
      } catch {
        // not persisted — still remembered for this page
      }
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
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

// ─── Drawer (<1025px) — RESPONSIVE.md §3 drawer protocol ────────────────────
// The toggle (the tablet rail's, or More → All screens on phone) opens it; the
// close button, Esc, a backdrop tap and any nav item click all dismiss. Focus
// in and back is use-layer.ts's job.
export type DrawerEvent = "toggle" | "close" | "escape" | "backdrop" | "navigate";

export function nextDrawerOpen(open: boolean, event: DrawerEvent): boolean {
  return event === "toggle" ? !open : false;
}

/**
 * Keep Tab inside an open layer (the page behind it is under the scrim).
 * Returns the index to focus when Tab / Shift+Tab would leave the drawer, or
 * null to let the browser move focus normally.
 */
export function wrapFocusIndex(count: number, current: number, shift: boolean): number | null {
  if (count === 0) return null;
  if (shift) return current <= 0 ? count - 1 : null;
  return current < 0 || current === count - 1 ? 0 : null;
}
