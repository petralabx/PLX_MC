// Mission Control chrome shared by every screen: the Sidebar (one element that
// mc-shell.css renders as the phone drawer, the tablet rail and the desktop
// sidebar — ADR-005), the nav counts every nav surface shows, the offline
// banner and the notice toasts. The top bar lives in top-bar.tsx; the phone
// tabs, strip and FAB in bottom-tabs.tsx; the More sheet in more-sheet.tsx.
// Counts come from the runtime store so badges stay live after store actions.
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { PanelLeft, Plus, X } from "lucide-react";

import { liveAgentCount, openQuestionsFor, pendingApprovalGates, type Human, type Task } from "@/lib/mc-data";
import { useMcNotices, useMcVersion, useViewer } from "@/lib/mc-data/hooks";
import {
  allTasks,
  bucketById,
  dataSource,
  dismissNotice,
  hydrate,
  navBuckets,
  navProjects,
  storeSyncCounts,
  unreadCount,
  viewerSettled,
} from "@/lib/mc-data/store";
import { meetingIntakeEnabled } from "@/lib/meeting-intake";
import { routingInboxEnabled } from "@/components/mc/routing-inbox/flag";

import { CountBadge, UNKNOWN_COUNT, type Count } from "./count-badge";
import { NavIcon } from "./nav-icon";
import {
  HELP_NAV_ITEM,
  createNavGroupState,
  isNavItemCurrent,
  isPlainLeftClick,
  navGroupOf,
  navHref,
  navItemTarget,
  nextDrawerOpen,
  projectTree,
  revealScrollTop,
  viewerProjectIds,
  visibleAdminFlyout,
  visibleNavGroups,
  visibleZonedNavGroups,
  zonedNavPlaceOf,
  type DrawerEvent,
  type NavBadge,
  type NavFlags,
  type NavGroupId,
  type NavList,
} from "./nav-model";
import { useNavZones } from "./nav-zones";
import { needsMeCount, todayGridDay, viewerLoadState } from "./needs-me";
import type { Nav, Route } from "./route";
import { useFlyout } from "./use-flyout";
import { useLayer } from "./use-layer";
import { useVendorAlertCount } from "./vendor-spend/use-alert-badge";

export type NavCounts = Partial<Record<NavBadge, Count>>;

/** The feature flags that gate nav items, resolved once for every surface. */
export function navFlags(): NavFlags {
  return { meetingIntake: meetingIntakeEnabled(), routingInbox: routingInboxEnabled() };
}

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
  useMcVersion();
  const zoned = useNavZones();
  const viewer = useViewer();
  const [treeOpen, setTreeOpen] = useState<Record<string, boolean>>({});
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
  const treeProjects = zoned ? navProjects() : [];
  const treeInitiatives = zoned ? navBuckets() : [];
  const tree = zoned
    ? projectTree(
        treeProjects,
        treeInitiatives,
        viewerProjectIds(treeProjects, treeInitiatives, allTasks(), viewer),
        currentProjectId
      )
    : null;

  // Arriving on a project or one of its initiatives opens it; after that it
  // keeps the person's choice, like Knowledge and Admin & health (ADR-011).
  // Adjusted while rendering: React's pattern for state that follows a prop.
  const arrival = zoned && currentProjectId ? `${currentProjectId} ${route.screen} ${route.bucketId ?? ""}` : null;
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  if (arrival !== openedOn) {
    setOpenedOn(arrival);
    if (currentProjectId && arrival && !treeOpen[currentProjectId]) {
      setTreeOpen((prev) => ({ ...prev, [currentProjectId]: true }));
    }
  }

  // Items are real links (open in a new tab, copy the URL); a plain click stays
  // a client-side nav() so screens switch without a reload.
  const link = (key: string, target: Route, active: boolean, label: string, body: ReactNode, onPath = false) => (
    <a
      key={key}
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
        onDrawer?.("navigate");
        onNewInitiative();
      }}
    >
      <Plus className="ic" aria-hidden="true" focusable="false" strokeWidth={1.5} />
      <span className="nm">New initiative</span>
    </button>
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
    // The capped projects, each with a disclosure for its initiatives, then
    // View all. The current project starts open.
    "project-tree": tree ? (
      <div className="tree" role="group" aria-label="Projects" key="project-tree">
        {tree.nodes.map(({ project, initiatives }) => {
          const bodyId = `mc-nav-tree-${project.id}`;
          const expanded = treeOpen[project.id] === true;
          return (
            <div className="tree-node" key={project.id}>
              <div className="tree-row">
                {link(
                  `project:${project.id}`,
                  { screen: "project", projectId: project.id },
                  route.screen === "project" && route.projectId === project.id,
                  project.name,
                  <>
                    <span className={`hl ${project.health}`} aria-hidden="true" />
                    <span className="nm">{project.name}</span>
                  </>,
                  project.id === openProjectId
                )}
                {initiatives.length > 0 ? (
                  <button
                    type="button"
                    className="tree-toggle"
                    aria-expanded={expanded}
                    aria-controls={bodyId}
                    aria-label={`Initiatives in ${project.name}`}
                    onClick={() => setTreeOpen((prev) => ({ ...prev, [project.id]: !expanded }))}
                  >
                    <span className="chev" aria-hidden="true">
                      {expanded ? "▾" : "▸"}
                    </span>
                  </button>
                ) : null}
              </div>
              {initiatives.length > 0 ? (
                <div id={bodyId} className="tree-kids" hidden={!expanded}>
                  {initiatives.map((b) =>
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
                </div>
              ) : null}
            </div>
          );
        })}
        {tree.total > tree.nodes.length
          ? link(
              "projects:all",
              { screen: "projects" },
              false,
              `View all ${tree.total} projects`,
              <span className="nm">View all {tree.total} projects</span>
            )
          : null}
        {newProjectButton}
        {newInitiativeButton}
      </div>
    ) : null,
  };

  const flags = navFlags();
  const groups = zoned ? visibleZonedNavGroups(flags) : visibleNavGroups(flags);
  const flyoutSections = zoned ? visibleAdminFlyout(flags) : [];
  const onAdminScreen = zoned && zonedNavPlaceOf(route.screen) === "admin";

  const sidebar = (
    <nav
      className={`mc-side${drawerOpen ? " open" : ""}`}
      id="mc-nav"
      aria-label="Main"
      ref={drawerRef}
      onKeyDown={drawerOpen ? onDrawerKeyDown : undefined}
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
        return (
          <div className="grp" role="group" aria-labelledby={headingId} key={group.id}>
            {group.collapsible ? (
              <button
                type="button"
                className="h h-toggle"
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
                link(
                  item.screen,
                  { screen: navItemTarget(item, route.screen) },
                  isNavItemCurrent(item, route.screen),
                  item.label,
                  <>
                    <NavIcon name={item.lucide} />
                    <span className="nm">{item.label}</span>
                    {item.badge ? <CountBadge count={counts[item.badge]} /> : null}
                  </>
                )
              )}
              {group.lists?.map((list) => lists[list])}
            </div>
          </div>
        );
      })}
      {zoned ? (
        <div className="side-foot">
          <button
            ref={flyoutToggleRef}
            type="button"
            className={`item foot-toggle${onAdminScreen ? " on-path" : ""}`}
            title="Admin & health"
            popoverTarget={ADMIN_FLYOUT_ID}
            aria-controls={ADMIN_FLYOUT_ID}
            aria-expanded={flyoutOpen}
            onBlur={onFlyoutBlur}
          >
            <NavIcon name="Settings" />
            <span className="nm">Admin & health</span>
            <CountBadge count={counts.sync} />
          </button>
          {link(
            HELP_NAV_ITEM.screen,
            { screen: HELP_NAV_ITEM.screen },
            route.screen === HELP_NAV_ITEM.screen,
            HELP_NAV_ITEM.label,
            <>
              <NavIcon name={HELP_NAV_ITEM.lucide} />
              <span className="nm">{HELP_NAV_ITEM.label}</span>
            </>
          )}
        </div>
      ) : null}
    </nav>
  );

  if (!zoned) return sidebar;
  return (
    <>
      {sidebar}
      {/* A sibling of the nav: the rail form's icon-only styles must not reach it. */}
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
