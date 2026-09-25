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

import { liveAgentCount, pendingApprovalGates } from "@/lib/mc-data";
import { useMcNotices, useMcVersion, useViewer } from "@/lib/mc-data/hooks";
import {
  allTasks,
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
  createNavGroupState,
  isPlainLeftClick,
  navGroupOf,
  navHref,
  nextDrawerOpen,
  visibleNavGroups,
  type DrawerEvent,
  type NavBadge,
  type NavFlags,
  type NavGroupId,
  type NavList,
} from "./nav-model";
import { needsMeCount, todayGridDay, viewerLoadState } from "./needs-me";
import type { Nav, Route } from "./route";
import { useLayer } from "./use-layer";
import { useVendorAlertCount } from "./vendor-spend/use-alert-badge";

export type NavCounts = Partial<Record<NavBadge, Count>>;

/** The feature flags that gate nav items, resolved once for every surface. */
export function navFlags(): NavFlags {
  return { meetingIntake: meetingIntakeEnabled(), routingInbox: routingInboxEnabled() };
}

const noClockSubscribe = () => () => {};

/**
 * Every nav badge, computed once per shell so the sidebar, rail, tabs and
 * More sheet always agree. A count is known only once the server has answered
 * (dataSource "live"); before that — seed fixtures, or the offline fallback
 * showing cached or demo data — it is "—", never a fabricated or "confirmed"
 * 0. Attention badges (sync, AI spend) stay hidden until they have something
 * to say.
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
    // Pending runtime approval gates on the tasks this viewer can see. The
    // Approvals screen reads GET /api/approvals, a different source — so a
    // lower bound, never claimed exact.
    approvals: loaded ? { n: tasks.reduce((n, t) => n + pendingApprovalGates(t).length, 0), exact: false } : UNKNOWN_COUNT,
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
  const adminOpen = useNavGroupOpen("admin");

  // Keep the active screen visible: arriving on an Admin & health screen (deep
  // link, ⌘K, the topbar sync pill) expands that group.
  useEffect(() => {
    if (navGroupOf(route.screen) === "admin" && !navGroupState.isOpen("admin")) {
      navGroupState.setOpen("admin", true);
    }
  }, [route.screen]);

  // Items are real links (open in a new tab, copy the URL); a plain click stays
  // a client-side nav() so screens switch without a reload.
  const link = (key: string, target: Route, active: boolean, label: string, body: ReactNode) => (
    <a
      key={key}
      href={navHref(target)}
      className={`item${active ? " active" : ""}`}
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
            </>
          )
        )}
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
      </div>
    ),
  };

  const groups = visibleNavGroups(navFlags());

  return (
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
        const open = !group.collapsible || adminOpen;
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
              {group.lists?.map((list) => lists[list])}
            </div>
          </div>
        );
      })}
    </nav>
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
