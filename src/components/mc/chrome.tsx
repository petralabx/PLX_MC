// Mission Control chrome shared by every screen: the Sidebar (one element that
// mc-shell.css renders as the phone drawer, the tablet rail and the desktop
// sidebar — ADR-005), the nav counts every nav surface shows, the offline
// banner and the notice toasts. The top bar lives in top-bar.tsx; the phone
// tabs, strip and FAB in bottom-tabs.tsx; the More sheet in more-sheet.tsx.
// Counts come from the runtime store so badges stay live after store actions.
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { ChevronRight, GripVertical, PanelLeft, Plus, Search, Star, X } from "lucide-react";

import { liveAgentCount, openQuestionsFor, pendingApprovalGates, type Human, type Task } from "@/lib/mc-data";
import { STAR_CAP, type StarKey } from "@/lib/stars";
import { useMcNotices, useMcVersion, useViewer } from "@/lib/mc-data/hooks";
import {
  allBuckets,
  allTasks,
  bucketById,
  closedNavProjects,
  dataSource,
  dismissNotice,
  hydrate,
  navBuckets,
  navProjects,
  storeSyncCounts,
  unreadCount,
  viewerSettled,
} from "@/lib/mc-data/store";

import { CountBadge, CountFigure, OpenCount, UNKNOWN_COUNT, type Count } from "./count-badge";
import { navFlags } from "./nav-flags";
import { NavIcon } from "./nav-icon";
import {
  HELP_NAV_ITEM,
  byName,
  createNavGroupState,
  filterProjectTree,
  isNavItemCurrent,
  isPlainLeftClick,
  navGroupOf,
  navHref,
  navItemTarget,
  nextDrawerOpen,
  openTaskCounts,
  projectTree,
  revealScrollTop,
  starDigit,
  starKeyOf,
  treeKeyAction,
  visibleAdminFlyout,
  visibleNavGroups,
  visibleZonedNavGroups,
  zonedNavPlaceOf,
  type DrawerEvent,
  type NavBadge,
  type NavGroupId,
  type NavItem,
  type NavList,
  type StarRow,
  type TreeRow,
} from "./nav-model";
import { useNavZones } from "./nav-zones";
import { needsMeCount, todayGridDay, viewerLoadState } from "./needs-me";
import type { Nav, Route } from "./route";
import { useFlyout } from "./use-flyout";
import { hasOpenLayer, useLayer } from "./use-layer";
import { RailLabel, SideResize } from "./side-resize";
import { StarToggle } from "./star-toggle";
import { useStars } from "./use-stars";
import { useVendorAlertCount } from "./vendor-spend/use-alert-badge";

export type NavCounts = Partial<Record<NavBadge, Count>>;

const noClockSubscribe = () => () => {};

/**
 * The Approvals badge: pending runtime approval gates on the tasks this viewer
 * can see, plus the open questions addressed to them (TASK-3567). Its screen
 * reads GET /api/approvals and /api/questions, different sources, so a count
 * is a lower bound, never exact. Unknown ("—") until the store is live. Until
 * the viewer is known, questions cannot be counted: gates alone show as "n+",
 * and none reads "—". Once both are known it is an attention badge, hidden
 * while nothing waits (TASK-3837), where a lower bound of 0 read "—".
 */
export function approvalsBadge(loaded: boolean, viewer: Pick<Human, "id"> | null, tasks: readonly Task[]): Count | undefined {
  if (!loaded) return UNKNOWN_COUNT;
  const gates = tasks.reduce((n, t) => n + pendingApprovalGates(t).length, 0);
  if (!viewer) return gates > 0 ? { n: gates, exact: false } : UNKNOWN_COUNT;
  const waiting = gates + tasks.reduce((n, t) => n + openQuestionsFor(t, viewer.id).length, 0);
  return waiting > 0 ? { n: waiting, exact: false } : undefined;
}

/**
 * Every nav badge, computed once per shell so the sidebar, rail, tabs and
 * More sheet always agree. A count is known only once the server has answered
 * (dataSource "live"); before that — seed fixtures, or the offline fallback
 * showing cached or demo data — it is "—", never a fabricated or "confirmed"
 * 0. Attention badges (sync, AI spend, and Approvals once live) stay hidden
 * until they have something to say.
 */
export function useNavCounts(): NavCounts {
  useMcVersion();
  const viewer = useViewer();
  // Client clock only (null on the server) so SSR and hydration agree.
  const today = useSyncExternalStore(noClockSubscribe, () => todayGridDay(new Date()), () => null);
  const vendorAlerts = useVendorAlertCount();
  const loaded = dataSource() === "live";
  const tasks = allTasks();
  const sc = storeSyncCounts();
  const conflicts = sc.conflict + sc.error;

  // Home badge: what the store can say needs this viewer (Home's needs-me
  // rules) plus unread notifications. Home itself reads approvals (GET
  // /api/approvals) and routing proposals from their own endpoints, so from
  // the store alone this is a lower bound; PR 2 (needs-me exactness) makes it
  // exact.
  const needs: Count =
    loaded && viewer && today !== null && viewerLoadState(viewer, viewerSettled()) === "ready"
      ? { n: needsMeCount(viewer, tasks, today, sc) + unreadCount(), exact: false }
      : UNKNOWN_COUNT;

  return {
    needs,
    approvals: approvalsBadge(loaded, viewer, tasks),
    sync: loaded && conflicts > 0 ? { n: conflicts, exact: true, tone: "warn" } : undefined,
    // Honest live-agent count: agents executing in-flight work (EN-005).
    agents: loaded ? { n: liveAgentCount(tasks), exact: true, unit: "live" } : UNKNOWN_COUNT,
    "ai-spend": vendorAlerts ? { n: vendorAlerts, exact: true, tone: "warn" } : undefined,
  };
}

// The nav drawer: the phone drawer (opened from More → All screens) and the
// tablet rail's labelled expansion. Same dismiss contract as before
// (nextDrawerOpen): the toggle, the close button, Esc, the scrim and any nav
// item. use-layer.ts owns Esc, focus in/back, Tab wrap and the scroll lock.
export function useNavDrawer() {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLElement | null>(null);
  const send = useCallback((event: DrawerEvent) => setOpen((prev) => nextDrawerOpen(prev, event)), []);
  const close = useCallback(() => send("escape"), [send]);
  const { onKeyDown } = useLayer(open, close, panelRef);

  // ≥1025 the same element is the fixed sidebar: a drawer left open while the
  // window widens must not keep the page scroll-locked.
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1025px)");
    const onChange = () => {
      if (desktop.matches) send("close");
    };
    desktop.addEventListener("change", onChange);
    return () => desktop.removeEventListener("change", onChange);
  }, [send]);

  return { open, send, panelRef, onKeyDown };
}

// Admin & health's expanded state — remembered per browser (nav-model.ts
// holds the storage + in-memory fallback). The server snapshot is "collapsed"
// so SSR and the hydrating render agree.
const navGroupState = createNavGroupState(() =>
  typeof window === "undefined" ? null : window.localStorage
);

function useNavGroupOpen(id: NavGroupId): boolean {
  return useSyncExternalStore(
    navGroupState.subscribe,
    () => navGroupState.isOpen(id),
    () => false
  );
}

// The zoned sidebar's Admin & health flyout (TASK-3840): use-flyout.ts.
const ADMIN_FLYOUT_ID = "mc-nav-admin-flyout";
// The menu behind the Projects row's + (TASK-3955): New project, New initiative.
const NEW_MENU_ID = "mc-nav-new-menu";
// The collapsed rail's Projects flyout (TASK-3957): every active project and the filter.
const PROJECTS_FLYOUT_ID = "mc-nav-projects-flyout";

// The zoned sidebar is one keyboard tree (TASK-3955, portal ADR-011 v2 Keys):
// every row carries data-tree-key, a group row data-tree-open, a row inside a
// group data-tree-parent, and the control that opens a group or a row's menu
// data-tree-toggles or data-tree-menu-for. One row is in the Tab order.
interface TreeAttrs {
  "data-tree-key"?: string;
  "data-tree-parent"?: string;
  "data-tree-open"?: "true" | "false";
  /** A project link's own disclosure state: → and ← open it with focus on the link. */
  "aria-expanded"?: boolean;
  /** What Shift S stars or unstars from this row (TASK-3956). */
  "data-star-key"?: string;
  /** A starred copy's slot: Alt with ↑ or ↓ moves it. */
  "data-star-slot"?: number;
  tabIndex?: number;
}

// What a starred copy's mark says (portal ADR-011 v2, Starred 6).
const STAR_MARK: Record<NonNullable<StarRow["mark"]>, string> = {
  closed: "closed",
  archived: "archived",
  gone: "deleted",
};
// The drag type a starred copy carries while it is moved.
const STAR_DRAG = "application/x-mc-star";

function shownTreeRows(side: HTMLElement): HTMLElement[] {
  return Array.from(side.querySelectorAll<HTMLElement>("[data-tree-key]")).filter((el) => el.getClientRects().length > 0);
}

function treeRowOf(el: HTMLElement): TreeRow {
  return {
    key: el.dataset.treeKey ?? "",
    parent: el.dataset.treeParent ?? null,
    open: el.dataset.treeOpen === undefined ? null : el.dataset.treeOpen === "true",
    label: el.querySelector(".nm")?.textContent ?? el.textContent ?? "",
  };
}

function treeControl(side: HTMLElement, attr: "data-tree-toggles" | "data-tree-menu-for", key: string): HTMLElement | null {
  return side.querySelector<HTMLElement>(`[${attr}="${CSS.escape(key)}"]`);
}

export function Sidebar({
  route,
  nav,
  counts,
  onNewProject,
  onNewInitiative,
  drawerOpen = false,
  onDrawer,
  drawerRef,
  onDrawerKeyDown,
}: {
  route: Route;
  nav: Nav;
  counts: NavCounts;
  onNewProject: () => void;
  onNewInitiative: () => void;
  /** Below 1025px the sidebar is the drawer panel (see useNavDrawer). */
  drawerOpen?: boolean;
  onDrawer?: (event: DrawerEvent) => void;
  drawerRef?: RefObject<HTMLElement | null>;
  onDrawerKeyDown?: (event: ReactKeyboardEvent<HTMLElement>) => void;
}) {
  const version = useMcVersion();
  const zoned = useNavZones();
  const flags = navFlags();
  const stars = useStars(zoned);
  const [treeOpen, setTreeOpen] = useState<Record<string, boolean>>({});
  const [closedOpen, setClosedOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [treeStop, setTreeStop] = useState<string | null>(null);
  const filterRef = useRef<HTMLInputElement | null>(null);
  const adminOpen = useNavGroupOpen("admin");
  const knowledgeOpen = useNavGroupOpen("knowledge");
  const {
    toggleRef: flyoutToggleRef,
    panelRef: flyoutRef,
    open: flyoutOpen,
    hide: hideFlyout,
    onBlur: onFlyoutBlur,
    onBeforeToggle: onFlyoutBeforeToggle,
    onToggle: onFlyoutToggle,
  } = useFlyout(navHref(route), "beside-nav");
  const {
    toggleRef: newToggleRef,
    panelRef: newPanelRef,
    open: newOpen,
    hide: hideNew,
    onBlur: onNewBlur,
    onBeforeToggle: onNewBeforeToggle,
    onToggle: onNewToggle,
  } = useFlyout(navHref(route), "below");
  const {
    toggleRef: projectsToggleRef,
    panelRef: projectsPanelRef,
    open: projectsOpen,
    hide: hideProjects,
    onBlur: onProjectsBlur,
    onBeforeToggle: onProjectsBeforeToggle,
    onToggle: onProjectsToggle,
  } = useFlyout(navHref(route), "beside-nav");
  const [flyFilter, setFlyFilter] = useState("");

  // Keep the active screen visible: arriving on a screen in the collapsible
  // group (Admin & health; Knowledge in the zoned sidebar) expands it. The
  // zoned flyout never opens itself: it opens on click (ADR-011).
  useEffect(() => {
    const collapsible: NavGroupId = zoned ? "knowledge" : "admin";
    const holding = zoned ? zonedNavPlaceOf(route.screen) : navGroupOf(route.screen);
    if (holding === collapsible && !navGroupState.isOpen(collapsible)) {
      navGroupState.setOpen(collapsible, true);
    }
  }, [route.screen, zoned]);

  // …and keep the current row in view (TASK-3837): a deep link to a project or
  // initiative low in the list scrolls the labelled list itself (the desktop
  // sidebar, or an open drawer), never the page or the icon rail. Once per
  // current row and form, so a manual scroll stays and opening a task pane does
  // not move it. Not on seed data (the live lists move the rows) and not before
  // the row is laid out (Admin & health opens a render later). A screen with no
  // current row re-arms it.
  const revealKey = `${route.screen}:${route.projectId ?? ""}:${route.bucketId ?? ""}:${drawerOpen ? "drawer" : "side"}`;
  const revealedFor = useRef<string | null>(null);
  useEffect(() => {
    if (dataSource() === "seed") return;
    const row = document.querySelector<HTMLElement>('#mc-nav .item[aria-current="page"]');
    if (!row) {
      revealedFor.current = null;
      return;
    }
    // The zoned footer's rows (Help) are always in view.
    if (row.closest(".side-foot")) return;
    const labelled = drawerOpen || window.matchMedia("(min-width: 1025px)").matches;
    const side = row.closest<HTMLElement>("#mc-nav");
    if (!labelled || !side || revealedFor.current === revealKey || row.getClientRects().length === 0) return;
    revealedFor.current = revealKey;
    // In the drawer forms the sticky head covers the top of the list; in the
    // zoned sidebar the sticky footer covers its bottom.
    const view = side.getBoundingClientRect();
    const head = side.querySelector<HTMLElement>(".side-head");
    const foot = side.querySelector<HTMLElement>(".side-foot");
    const top = head && head.getClientRects().length > 0 ? head.getBoundingClientRect().bottom : view.top;
    const bottom = foot ? foot.getBoundingClientRect().top : view.bottom;
    side.scrollTop = revealScrollTop({ top, bottom }, row.getBoundingClientRect(), side.scrollTop);
  });

  // An initiative page also lights its parent project (TASK-3837). The
  // initiative keeps the one aria-current; the project row is only on-path.
  const openProjectId =
    route.screen === "bucket" && route.bucketId ? (bucketById(route.bucketId)?.project ?? null) : null;
  // The zoned sidebar's Projects tree (TASK-3841) keeps this project in its
  // rows and opens it.
  const currentProjectId = route.screen === "project" ? (route.projectId ?? null) : openProjectId;
  // v2 (TASK-3955, portal ADR-011 v2 Lists): every active project A to Z, the
  // filter's matches while it holds a query, then the closed projects behind
  // the Closed row. The count column shows each one's open tasks.
  // Once per store change, not per render: arrow keys re-render the sidebar.
  const live = dataSource() === "live";
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tree = useMemo(() => (zoned ? projectTree(navProjects(), navBuckets()) : []), [zoned, version]);
  const filtering = filter.trim() !== "";
  const shownTree = filtering ? filterProjectTree(tree, filter) : tree;
  const flyFiltering = flyFilter.trim() !== "";
  const flyTree = flyFiltering ? filterProjectTree(tree, flyFilter) : tree;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const closedProjects = useMemo(() => (zoned ? closedNavProjects().sort(byName) : []), [zoned, version]);
  // Counts only from live data: cached or demo tasks would make them up
  // (useNavCounts's rule).
  const openCounts = useMemo(
    () => (zoned ? openTaskCounts(live ? allTasks() : [], allBuckets()) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [zoned, live, version]
  );

  // Arriving on a project or one of its initiatives opens it (a closed one
  // opens the Closed row); after that it keeps the person's choice, like
  // Knowledge and Admin & health (ADR-011). Adjusted while rendering: React's
  // pattern for state that follows a prop.
  const arrival = zoned && currentProjectId ? `${currentProjectId} ${route.screen} ${route.bucketId ?? ""}` : null;
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  if (arrival !== openedOn) {
    setOpenedOn(arrival);
    if (currentProjectId && arrival) {
      if (closedProjects.some((p) => p.id === currentProjectId)) {
        if (!closedOpen) setClosedOpen(true);
      } else if (!treeOpen[currentProjectId]) {
        setTreeOpen((prev) => ({ ...prev, [currentProjectId]: true }));
      }
    }
  }

  // One tab stop for the tree (portal ADR-011 v2, Keys 4): the row the
  // person focused last, else the current row, else the first. A focused row
  // that is no longer shown (its group closed, or the rail hides it) gives
  // way, and the stop follows the current row again.
  const stopChosen = useRef(false);
  // When Shift F10 or the Menu key last opened a row menu (onTreeKeyDown).
  const menuKeyAt = useRef(Number.NEGATIVE_INFINITY);
  // A starred copy moved with Alt and an arrow keeps focus in its new place.
  const refocusKey = useRef<string | null>(null);
  useEffect(() => {
    const key = refocusKey.current;
    if (!key) return;
    refocusKey.current = null;
    const row = document.querySelector<HTMLElement>(`#mc-nav [data-tree-key="${CSS.escape(key)}"]`);
    if (row && row !== document.activeElement) row.focus();
  });
  // The slot a dragged starred copy would drop into.
  const [dropSlot, setDropSlot] = useState<number | null>(null);
  const keepTreeStop = useCallback(() => {
    const side = zoned ? document.getElementById("mc-nav") : null;
    if (!side) return;
    const rows = shownTreeRows(side);
    const stop = rows.find((el) => el.tabIndex === 0);
    if (stop && stopChosen.current) return;
    if (!stop) stopChosen.current = false;
    const next = rows.find((el) => el.getAttribute("aria-current") === "page") ?? stop ?? rows[0];
    if (next && next !== stop) setTreeStop(next.dataset.treeKey ?? null);
  }, [zoned]);
  // Whether a row is shown is layout React cannot see, so the check runs
  // after each commit; it sets state only when the stop must move, and the
  // next render puts it there, so it settles in one pass.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => keepTreeStop());
  useEffect(() => {
    if (!zoned) return;
    const forms = ["(min-width: 641px)", "(min-width: 1025px)"].map((query) => window.matchMedia(query));
    for (const form of forms) form.addEventListener("change", keepTreeStop);
    return () => {
      for (const form of forms) form.removeEventListener("change", keepTreeStop);
    };
  }, [zoned, keepTreeStop]);

  // `/` focuses the page's own filter where it has one (work-views.tsx), else
  // the Projects filter (portal ADR-011 v2, Keys 2). Never from a field or
  // the tree, nor while a layer owns the keyboard.
  useEffect(() => {
    if (!zoned) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest?.("input,textarea,[contenteditable],[data-tree-key]") || hasOpenLayer()) return;
      if (document.querySelector("[data-page-filter]")) return;
      const input = filterRef.current;
      // Not while the closed phone drawer hides it (visibility: hidden).
      if (!input || input.getClientRects().length === 0 || getComputedStyle(input).visibility === "hidden") return;
      event.preventDefault();
      input.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [zoned]);

  // A row's tree attributes: zoned only, so the classic sidebar keeps its
  // plain links in the Tab order.
  const treeRow = (key: string, parent: string | null = null, open: boolean | null = null): TreeAttrs =>
    zoned
      ? {
          "data-tree-key": key,
          "data-tree-parent": parent ?? undefined,
          "data-tree-open": open === null ? undefined : open ? "true" : "false",
          tabIndex: key === treeStop ? 0 : -1,
        }
      : {};

  const onTreeKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    const row = event.target as HTMLElement;
    const key = row.dataset?.treeKey;
    if (!key || event.ctrlKey || event.metaKey) return;
    // Alt with ↑ or ↓ moves a starred copy (portal ADR-011 v2, Starred 5).
    const starKey = row.dataset.starKey;
    if (event.altKey) {
      const slot = row.dataset.starSlot === undefined ? NaN : Number(row.dataset.starSlot);
      if (!starKey || Number.isNaN(slot) || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
      event.preventDefault();
      const to = slot + (event.key === "ArrowUp" ? -1 : 1);
      if (to < 0 || to >= stars.count) return;
      refocusKey.current = key;
      stars.move(starKey, to);
      return;
    }
    // Shift S stars or unstars the focused row (Starred 4).
    if (event.shiftKey && event.key.toLowerCase() === "s") {
      if (!starKey || stars.off) return;
      event.preventDefault();
      stars.toggle(starKey as StarKey);
      return;
    }
    const side = event.currentTarget;
    // The row menu (portal ADR-011 v2, Keys 7): the Projects row's + menu.
    if ((event.key === "F10" && event.shiftKey) || event.key === "ContextMenu") {
      const menu = treeControl(side, "data-tree-menu-for", key);
      // The icon rail hides the +: nothing to place the menu under.
      if (!menu || menu.getClientRects().length === 0) return;
      event.preventDefault();
      // Some browsers still fire contextmenu for these keys: the nav drops it.
      menuKeyAt.current = event.timeStamp;
      menu.click();
      document.getElementById(menu.getAttribute("aria-controls") ?? "")?.querySelector<HTMLElement>("button, a[href]")?.focus();
      return;
    }
    // Shift and a letter stays free for Shift S (TASK-3956).
    if (event.shiftKey && event.key.length === 1) return;
    const rows = shownTreeRows(side);
    const action = treeKeyAction(rows.map(treeRowOf), rows.indexOf(row), event.key);
    if (!action) return;
    event.preventDefault();
    if ("focus" in action) rows[action.focus].focus();
    else treeControl(side, "data-tree-toggles", rows[action.toggle].dataset.treeKey ?? "")?.click();
  };

  // ↓ from the filter enters the tree; Esc clears a query first.
  const onFilterKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    if (event.key === "ArrowDown") {
      const side = input.closest<HTMLElement>("#mc-nav");
      const next = side
        ? shownTreeRows(side).find((el) => input.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)
        : undefined;
      if (next) {
        event.preventDefault();
        next.focus();
      }
    } else if (event.key === "Escape" && filter) {
      event.preventDefault();
      setFilter("");
    }
  };

  // Items are real links (open in a new tab, copy the URL); a plain click stays
  // a client-side nav() so screens switch without a reload.
  const link = (
    key: string,
    target: Route,
    active: boolean,
    label: string,
    body: ReactNode,
    onPath = false,
    tree: TreeAttrs = {}
  ) => (
    <a
      key={key}
      {...tree}
      href={navHref(target)}
      className={`item${active ? " active" : onPath ? " on-path" : ""}`}
      aria-current={active ? "page" : undefined}
      title={label}
      onClick={(event) => {
        if (!isPlainLeftClick(event)) return;
        event.preventDefault();
        const { screen, ...extra } = target;
        nav(screen, extra);
        onDrawer?.("navigate");
      }}
    >
      {body}
    </a>
  );

  const newProjectButton = (
    <button
      type="button"
      className="item side-new-initiative"
      onClick={() => {
        hideNew();
        onDrawer?.("navigate");
        onNewProject();
      }}
    >
      <Plus className="ic" aria-hidden="true" focusable="false" strokeWidth={1.5} />
      <span className="nm">New project</span>
    </button>
  );
  const newInitiativeButton = (
    <button
      type="button"
      className="item side-new-initiative"
      onClick={() => {
        hideNew();
        onDrawer?.("navigate");
        onNewInitiative();
      }}
    >
      <Plus className="ic" aria-hidden="true" focusable="false" strokeWidth={1.5} />
      <span className="nm">New initiative</span>
    </button>
  );

  // A row's star (portal ADR-011 v2, Row grid 5): in its action column, out of
  // the Tab order, shown on hover and focus and always on touch; Shift S does
  // the same from the keyboard. The row and its star share one wrapper, since a
  // button cannot sit inside a link.
  const withStar = (row: ReactNode, wrapKey: string, starKey: StarKey | null, label: string) =>
    zoned && starKey && !stars.off ? (
      <div className="tree-row" key={wrapKey}>
        {row}
        <StarToggle stars={stars} starKey={starKey} label={label} className="row-act star-act" tabIndex={-1} />
      </div>
    ) : (
      row
    );

  const lists: Record<NavList, ReactNode> = {
    projects: (
      <div className="sub" role="group" aria-labelledby="mc-nav-h-projects" key="projects">
        <div className="h" id="mc-nav-h-projects">
          Projects
        </div>
        {navProjects().map((p) =>
          link(
            `project:${p.id}`,
            { screen: "project", projectId: p.id },
            route.screen === "project" && route.projectId === p.id,
            p.name,
            <>
              <span className={`hl ${p.health}`} aria-hidden="true" />
              <span className="nm">{p.name}</span>
            </>,
            p.id === openProjectId
          )
        )}
        {newProjectButton}
      </div>
    ),
    initiatives: (
      <div className="sub" role="group" aria-labelledby="mc-nav-h-initiatives" key="initiatives">
        <div className="h" id="mc-nav-h-initiatives">
          Initiatives
        </div>
        {navBuckets().map((b) =>
          link(
            `bucket:${b.id}`,
            { screen: "bucket", bucketId: b.id },
            route.screen === "bucket" && route.bucketId === b.id,
            b.name,
            <>
              <span className={`hl ${b.health}`} aria-hidden="true" />
              <span className="nm">{b.name}</span>
            </>
          )
        )}
        {newInitiativeButton}
      </div>
    ),
    // The filter, every active project with a disclosure for its initiatives,
    // then the Closed row. The current project starts open; while the filter
    // holds a query its matches show open.
    "project-tree": openCounts ? (
      <div className="tree" role="group" aria-label="Projects" key="project-tree">
        <div className="tree-filter">
          <Search className="ic" aria-hidden="true" focusable="false" strokeWidth={1.5} />
          <input
            ref={filterRef}
            type="search"
            className="tree-q"
            aria-label="Filter projects and initiatives"
            placeholder="Filter projects"
            autoComplete="off"
            spellCheck={false}
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            onKeyDown={onFilterKeyDown}
          />
        </div>
        <p className="tree-none" role="status">
          {filtering && shownTree.length === 0 ? "No project or initiative matches." : ""}
        </p>
        {shownTree.map(({ project, initiatives }) => {
          const key = `project:${project.id}` as const;
          const bodyId = `mc-nav-tree-${project.id}`;
          const holds = initiatives.length > 0;
          const expanded = filtering || treeOpen[project.id] === true;
          return (
            <div className="tree-node" key={project.id}>
              <div className="tree-row">
                {link(
                  key,
                  { screen: "project", projectId: project.id },
                  route.screen === "project" && route.projectId === project.id,
                  project.name,
                  <>
                    <span className="nm">{project.name}</span>
                    <OpenCount n={openCounts.byProject.get(project.id) ?? 0} health={project.health} />
                  </>,
                  project.id === openProjectId,
                  {
                    ...(holds && !filtering ? { ...treeRow(key, null, expanded), "aria-expanded": expanded } : treeRow(key)),
                    "data-star-key": key,
                  }
                )}
                {holds && !filtering ? (
                  <button
                    type="button"
                    className="tree-toggle"
                    tabIndex={-1}
                    aria-expanded={expanded}
                    aria-controls={bodyId}
                    aria-label={`Initiatives in ${project.name}`}
                    data-tree-toggles={key}
                    onClick={() => setTreeOpen((prev) => ({ ...prev, [project.id]: !expanded }))}
                  >
                    <ChevronRight className="chev" aria-hidden="true" focusable="false" strokeWidth={2} />
                  </button>
                ) : null}
                {stars.off ? null : (
                  <StarToggle stars={stars} starKey={key} label={project.name} className="row-act star-act" tabIndex={-1} />
                )}
              </div>
              {holds ? (
                <div id={bodyId} className="tree-kids" hidden={!expanded}>
                  {initiatives.map((b) =>
                    withStar(
                      link(
                        `bucket:${b.id}`,
                        { screen: "bucket", bucketId: b.id },
                        route.screen === "bucket" && route.bucketId === b.id,
                        b.name,
                        <>
                          <span className="guide" aria-hidden="true" />
                          <span className="nm">{b.name}</span>
                          <OpenCount n={openCounts.byInitiative.get(b.id) ?? 0} health={b.health} />
                        </>,
                        false,
                        { ...treeRow(`bucket:${b.id}`, key), "data-star-key": `bucket:${b.id}` }
                      ),
                      `bucket:${b.id}`,
                      `bucket:${b.id}`,
                      b.name
                    )
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
        {!filtering && closedProjects.length > 0 ? (
          <div className="tree-closed">
            <button
              type="button"
              className="item"
              {...treeRow("closed", null, closedOpen)}
              data-tree-toggles="closed"
              aria-expanded={closedOpen}
              aria-controls="mc-nav-closed"
              onClick={() => setClosedOpen((prev) => !prev)}
            >
              <ChevronRight className="chev" aria-hidden="true" focusable="false" strokeWidth={2} />
              <span className="nm">Closed</span>
              <span className="cnt">
                <span aria-hidden="true">{closedProjects.length}</span>
                <span className="vh">
                  , {closedProjects.length} project{closedProjects.length === 1 ? "" : "s"}
                </span>
              </span>
            </button>
            <div id="mc-nav-closed" className="tree-kids" hidden={!closedOpen}>
              {closedProjects.map((p) =>
                withStar(
                  link(
                    `closed:${p.id}`,
                    { screen: "project", projectId: p.id },
                    route.screen === "project" && route.projectId === p.id,
                    p.name,
                    <>
                      <span className="guide" aria-hidden="true" />
                      <span className="nm">{p.name}</span>
                    </>,
                    false,
                    { ...treeRow(`closed:${p.id}`, "closed"), "data-star-key": `project:${p.id}` }
                  ),
                  `closed:${p.id}`,
                  `project:${p.id}`,
                  p.name
                )
              )}
            </div>
          </div>
        ) : null}
      </div>
    ) : null,
  };

  // Starred (TASK-3842; v2, TASK-3956): copies in the person's order, right
  // after My work, never the lit row. Each shows its kind, the digit g opens it
  // with, and its star; a closed, archived or deleted one is marked and keeps
  // its slot until removed. Drag a copy, or press Alt with ↑ or ↓, to move it.
  // The icon rail shows one Starred button instead, which opens the labelled drawer.
  const starCopy = (row: StarRow) => {
    const treeKey = `star:${row.key}`;
    const digit = starDigit(row.slot);
    const gone = row.mark === "gone";
    return (
      <div
        className={`tree-row star-row${row.mark ? ` ${row.mark}` : ""}${dropSlot === row.slot ? " drop" : ""}`}
        key={treeKey}
        onDragStart={(event) => {
          event.dataTransfer.setData(STAR_DRAG, row.key);
          event.dataTransfer.effectAllowed = "move";
        }}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes(STAR_DRAG)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          if (dropSlot !== row.slot) setDropSlot(row.slot);
        }}
        onDragLeave={() => setDropSlot(null)}
        onDragEnd={() => setDropSlot(null)}
        onDrop={(event) => {
          const moved = event.dataTransfer.getData(STAR_DRAG);
          setDropSlot(null);
          if (!moved) return;
          event.preventDefault();
          stars.move(moved, row.slot);
        }}
      >
        {link(
          treeKey,
          row.target,
          false,
          row.mark ? `${row.label} (${STAR_MARK[row.mark]})` : row.label,
          <>
            <NavIcon name={row.lucide} />
            <GripVertical className="grip" aria-hidden="true" focusable="false" strokeWidth={1.5} />
            <span className="nm">
              {row.label}
              {row.mark ? <span className="mark"> · {STAR_MARK[row.mark]}</span> : null}
            </span>
            {gone ? null : (
              <span className="cnt key" title={`g then ${digit}`}>
                <span aria-hidden="true">{digit}</span>
                <span className="vh">, g then {digit}</span>
              </span>
            )}
          </>,
          false,
          { ...treeRow(treeKey), "data-star-key": row.key, "data-star-slot": row.slot }
        )}
        <button
          type="button"
          className="row-act star-act"
          tabIndex={-1}
          aria-pressed={gone ? undefined : true}
          aria-label={gone ? `Remove ${row.label} from Starred` : `Unstar ${row.label}`}
          title={gone ? "Remove" : "Unstar"}
          onClick={() => stars.toggle(row.key)}
        >
          {gone ? (
            <X className="ic" aria-hidden="true" focusable="false" strokeWidth={1.5} />
          ) : (
            <Star className="ic" aria-hidden="true" focusable="false" strokeWidth={1.5} />
          )}
        </button>
      </div>
    );
  };
  const starredZone =
    stars.rows.length > 0 ? (
      <div className="grp stars" role="group" aria-labelledby="mc-nav-h-starred">
        <div className="h" id="mc-nav-h-starred">
          <span>Starred</span>
          <span className="h-cnt">
            <span aria-hidden="true">
              {stars.count} / {STAR_CAP}
            </span>
            <span className="vh">
              , {stars.count} of {STAR_CAP}
            </span>
          </span>
        </div>
        <button
          type="button"
          className="item star-rail"
          {...treeRow("star-rail")}
          title="Starred"
          aria-controls="mc-nav"
          aria-expanded={drawerOpen}
          onClick={() => onDrawer?.("toggle")}
        >
          <Star className="ic" aria-hidden="true" focusable="false" strokeWidth={1.5} />
          <span className="nm">Starred</span>
        </button>
        <div className="grp-body star-rows">{stars.rows.map(starCopy)}</div>
      </div>
    ) : null;

  const groups = zoned ? visibleZonedNavGroups(flags) : visibleNavGroups(flags);
  const flyoutSections = zoned ? visibleAdminFlyout(flags) : [];
  const onAdminScreen = zoned && zonedNavPlaceOf(route.screen) === "admin";

  // A nav item's row: its icon, label and count. Zoned, the count is a figure
  // in the count column (portal ADR-011 v2, Counts).
  const itemRow = (item: NavItem, parent: string | null) =>
    link(
      item.screen,
      { screen: navItemTarget(item, route.screen) },
      isNavItemCurrent(item, route.screen),
      item.label,
      <>
        <NavIcon name={item.lucide} />
        <span className="nm">{item.label}</span>
        {!item.badge ? null : zoned ? <CountFigure count={counts[item.badge]} /> : <CountBadge count={counts[item.badge]} />}
      </>,
      false,
      { ...treeRow(`screen:${item.screen}`, parent), ...(zoned ? { "data-star-key": starKeyOf({ screen: item.screen }) ?? undefined } : {}) }
    );

  const sidebar = (
    <nav
      className={`mc-side${drawerOpen ? " open" : ""}`}
      id="mc-nav"
      aria-label="Main"
      ref={drawerRef}
      onKeyDown={(event) => {
        if (drawerOpen) onDrawerKeyDown?.(event);
        if (zoned) onTreeKeyDown(event);
      }}
      onContextMenu={(event) => {
        if (event.timeStamp - menuKeyAt.current < 1000) event.preventDefault();
      }}
      onFocus={(event) => {
        const key = zoned ? (event.target as HTMLElement).dataset?.treeKey : undefined;
        if (!key) return;
        stopChosen.current = true;
        if (key !== treeStop) setTreeStop(key);
      }}
    >
      <div className="side-head">
        {/* 641–1024px only (CSS): expands the icon rail into the labelled drawer. */}
        <button
          type="button"
          className="iconbtn rail-toggle"
          aria-label="Open navigation"
          aria-expanded={drawerOpen}
          aria-controls="mc-nav"
          data-testid="nav-drawer-toggle"
          onClick={() => onDrawer?.("toggle")}
        >
          <PanelLeft className="ic" aria-hidden="true" focusable="false" strokeWidth={1.5} />
        </button>
        {/* Drawer only (CSS): dismisses it. */}
        <button
          type="button"
          className="iconbtn side-close"
          aria-label="Close navigation"
          onClick={() => onDrawer?.("close")}
          data-autofocus
        >
          <X className="ic" aria-hidden="true" focusable="false" strokeWidth={1.5} />
        </button>
      </div>
      {groups.map((group) => {
        const headingId = `mc-nav-h-${group.id}`;
        const bodyId = `mc-nav-${group.id}`;
        const open = !group.collapsible || (group.id === "knowledge" ? knowledgeOpen : adminOpen);
        const groupKey = group.collapsible ? `group:${group.id}` : null;
        return (
          <Fragment key={group.id}>
            <div className="grp" role="group" aria-labelledby={headingId}>
              {groupKey ? (
                <button
                  type="button"
                  className="h h-toggle"
                  {...treeRow(groupKey, null, open)}
                  data-tree-toggles={zoned ? groupKey : undefined}
                  id={headingId}
                  aria-expanded={open}
                  aria-controls={bodyId}
                  onClick={() => navGroupState.setOpen(group.id, !open)}
                >
                  {group.label}
                  <span className="chev" aria-hidden="true">
                    {open ? "▾" : "▸"}
                  </span>
                </button>
              ) : (
                <div className="h" id={headingId}>
                  {group.label}
                </div>
              )}
              <div id={bodyId} className="grp-body" hidden={!open}>
                {group.items.map((item) =>
                  // The zoned Projects row carries the one + (portal ADR-011
                  // v2, Lists 4): New project or New initiative.
                  zoned && item.screen === "projects" ? (
                    <div className="tree-row" key={item.screen}>
                      {itemRow(item, groupKey)}
                      {/* The collapsed rail only (CSS): Projects opens its flyout there. */}
                      <button
                        ref={projectsToggleRef}
                        type="button"
                        className="item rail-fly"
                        {...treeRow("rail:projects", groupKey)}
                        title="Projects"
                        popoverTarget={PROJECTS_FLYOUT_ID}
                        aria-controls={PROJECTS_FLYOUT_ID}
                        aria-expanded={projectsOpen}
                        onBlur={onProjectsBlur}
                      >
                        <NavIcon name={item.lucide} />
                        <span className="nm">{item.label}</span>
                      </button>
                      <button
                        ref={newToggleRef}
                        type="button"
                        className="row-act"
                        tabIndex={-1}
                        title="New project or initiative"
                        aria-label="New project or initiative"
                        popoverTarget={NEW_MENU_ID}
                        aria-controls={NEW_MENU_ID}
                        aria-expanded={newOpen}
                        data-tree-menu-for={`screen:${item.screen}`}
                        onBlur={onNewBlur}
                      >
                        <Plus className="ic" aria-hidden="true" focusable="false" strokeWidth={1.5} />
                      </button>
                    </div>
                  ) : (
                    withStar(itemRow(item, groupKey), item.screen, starKeyOf({ screen: item.screen }), item.label)
                  )
                )}
                {group.lists?.map((list) => lists[list])}
              </div>
            </div>
            {group.id === "my-work" ? starredZone : null}
          </Fragment>
        );
      })}
      {zoned ? (
        <div className="side-foot">
          <button
            ref={flyoutToggleRef}
            type="button"
            className={`item foot-toggle${onAdminScreen ? " on-path" : ""}`}
            {...treeRow("admin")}
            title="Admin & health"
            popoverTarget={ADMIN_FLYOUT_ID}
            aria-controls={ADMIN_FLYOUT_ID}
            aria-expanded={flyoutOpen}
            onBlur={onFlyoutBlur}
          >
            <NavIcon name="Settings" />
            <span className="nm">Admin & health</span>
            <CountFigure count={counts.sync} />
            <ChevronRight className="act" aria-hidden="true" focusable="false" strokeWidth={1.5} />
          </button>
          {withStar(
            link(
              HELP_NAV_ITEM.screen,
              { screen: HELP_NAV_ITEM.screen },
              route.screen === HELP_NAV_ITEM.screen,
              HELP_NAV_ITEM.label,
              <>
                <NavIcon name={HELP_NAV_ITEM.lucide} />
                <span className="nm">{HELP_NAV_ITEM.label}</span>
              </>,
              false,
              { ...treeRow("help"), "data-star-key": `screen:${HELP_NAV_ITEM.screen}` }
            ),
            "help",
            `screen:${HELP_NAV_ITEM.screen}`,
            HELP_NAV_ITEM.label
          )}
        </div>
      ) : null}
    </nav>
  );

  if (!zoned) return sidebar;
  return (
    <>
      {sidebar}
      <SideResize />
      <RailLabel />
      {/* Siblings of the nav: the rail form's icon-only styles must not reach them. */}
      <div
        ref={flyoutRef}
        id={ADMIN_FLYOUT_ID}
        popover="auto"
        onBeforeToggle={onFlyoutBeforeToggle}
        onToggle={onFlyoutToggle}
        className="mc-flyout"
        role="group"
        aria-label="Admin & health"
        onBlur={onFlyoutBlur}
        onClick={(event) => {
          if ((event.target as Element).closest("a")) hideFlyout();
        }}
      >
        {flyoutSections.map((section) => {
          const headingId = `mc-fly-h-${section.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
          return (
            <div className="fly-sec" role="group" aria-labelledby={headingId} key={section.label}>
              <p className="fly-h" id={headingId}>
                {section.label}
              </p>
              {section.items.map((item) =>
                link(
                  item.screen,
                  { screen: item.screen },
                  route.screen === item.screen,
                  item.label,
                  <>
                    <NavIcon name={item.lucide} />
                    <span className="nm">{item.label}</span>
                    {item.badge ? <CountBadge count={counts[item.badge]} /> : null}
                  </>
                )
              )}
            </div>
          );
        })}
      </div>
      <div
        ref={newPanelRef}
        id={NEW_MENU_ID}
        popover="auto"
        onBeforeToggle={onNewBeforeToggle}
        onToggle={onNewToggle}
        className="mc-flyout drop new-menu"
        role="group"
        aria-label="New"
        onBlur={onNewBlur}
      >
        {newProjectButton}
        {newInitiativeButton}
      </div>
      <div
        ref={projectsPanelRef}
        id={PROJECTS_FLYOUT_ID}
        popover="auto"
        onBeforeToggle={onProjectsBeforeToggle}
        onToggle={onProjectsToggle}
        className="mc-flyout projects-fly"
        role="group"
        aria-label="Projects"
        onBlur={onProjectsBlur}
        onClick={(event) => {
          if ((event.target as Element).closest("a")) hideProjects();
        }}
      >
        <div className="tree-filter">
          <Search className="ic" aria-hidden="true" focusable="false" strokeWidth={1.5} />
          <input
            type="search"
            className="tree-q"
            aria-label="Filter projects and initiatives"
            placeholder="Filter projects"
            autoComplete="off"
            spellCheck={false}
            value={flyFilter}
            onChange={(event) => setFlyFilter(event.target.value)}
          />
        </div>
        <p className="tree-none" role="status">
          {flyFiltering && flyTree.length === 0 ? "No project or initiative matches." : ""}
        </p>
        {/* Projects A to Z; while filtering, their matching initiatives too. */}
        {flyTree.map(({ project, initiatives }) => (
          <Fragment key={project.id}>
            {link(
              `fly:${project.id}`,
              { screen: "project", projectId: project.id },
              route.screen === "project" && route.projectId === project.id,
              project.name,
              <>
                <NavIcon name="FolderKanban" />
                <span className="nm">{project.name}</span>
              </>
            )}
            {flyFiltering
              ? initiatives.map((b) =>
                  link(
                    `fly:${b.id}`,
                    { screen: "bucket", bucketId: b.id },
                    route.screen === "bucket" && route.bucketId === b.id,
                    b.name,
                    <>
                      <span className="guide" aria-hidden="true" />
                      <span className="nm">{b.name}</span>
                    </>
                  )
                )
              : null}
          </Fragment>
        ))}
      </div>
    </>
  );
}

// The drawer's backdrop (drawer forms only, CSS): a tap dismisses. Decorative
// for assistive tech — Esc and the close button are the keyboard paths.
export function NavScrim({ open, onDrawer }: { open: boolean; onDrawer: (event: DrawerEvent) => void }) {
  if (!open) return null;
  return (
    <div
      className="mc-scrim"
      aria-hidden="true"
      data-testid="nav-drawer-scrim"
      onClick={() => onDrawer("backdrop")}
    />
  );
}

// OfflineBanner — app-wide honesty strip in the sticky chrome under the top
// bar (Wave 2 — UI trust). When GET /api/state fails the store keeps rendering
// seed/cached data that looks real, so say so and offer a retry (hydrate()
// reloads state + viewer). While the first load is still pending it holds an
// empty slot of the banner's exact height (--p-banner-h), so a failure that
// arrives after paint swaps slot → banner without moving the page (ADR-005).
export function OfflineBanner() {
  useMcVersion();
  const [retrying, setRetrying] = useState(false);
  const source = dataSource();
  if (source === "seed") return <div className="banner-slot" aria-hidden="true" />;
  if (source !== "offline") return null;
  const retry = () => {
    setRetrying(true);
    void hydrate().finally(() => setRetrying(false));
  };
  return (
    <div className="mc-offline" role="alert" data-testid="offline-banner">
      <span className="d" />
      <span className="body">Offline — showing cached or demo data</span>
      <button type="button" className="btn ghost sm" disabled={retrying} onClick={retry}>
        {retrying ? "Retrying…" : "Retry"}
      </button>
    </div>
  );
}

// NoticeHost — the only consumer of the store's notice channel. Surfaces the
// non-silent rollback message when a drag/inline PATCH fails (SPEC §5 Module B):
// the optimistic edit is restored in the store and this renders the toast so the
// dropped write is visible, never silent. Minimal, token-styled, dismissible.
export function NoticeHost() {
  const notices = useMcNotices();
  if (notices.length === 0) return null;
  return (
    <div className="mc-notices" role="status" aria-live="polite">
      {notices.map((notice) => (
        <div key={notice.id} className={`mc-notice ${notice.tone}`}>
          <span className="d" />
          <span className="body">{notice.body}</span>
          <button
            type="button"
            className="x"
            aria-label="Dismiss"
            onClick={() => dismissNotice(notice.id)}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
