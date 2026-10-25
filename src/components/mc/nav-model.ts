// Declarative navigation model (Wave 6 — colleague UX). ONE source for every
// nav surface: the sidebar / rail / drawer (chrome.tsx), the phone bottom tabs,
// group strip and More sheet (bottom-tabs.tsx, more-sheet.tsx), the ⌘K
// palette's Navigate group (command-palette.tsx) and tests/mc-nav-model.test.ts.
// Grouped by what a colleague is doing — My work · Plan · Knowledge · Reporting
// · Admin & health — not by system internals. Pure: no React, no store reads (badge
// counts are resolved by the shell; icon names map to Lucide in nav-icon.tsx).
import { isClosedStage, type Bucket, type Human, type Project, type Task } from "@/lib/mc-data";
import { STAR_CAP, type StarChange, type StarKey } from "@/lib/stars";

import type { Route, Screen } from "./route";
import { SCREEN_VALUES, routeToUrl } from "./route";

export type NavGroupId = "my-work" | "plan" | "knowledge" | "reporting" | "admin";
/** Which live count the sidebar shows beside an item. */
export type NavBadge = "needs" | "approvals" | "sync" | "agents" | "ai-spend";
/** Feature flags that gate an item (off → hidden from sidebar and palette). */
export type NavFlag = "meetingIntake" | "routingInbox";
/** Live record lists the sidebar renders after a group's items. */
export type NavList = "projects" | "initiatives" | "project-tree";

/**
 * Lucide icon names (design system: Lucide, small, currentColor). Resolved to
 * components in nav-icon.tsx so this model stays React-free.
 */
export type NavIconName =
  | "House" | "LayoutDashboard" | "CircleUser" | "SquareCheck" | "SquareKanban" | "List" | "CalendarRange" | "ChartPie"
  | "BookOpen" | "ClipboardList" | "Wrench" | "Network" | "CircleHelp" | "GitBranch" | "Activity"
  | "File" | "RefreshCw" | "FileText" | "CircleDollarSign" | "Grid3x3" | "Radio" | "Inbox" | "Route"
  | "Target" | "Ellipsis" | "Settings" | "FolderKanban" | "Search";

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
  /** Other screens this row stands for, lit on them too (All work: List, Timeline). */
  also?: readonly Screen[];
}

/** Whether a nav row is the current one for a screen: its own, or one it stands for. */
export function isNavItemCurrent(item: NavItem, screen: Screen): boolean {
  return item.screen === screen || (item.also?.includes(screen) ?? false);
}

/** Where a nav row goes: its screen, or, when lit for another (List under All work), that one. */
export function navItemTarget(item: NavItem, screen: Screen): Screen {
  return isNavItemCurrent(item, screen) ? screen : item.screen;
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
      { screen: "dashboard", label: "Dashboard", icon: "▤", lucide: "LayoutDashboard", hint: "project and initiative progress" },
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
    id: "reporting",
    label: "Reporting",
    items: [
      {
        screen: "goals",
        label: "Goals & production",
        icon: "◎",
        lucide: "Target",
        hint: "batches, truckloads and revenue this month",
        aliases: [
          { label: "Production goals", hint: "Line 1 bulk kg per day" },
          { label: "Revenue goal", hint: "revenue against target" },
        ],
      },
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

// ─── Zoned sidebar (navigation redesign Phase 2, TASK-3840) ─────────────────
// Behind the nav-zones flag (nav-zones.ts), to the shared PLX shell contract
// (portal ADR-011): personal items first, then Plan, Reporting and Knowledge,
// with system tools in a footer flyout. Every row is a NAV_GROUPS item, so the
// screens, hrefs, badges and flags are identical; only where they sit (and two
// labels) change, and Board, List and Timeline share one All work row
// (TASK-3843). The phone tabs follow them (ZONED_NAV_TABS); ⌘K keeps NAV_GROUPS.

const NAV_ITEM_BY_SCREEN = new Map(NAV_GROUPS.flatMap((group) => group.items).map((item) => [item.screen, item]));

function navItem(screen: Screen, label?: string): NavItem {
  const item = NAV_ITEM_BY_SCREEN.get(screen);
  if (!item) throw new Error(`no nav item for ${screen}`);
  return label ? { ...item, label } : item;
}

/** The Projects page (TASK-3841): every open project and its initiatives. */
export const PROJECTS_NAV_ITEM: NavItem = {
  screen: "projects",
  label: "Projects",
  icon: "▤",
  lucide: "FolderKanban",
  hint: "every project and its initiatives",
};

/**
 * Board, List and Timeline as one row (TASK-3843): the views are tabs on the
 * screen, and each keeps its URL and its g b, g l or g t key.
 */
export const ALL_WORK_NAV_ITEM: NavItem = {
  ...navItem("board"),
  label: "All work",
  hint: "board, list and timeline",
  also: ["list", "timeline"],
};

export const ZONED_NAV_GROUPS: readonly NavGroup[] = [
  { id: "my-work", label: "My work", items: [navItem("home"), navItem("mine"), navItem("approvals")] },
  {
    id: "plan",
    label: "Plan",
    items: [ALL_WORK_NAV_ITEM, PROJECTS_NAV_ITEM],
    lists: ["project-tree"],
  },
  {
    id: "reporting",
    label: "Reporting",
    items: [navItem("dashboard"), navItem("insights"), navItem("goals"), navItem("ai-spend")],
  },
  {
    id: "knowledge",
    label: "Knowledge",
    collapsible: true,
    items: [navItem("brain-ask"), navItem("governance-sops"), navItem("skills-directory"), navItem("architecture")],
  },
];

export interface NavFlyoutSection {
  label: string;
  items: NavItem[];
}

/** The footer's Admin & health flyout, in three sections. */
export const ADMIN_FLYOUT: readonly NavFlyoutSection[] = [
  { label: "Operations", items: [navItem("feed"), navItem("intake"), navItem("routing-inbox")] },
  {
    label: "Sync and data",
    items: [navItem("sync", "SharePoint sync"), navItem("files"), navItem("loop-ledgers")],
  },
  { label: "Engineering", items: [navItem("repos"), navItem("activity"), navItem("matrix")] },
];

/** The footer's last row. */
export const HELP_NAV_ITEM: NavItem = navItem("help", "Help and shortcuts");

/** The zoned groups with flag-gated items removed when their flag is off. */
export function visibleZonedNavGroups(flags: NavFlags): NavGroup[] {
  return ZONED_NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.flag || flags[item.flag]),
  }));
}

/** The Admin & health sections, flag-gated items removed; empty sections drop. */
export function visibleAdminFlyout(flags: NavFlags): NavFlyoutSection[] {
  return ADMIN_FLYOUT.map((section) => ({
    ...section,
    items: section.items.filter((item) => !item.flag || flags[item.flag]),
  })).filter((section) => section.items.length > 0);
}

/** Where a screen sits in the zoned sidebar: a group, the flyout, help, or nowhere (detail screens). */
export function zonedNavPlaceOf(screen: Screen): NavGroupId | "admin" | "help" | null {
  if (screen === HELP_NAV_ITEM.screen) return "help";
  const group = ZONED_NAV_GROUPS.find((g) => g.items.some((i) => isNavItemCurrent(i, screen)));
  if (group) return group.id;
  return ADMIN_FLYOUT.some((section) => section.items.some((i) => i.screen === screen)) ? "admin" : null;
}

// ─── Projects tree (zoned sidebar, TASK-3841) ───────────────────────────────
// Each open project with its open initiatives nested under it: the viewer's
// own projects first, then the rest by name, at most PROJECT_TREE_CAP rows.
// The current project always makes the cut, and View all shows when rows are
// left out. Callers pass the nav-visible records (navProjects, navBuckets), so
// closed and archived ones stay out. Initiatives without an open project sit
// under No project on the Projects page.

export const PROJECT_TREE_CAP = 6;

export interface ProjectTreeNode {
  project: Project;
  initiatives: Bucket[];
}

export interface ProjectTree {
  nodes: ProjectTreeNode[];
  /** Every open project, shown or not: "View all N projects". */
  total: number;
}

const memberToken = (raw: string) => raw.trim().toLowerCase();

/**
 * The viewer's projects, by the Approvals screen's My projects rule
 * (src/lib/compliance/my-projects.ts, TASK-3720): a member, the owner, or
 * assigned (assignee or coassignee) an open task in one of its initiatives.
 * Ids match case-insensitively on the viewer's id or email.
 */
export function viewerProjectIds(
  projects: readonly Project[],
  initiatives: readonly Bucket[],
  tasks: readonly Task[],
  viewer: Pick<Human, "id" | "email"> | null
): Set<string> {
  const mine = new Set<string>();
  if (!viewer) return mine;
  const tokens = new Set([viewer.id, viewer.email].filter((t): t is string => !!t).map(memberToken));
  const holds = (raw: string | null | undefined) => !!raw && tokens.has(memberToken(raw));
  const projectOf = new Map(initiatives.map((b) => [b.id, b.project ?? null]));
  for (const task of tasks) {
    const projectId = projectOf.get(task.bucket);
    if (projectId && !isClosedStage(task.stage) && (holds(task.assignee) || (task.coassignees ?? []).some(holds))) {
      mine.add(projectId);
    }
  }
  for (const project of projects) {
    if (holds(project.owner) || (project.members ?? []).some(holds)) mine.add(project.id);
  }
  return mine;
}

export function projectTree(
  projects: readonly Project[],
  initiatives: readonly Bucket[],
  mine: ReadonlySet<string>,
  currentProjectId: string | null = null,
  cap: number = PROJECT_TREE_CAP
): ProjectTree {
  const ordered = [...projects].sort(
    (a, b) => Number(mine.has(b.id)) - Number(mine.has(a.id)) || a.name.localeCompare(b.name, undefined, { numeric: true })
  );
  let shown = ordered.slice(0, cap);
  const current = ordered.find((p) => p.id === currentProjectId);
  if (current && !shown.includes(current)) shown = [...shown.slice(0, Math.max(0, cap - 1)), current];
  return {
    nodes: shown.map((project) => ({ project, initiatives: initiatives.filter((b) => b.project === project.id) })),
    total: ordered.length,
  };
}

/** Initiatives with no open project: the Projects page's No project group. */
export function unfiledInitiatives(projects: readonly Project[], initiatives: readonly Bucket[]): Bucket[] {
  const open = new Set(projects.map((p) => p.id));
  return initiatives.filter((b) => !b.project || !open.has(b.project));
}

// ─── Starred (zoned sidebar, TASK-3842) ─────────────────────────────────────
// Copies of the screens, projects and initiatives a person starred, at most
// STAR_CAP, in the order they starred them, kept on the server (src/lib/stars).
// A copy is never the lit row; the item's own row is. Screens carry their zoned
// label, and Board, List and Timeline are one All work star. A closed or
// archived project or initiative still shows: the person starred it. A screen
// behind an off flag does not show, but keeps its place: flags can differ
// between devices. Only a dead star (its record is gone, or its key no longer
// names anything) makes room when the list is full and the person stars
// something new.

export interface StarRow {
  key: StarKey;
  label: string;
  target: Route;
  /** A screen's icon; a project or initiative shows its health tick instead. */
  lucide?: NavIconName;
  health?: Project["health"];
}

const STAR_SCREENS = new Map<Screen, NavItem>(
  [...ZONED_NAV_GROUPS.flatMap((group) => group.items), ...ADMIN_FLYOUT.flatMap((section) => section.items), HELP_NAV_ITEM].flatMap(
    (item) => [item.screen, ...(item.also ?? [])].map((screen): [Screen, NavItem] => [screen, item])
  )
);

/** The star key for the page a route shows; null for a page that cannot be starred (a task). */
export function starKeyOf(route: Route): StarKey | null {
  if (route.screen === "project") return route.projectId ? `project:${route.projectId}` : null;
  if (route.screen === "bucket") return route.bucketId ? `bucket:${route.bucketId}` : null;
  const item = STAR_SCREENS.get(route.screen);
  return item ? `screen:${item.screen}` : null;
}

function splitStar(key: string): { kind: string; id: string } {
  const colon = key.indexOf(":");
  return { kind: key.slice(0, colon), id: key.slice(colon + 1) };
}

/**
 * The rows for a person's stars, in their order. Pass every project and
 * initiative (allProjects, allBuckets): a closed or archived one still shows.
 * A star whose record is gone, or whose screen is behind an off flag, does not.
 */
export function starRows(
  stars: readonly string[],
  projects: readonly Project[],
  initiatives: readonly Bucket[],
  flags: NavFlags
): StarRow[] {
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const initiativeById = new Map(initiatives.map((b) => [b.id, b]));
  return stars.flatMap((stored): StarRow[] => {
    const key = stored as StarKey;
    const { kind, id } = splitStar(key);
    if (kind === "project") {
      const project = projectById.get(id);
      return project ? [{ key, label: project.name, target: { screen: "project", projectId: id }, health: project.health }] : [];
    }
    if (kind === "bucket") {
      const initiative = initiativeById.get(id);
      return initiative ? [{ key, label: initiative.name, target: { screen: "bucket", bucketId: id }, health: initiative.health }] : [];
    }
    const item = kind === "screen" ? STAR_SCREENS.get(id as Screen) : undefined;
    return item && (!item.flag || flags[item.flag])
      ? [{ key, label: item.label, target: { screen: item.screen }, lucide: item.lucide }]
      : [];
  });
}

/**
 * The stars that can never show: a project or initiative these records do not
 * hold, or a key that names no screen, project or initiative. A screen behind
 * an off flag is not dead. Pass the live records only: seed or cached data
 * would make real records look gone.
 */
export function deadStars(stars: readonly string[], projects: readonly Project[], initiatives: readonly Bucket[]): Set<string> {
  const projectIds = new Set(projects.map((p) => p.id));
  const initiativeIds = new Set(initiatives.map((b) => b.id));
  return new Set(
    stars.filter((key) => {
      const { kind, id } = splitStar(key);
      if (kind === "project") return !projectIds.has(id);
      if (kind === "bucket") return !initiativeIds.has(id);
      return kind !== "screen" || !STAR_SCREENS.has(id as Screen);
    })
  );
}

/**
 * The changes that star or unstar `key`. Unstarring removes it. Starring adds
 * it last; when STAR_CAP stars are stored, it first removes as many `dead`
 * stars as make room. Null when there is no room.
 */
export function starChanges(stars: readonly string[], dead: ReadonlySet<string>, key: StarKey): StarChange[] | null {
  if (stars.includes(key)) return [{ op: "remove", key }];
  const over = stars.length - STAR_CAP + 1;
  if (over <= 0) return [{ op: "add", key }];
  const removable = stars.filter((k) => dead.has(k));
  if (removable.length < over) return null;
  return [...removable.slice(0, over).map((k): StarChange => ({ op: "remove", key: k })), { op: "add", key }];
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
 * The sidebar scrollTop that brings the current row into view (TASK-3837):
 * unchanged when the row is already fully visible, otherwise the row centred.
 * Both edges are viewport-relative (getBoundingClientRect).
 */
export function revealScrollTop(
  view: { top: number; bottom: number },
  row: { top: number; bottom: number },
  scrollTop: number
): number {
  if (row.top >= view.top && row.bottom <= view.bottom) return scrollTop;
  const centred = row.top - view.top - (view.bottom - view.top - (row.bottom - row.top)) / 2;
  return Math.max(0, Math.round(scrollTop + centred));
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

/** ⌘K "Go to …" commands for every visible item, plus its search synonyms; the zoned shell adds its Projects page. */
export function navCommands(flags: NavFlags, zoned = false): NavCommand[] {
  const items = [...visibleNavGroups(flags).flatMap((group) => group.items), ...(zoned ? [PROJECTS_NAV_ITEM] : [])];
  return items.flatMap((item) => [
      { key: `nav:${item.screen}`, icon: item.icon, label: `Go to ${item.label}`, hint: item.hint, screen: item.screen },
      ...(item.aliases ?? []).map((alias) => ({
        key: `nav:${slug(alias.label)}`,
        icon: item.icon,
        label: `Go to ${alias.label}`,
        hint: alias.hint,
        screen: item.screen,
      })),
  ]);
}

// ─── Phone tabs (<641px) — ADR-005 ──────────────────────────────────────────
// Four bottom tabs; Reporting and Admin & health live behind "More". Detail
// screens (task / bucket / project) belong to Plan, the tab they open from.

export type NavTabId = "my-work" | "plan" | "knowledge" | "more" | "home" | "mine" | "projects" | "search";

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
  reporting: "more",
  admin: "more",
};

export const NAV_TABS: readonly NavTab[] = [
  { id: "my-work", label: "My work", lucide: "House", home: "home", badge: "needs" },
  { id: "plan", label: "Plan", lucide: "SquareKanban", home: "board" },
  { id: "knowledge", label: "Knowledge", lucide: "BookOpen", home: "brain-ask" },
  { id: "more", label: "More", lucide: "Ellipsis", badge: "sync" },
];

// Screens outside the default sidebar: the detail screens, and the zoned
// sidebar's Projects page (TASK-3841).
const DETAIL_TAB: Partial<Record<Screen, NavTabId>> = { task: "plan", bucket: "plan", project: "plan", projects: "plan" };
const DETAIL_TITLE: Partial<Record<Screen, string>> = {
  task: "Task",
  bucket: "Initiative",
  project: "Project",
  projects: "Projects",
};

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

// The zoned shell's phone tabs (TASK-3843): Home, My tasks, Projects, Search
// and More. Search opens ⌘K; More's sheet holds Reporting, Knowledge, Admin &
// health and Help.
export const ZONED_NAV_TABS: readonly NavTab[] = [
  { id: "home", label: "Home", lucide: "House", home: "home", badge: "needs" },
  { id: "mine", label: "My tasks", lucide: "CircleUser", home: "mine" },
  { id: "projects", label: "Projects", lucide: "FolderKanban", home: "projects" },
  { id: "search", label: "Search", lucide: "Search" },
  { id: "more", label: "More", lucide: "Ellipsis", badge: "sync" },
];

// The zoned tabs' screens, in one place: My work's screens have tabs of their
// own (Approvals goes with Home), Plan and its detail screens go with
// Projects, and every other screen with More.
const ZONED_SCREEN_TAB: Partial<Record<Screen, NavTabId>> = { home: "home", approvals: "home", mine: "mine" };

/** The zoned tab a screen lives under: Approvals with Home, all of Plan and its detail screens with Projects. */
export function zonedTabOf(screen: Screen): NavTabId {
  const tab = ZONED_SCREEN_TAB[screen];
  if (tab) return tab;
  return zonedNavPlaceOf(screen) === "plan" || DETAIL_TAB[screen] ? "projects" : "more";
}

/** The zoned phone strip: a tab's screens when it has two or more (Home and Approvals; All work and Projects). */
export function zonedTabScreens(tab: NavTabId, flags: NavFlags): NavItem[] {
  if (tab === "more") return [];
  const items = visibleZonedNavGroups(flags).flatMap((group) => group.items.filter((item) => zonedTabOf(item.screen) === tab));
  return items.length > 1 ? items : [];
}

/** The phone top-bar title: the nav label, or the detail screen's noun. Zoned, the views read All work. */
export function screenTitle(screen: Screen, zoned = false): string {
  if (zoned && isNavItemCurrent(ALL_WORK_NAV_ITEM, screen)) return ALL_WORK_NAV_ITEM.label;
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

/**
 * Tab memory for one tab set: the default tabs (tabOf), or the zoned ones
 * (zonedTabOf). Detail screens are never a landing spot; `landing` says which
 * other screens are.
 */
export function createTabMemory(
  getStorage: () => NavStorage | null,
  tabOfScreen: (screen: Screen) => NavTabId = tabOf,
  landing: (screen: Screen) => boolean = (screen) => !DETAIL_TAB[screen]
): TabMemory {
  const memory = new Map<NavTabId, Screen>();
  const listeners = new Set<() => void>();
  const storage = safeStorage(getStorage);
  return {
    last(tab) {
      const held = memory.get(tab);
      if (held) return held;
      try {
        const raw = storage()?.getItem(tabKey(tab));
        return raw && isScreen(raw) && tabOfScreen(raw) === tab && landing(raw) ? raw : undefined;
      } catch {
        return undefined;
      }
    },
    remember(screen) {
      const tab = tabOfScreen(screen);
      // Detail screens are not landing spots, and More opens a sheet.
      if (tab === "more" || !landing(screen) || memory.get(tab) === screen) return;
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

/** The zoned tabs' memory (TASK-3843): the Projects page is a landing spot; detail screens are not. */
export function createZonedTabMemory(getStorage: () => NavStorage | null): TabMemory {
  return createTabMemory(getStorage, zonedTabOf, (screen) => !DETAIL_TAB[screen] || screen === "projects");
}

// ─── Collapsible group state (Admin & health) ───────────────────────────────
// Remembered in localStorage when it is available; always held in memory so
// the group still opens when storage is blocked, full, or throws.

type NavStorage = Pick<Storage, "getItem" | "setItem">;

/** Storage, or null when even reaching it throws (blocked site data). */
function safeStorage(getStorage: () => NavStorage | null): () => NavStorage | null {
  return () => {
    try {
      return getStorage();
    } catch {
      return null;
    }
  };
}

export interface NavGroupState {
  isOpen(id: NavGroupId): boolean;
  setOpen(id: NavGroupId, open: boolean): void;
  subscribe(listener: () => void): () => void;
}

const storageKey = (id: NavGroupId) => `mc.nav.${id}.open`;

export function createNavGroupState(getStorage: () => NavStorage | null): NavGroupState {
  const memory = new Map<NavGroupId, boolean>();
  const listeners = new Set<() => void>();
  const storage = safeStorage(getStorage);
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

// ─── Recents (⌘K, TASK-3853) ────────────────────────────────────────────────
// The screens, projects, initiatives and tasks a person opened last in this
// browser, newest first, at most RECENTS_CAP. The zoned shell's palette lists
// them first. They stay in this browser: unlike stars, recents are a trail,
// not a choice.

export const RECENTS_CAP = 8;
/** Kept beyond the cap: the page under the palette, and a record since gone, do not show. */
export const RECENTS_KEPT = 12;

export type RecentKey = StarKey | `task:${string}`;

const RECENT_KEY_RE = /^(screen|project|bucket|task):\S+$/;

/** The recents key for the page a route shows; null for a detail route without its id. */
export function recentKeyOf(route: Route): RecentKey | null {
  if (route.screen === "task") return route.taskId ? `task:${route.taskId}` : null;
  if (route.screen === "project" || route.screen === "bucket") return starKeyOf(route);
  // The exact view (List, not All work): a recent goes back to what was open.
  return `screen:${route.screen}`;
}

export interface Recents {
  /** Newest first. The same array until the next visit, so a snapshot can hold it. */
  list(): readonly RecentKey[];
  visit(key: RecentKey): void;
  subscribe(listener: () => void): () => void;
}

const RECENTS_STORAGE_KEY = "mc.nav.recents";

export function createRecents(getStorage: () => NavStorage | null): Recents {
  const storage = safeStorage(getStorage);
  let held: RecentKey[] | null = null;
  const listeners = new Set<() => void>();
  const read = (): RecentKey[] => {
    try {
      const parsed: unknown = JSON.parse(storage()?.getItem(RECENTS_STORAGE_KEY) ?? "[]");
      return Array.isArray(parsed)
        ? parsed.filter((key): key is RecentKey => typeof key === "string" && RECENT_KEY_RE.test(key)).slice(0, RECENTS_KEPT)
        : [];
    } catch {
      return []; // unreadable → none yet
    }
  };
  return {
    list() {
      held ??= read();
      return held;
    },
    visit(key) {
      // Read again first: another tab may have written since this one read.
      const current = storage() ? read() : (held ?? []);
      const next = [key, ...current.filter((k) => k !== key)].slice(0, RECENTS_KEPT);
      if (held && next.length === held.length && next.every((k, i) => k === held?.[i])) return;
      held = next;
      try {
        storage()?.setItem(RECENTS_STORAGE_KEY, JSON.stringify(held));
      } catch {
        // not persisted (private mode / quota) — still listed for this page
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
