// Declarative navigation model (Wave 6 — colleague UX). ONE source for every
// nav surface: the sidebar / rail / drawer (chrome.tsx), the phone bottom tabs,
// group strip and More sheet (bottom-tabs.tsx, more-sheet.tsx), the ⌘K
// palette's Navigate group (command-palette.tsx) and tests/mc-nav-model.test.ts.
// Grouped by what a colleague is doing — My work · Plan · Knowledge · Reporting
// · Admin & health — not by system internals. Pure: no React, no store reads (badge
// counts are resolved by the shell; icon names map to Lucide in nav-icon.tsx).
import { isArchived, isClosedStage, isProjectClosed, type Bucket, type Project, type Task } from "@/lib/mc-data";
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
  | "Target" | "Ellipsis" | "Settings" | "FolderKanban" | "Search" | "Gauge" | "Layers";

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
      { screen: "ci-scorecard", label: "CI scorecard", icon: "◫", lucide: "Gauge", hint: "weekly CI grades against the targets" },
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

/** Projects (TASK-3841): opens the project Dashboard (TASK-3996). */
export const PROJECTS_NAV_ITEM: NavItem = {
  screen: "projects",
  label: "Projects",
  icon: "▤",
  lucide: "FolderKanban",
  hint: "the project dashboard",
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
    items: [navItem("dashboard"), navItem("insights"), navItem("goals"), navItem("ai-spend"), navItem("ci-scorecard")],
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

// ─── Projects tree (zoned sidebar, TASK-3841; v2, TASK-3955) ────────────────
// Every open project A to Z with its open initiatives nested under it (portal
// ADR-011 v2, Lists). Callers pass the nav-visible records (navProjects,
// navBuckets), so closed and archived ones stay out.

export interface ProjectTreeNode {
  project: Project;
  initiatives: Bucket[];
}

/** Names A to Z, numbers in order (Phase 2 before Phase 10). */
export const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { numeric: true });

export function projectTree(projects: readonly Project[], initiatives: readonly Bucket[]): ProjectTreeNode[] {
  return [...projects]
    .sort(byName)
    .map((project) => ({ project, initiatives: initiatives.filter((b) => b.project === project.id) }));
}

/**
 * The tree rows the sidebar's Projects filter keeps: a project whose name
 * holds the query keeps all its initiatives; otherwise only the initiatives
 * whose names hold it, and a project with none drops. Case-insensitive.
 */
export function filterProjectTree(nodes: readonly ProjectTreeNode[], query: string): ProjectTreeNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...nodes];
  return nodes.flatMap((node) => {
    if (node.project.name.toLowerCase().includes(q)) return [node];
    const initiatives = node.initiatives.filter((b) => b.name.toLowerCase().includes(q));
    return initiatives.length > 0 ? [{ project: node.project, initiatives }] : [];
  });
}

/**
 * The page path (portal ADR-011 zone 2; TASK-3958): the project and the
 * initiative a project, initiative or task page sits in, for the top bar's
 * Plan / project / initiative. Null on every other page, or when the page's
 * record is not loaded.
 */
export interface PagePath {
  project: Project | null;
  initiative: Bucket | null;
}

export function pagePath(
  route: Route,
  find: {
    project: (id: string) => Project | undefined;
    initiative: (id: string) => Bucket | undefined;
    task: (id: string) => Task | undefined;
  }
): PagePath | null {
  const initiativeId =
    route.screen === "bucket" ? route.bucketId : route.screen === "task" && route.taskId ? find.task(route.taskId)?.bucket : undefined;
  const initiative = initiativeId ? (find.initiative(initiativeId) ?? null) : null;
  const projectId = route.screen === "project" ? route.projectId : (initiative?.project ?? undefined);
  const project = projectId ? (find.project(projectId) ?? null) : null;
  if (route.screen === "project") return project ? { project, initiative: null } : null;
  if (route.screen !== "bucket" && route.screen !== "task") return null;
  return project || initiative ? { project, initiative } : null;
}

export interface OpenTaskCounts {
  byInitiative: Map<string, number>;
  byProject: Map<string, number>;
}

/**
 * Open tasks (every stage but merged, verified and cancelled) per initiative,
 * and per project across its initiatives: the sidebar's count column
 * (portal ADR-011 v2, Counts). Pass every initiative, so a project counts
 * tasks in all of its own.
 */
export function openTaskCounts(tasks: readonly Task[], initiatives: readonly Bucket[]): OpenTaskCounts {
  const projectOf = new Map(initiatives.map((b) => [b.id, b.project ?? null]));
  const byInitiative = new Map<string, number>();
  const byProject = new Map<string, number>();
  for (const task of tasks) {
    if (isClosedStage(task.stage)) continue;
    byInitiative.set(task.bucket, (byInitiative.get(task.bucket) ?? 0) + 1);
    const projectId = projectOf.get(task.bucket);
    if (projectId) byProject.set(projectId, (byProject.get(projectId) ?? 0) + 1);
  }
  return { byInitiative, byProject };
}

// ─── Sidebar keys (zoned sidebar, TASK-3955) ────────────────────────────────
// The zoned sidebar is one keyboard tree (portal ADR-011 v2, Keys 4–7): one
// tab stop, ↑ ↓ Home End between rows, → opens a group or enters it, ← closes
// it or goes up to its parent, and a letter jumps to the next row starting
// with it. The sidebar reads its shown rows from the page in order and acts
// on what this returns.

export interface TreeRow {
  key: string;
  /** The group row it sits under, if any. */
  parent: string | null;
  /** A group row's state; null for a row that holds nothing. */
  open: boolean | null;
  label: string;
}

export type TreeAction = { focus: number } | { toggle: number } | null;

export function treeKeyAction(rows: readonly TreeRow[], index: number, key: string): TreeAction {
  const row = rows[index];
  if (!row) return null;
  const last = rows.length - 1;
  switch (key) {
    case "ArrowDown":
      return index < last ? { focus: index + 1 } : null;
    case "ArrowUp":
      return index > 0 ? { focus: index - 1 } : null;
    case "Home":
      return { focus: 0 };
    case "End":
      return { focus: last };
    case "ArrowRight": {
      if (row.open === false) return { toggle: index };
      if (row.open !== true) return null;
      const child = rows.findIndex((r, i) => i > index && r.parent === row.key);
      return child >= 0 ? { focus: child } : null;
    }
    case "ArrowLeft": {
      if (row.open === true) return { toggle: index };
      const parent = row.parent === null ? -1 : rows.findIndex((r) => r.key === row.parent);
      return parent >= 0 ? { focus: parent } : null;
    }
  }
  if (key.length !== 1 || !/\S/.test(key)) return null;
  const letter = key.toLowerCase();
  for (let step = 1; step <= rows.length; step++) {
    const at = (index + step) % rows.length;
    if (rows[at].label.trim().toLowerCase().startsWith(letter)) return { focus: at };
  }
  return null;
}

// ─── Starred (zoned sidebar, TASK-3842; v2, TASK-3956) ──────────────────────
// Copies of the screens, reports, projects and initiatives a person starred, at
// most STAR_CAP (10), in their order, kept on the server (src/lib/stars). A copy
// is never the lit row; the item's own row is. Screens carry their zoned label,
// and Board, List and Timeline are one All work star. Each star keeps its slot,
// and g then its digit opens it (1 to 9, 0 for the tenth). A closed, archived or
// deleted project or initiative stays, marked, until the person removes it
// (portal ADR-011 v2, Starred 6); a full list refuses a new star. A screen
// behind an off flag does not show, but keeps its slot: flags can differ
// between devices.

export interface StarRow {
  key: StarKey;
  label: string;
  target: Route;
  /** The kind's icon: a screen's own, or a project's or initiative's. */
  lucide: NavIconName;
  /** Its place in the person's list, 0 to 9. */
  slot: number;
  /** Still opens, but closed or archived; or gone: its record was deleted, so only Remove. */
  mark?: "closed" | "archived" | "gone";
}

/** The key after g that opens the star in `slot`: 1 to 9, then 0 for the tenth. */
export function starDigit(slot: number): string {
  return String((slot + 1) % 10);
}

/** The slot g then `digit` opens; null for anything but 0 to 9. */
export function starSlotOf(digit: string): number | null {
  return /^[0-9]$/.test(digit) ? (Number(digit) + 9) % 10 : null;
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
 * initiative (allProjects, allBuckets): a closed or archived one shows marked.
 * With `live` records, a star whose record or screen is gone shows as gone, so
 * the person can remove it; seed or cached records would make real ones look
 * gone, so until then it does not show. A screen behind an off flag never shows.
 */
export function starRows(
  stars: readonly string[],
  projects: readonly Project[],
  initiatives: readonly Bucket[],
  flags: NavFlags,
  live = true
): StarRow[] {
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const initiativeById = new Map(initiatives.map((b) => [b.id, b]));
  return stars.flatMap((stored, slot): StarRow[] => {
    const key = stored as StarKey;
    const { kind, id } = splitStar(key);
    const gone = (target: Route, lucide: NavIconName): StarRow[] =>
      live ? [{ key, label: id || key, target, lucide, slot, mark: "gone" }] : [];
    if (kind === "project") {
      const project = projectById.get(id);
      const target: Route = { screen: "project", projectId: id };
      if (!project) return gone(target, "FolderKanban");
      const mark = isProjectClosed(project) ? "closed" : isArchived(project) ? "archived" : undefined;
      return [{ key, label: project.name, target, lucide: "FolderKanban", slot, ...(mark ? { mark } : {}) }];
    }
    if (kind === "bucket") {
      const initiative = initiativeById.get(id);
      const target: Route = { screen: "bucket", bucketId: id };
      if (!initiative) return gone(target, "Layers");
      return [{ key, label: initiative.name, target, lucide: "Layers", slot, ...(isArchived(initiative) ? { mark: "archived" as const } : {}) }];
    }
    const item = kind === "screen" ? STAR_SCREENS.get(id as Screen) : undefined;
    if (!item) return gone({ screen: "home" }, "File");
    return !item.flag || flags[item.flag]
      ? [{ key, label: item.label, target: { screen: item.screen }, lucide: item.lucide, slot }]
      : [];
  });
}

/**
 * The change that stars or unstars `key`: unstarring removes it, starring adds
 * it last. Null when STAR_CAP stars are kept: a full list refuses a new star
 * (portal ADR-011 v2, Starred 7), and a gone star keeps its slot until removed.
 */
export function starChanges(stars: readonly string[], key: StarKey): StarChange[] | null {
  if (stars.includes(key)) return [{ op: "remove", key }];
  return stars.length < STAR_CAP ? [{ op: "add", key }] : null;
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

/** ⌘K "Go to …" commands for every visible item, plus its search synonyms; the zoned shell adds Projects. */
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
// sidebar's Projects row, which opens the project Dashboard (TASK-3841, TASK-3996).
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

/** The zoned tabs' memory (TASK-3843): Projects (the project Dashboard) is a landing spot; detail screens are not. */
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
