// Mission Control chrome: the Topbar and Sidebar shared by every screen.
// Ported from docs/product/prototype/mc-chrome.jsx. Counts come from the
// runtime store so the sync pill and badges stay live after store actions.
// The command palette (⌘K) mounts here when the authoring lane lands.
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
import Image from "next/image";

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
} from "@/lib/mc-data/store";
import { meetingIntakeEnabled } from "@/lib/meeting-intake";
import { routingInboxEnabled } from "@/components/mc/routing-inbox/flag";

import { Avatar, PMark } from "./atoms";
import {
  createNavGroupState,
  drawerFocusTarget,
  isPlainLeftClick,
  navGroupOf,
  navHref,
  nextDrawerOpen,
  visibleNavGroups,
  wrapFocusIndex,
  type DrawerEvent,
  type NavBadge,
  type NavGroupId,
  type NavList,
} from "./nav-model";
import { needsMeCount, todayGridDay } from "./needs-me";
import type { Nav, Route } from "./route";
import { useVendorAlertCount } from "./vendor-spend/use-alert-badge";

// The ≤1024px nav drawer (RESPONSIVE.md §3 drawer protocol). The shell owns
// it; the Topbar's hamburger toggles it and the Sidebar is the drawer panel.
// Esc dismisses, body scroll locks while open (body.mc-sb-open), and focus
// moves into the drawer on open and back to the hamburger on close.
export function useNavDrawer() {
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  const send = useCallback((event: DrawerEvent) => setOpen((prev) => nextDrawerOpen(prev, event)), []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) send("escape");
    };
    window.addEventListener("keydown", onKeyDown);
    document.body.classList.add("mc-sb-open");
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.classList.remove("mc-sb-open");
    };
  }, [open, send]);

  useEffect(() => {
    const target = drawerFocusTarget(wasOpen.current, open);
    wasOpen.current = open;
    if (target === "panel") panelRef.current?.querySelector<HTMLElement>(".side-close")?.focus();
    if (target === "toggle") toggleRef.current?.focus();
  }, [open]);

  return { open, send, toggleRef, panelRef };
}

export function Topbar({
  nav,
  dark,
  setDark,
  onOpenPalette,
  drawerOpen = false,
  onToggleDrawer,
  drawerToggleRef,
}: {
  nav: Nav;
  dark: boolean;
  setDark: (next: boolean) => void;
  onOpenPalette: () => void;
  drawerOpen?: boolean;
  onToggleDrawer?: () => void;
  drawerToggleRef?: RefObject<HTMLButtonElement | null>;
}) {
  useMcVersion();
  const viewer = useViewer();
  const c = storeSyncCounts();
  const need = c.conflict + c.error;
  const cls = need > 0 ? "warn" : c.pending > 0 ? "pending" : "ok";
  const label =
    need > 0 ? `${need} to resolve` : c.pending > 0 ? `${c.pending} pending` : "Synced";

  return (
    <header className="mc-top">
      <div className="l">
        {/* ≤1024px only (CSS): opens the nav drawer. */}
        <button
          type="button"
          ref={drawerToggleRef}
          className="iconbtn hamburger"
          aria-label="Open navigation"
          aria-expanded={drawerOpen}
          aria-controls="mc-nav"
          data-testid="nav-drawer-toggle"
          onClick={onToggleDrawer}
        >
          <span aria-hidden="true">☰</span>
        </button>
        <button type="button" className="brand" onClick={() => nav("home")}>
          <Image
            src={dark ? "/brand/logo-horizontal-cream.png" : "/brand/logo-horizontal-ink.png"}
            alt="Petra Lab-X"
            width={409}
            height={107}
            className="brand-logo"
            priority
          />
          <span className="sub">Mission Control</span>
        </button>
        <div className="ws">
          <PMark acc />
          <span>PLX Engineering</span>
          <span className="chev">▾</span>
        </div>
      </div>
      <div className="r">
        <button type="button" className="search" onClick={onOpenPalette}>
          <span className="search-hint">
            Search · jump · create…
          </span>
          <span className="key kbd-hint">⌘K</span>
        </button>
        <button
          type="button"
          className={`topsync ${cls}`}
          onClick={() => nav("sync")}
          title="SharePoint sync issues · review queue"
          data-testid="nav-sync-console"
        >
          <span className="d" />
          <span className="lb">{label}</span>
        </button>
        <button
          type="button"
          className="iconbtn"
          title={dark ? "Light mode" : "Dark mode"}
          onClick={() => setDark(!dark)}
        >
          {dark ? "☀" : "☾"}
        </button>
        {viewer ? (
          <Avatar actor={viewer} id={viewer.id} size="lg" title={`${viewer.name} · ${viewer.role}`} />
        ) : null}
      </div>
    </header>
  );
}

// Admin & health's expanded state — remembered per browser (nav-model.ts
// holds the storage + in-memory fallback). The server snapshot is "collapsed"
// so SSR and the hydrating render agree.
const navGroupState = createNavGroupState(() =>
  typeof window === "undefined" ? null : window.localStorage
);

const noClockSubscribe = () => () => {};

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
  onNewProject,
  onNewInitiative,
  drawerOpen = false,
  onDrawer,
  drawerRef,
}: {
  route: Route;
  nav: Nav;
  onNewProject: () => void;
  onNewInitiative: () => void;
  /** ≤1024px: the sidebar is the drawer panel (see useNavDrawer). */
  drawerOpen?: boolean;
  onDrawer?: (event: DrawerEvent) => void;
  drawerRef?: RefObject<HTMLElement | null>;
}) {
  useMcVersion();
  const viewer = useViewer();
  // Client clock only (null on the server) so SSR and hydration agree.
  const today = useSyncExternalStore(noClockSubscribe, () => todayGridDay(new Date()), () => null);
  const unread = unreadCount();
  const tasks = allTasks();
  // Honest live-agent count: agents currently executing in-flight work (EN-005),
  // not a fabricated online flag.
  const live = liveAgentCount(tasks);
  const sc = storeSyncCounts();
  const conflicts = sc.conflict + sc.error;
  // Pending runtime approval gates on the tasks this viewer can see — read from
  // the store (no extra fetch); the Approvals screen itself loads GET /api/approvals.
  const approvals = tasks.reduce((n, t) => n + pendingApprovalGates(t).length, 0);
  // Vendors at warn/critical/over budget (MTD) — the AI Spend proactive badge.
  const vendorAlerts = useVendorAlertCount();
  const adminOpen = useNavGroupOpen("admin");
  // Home badge: what the store can say needs this viewer (Home's needs-me
  // rules) plus unread notifications — both live on Home.
  const needs = viewer && today !== null ? needsMeCount(viewer, tasks, today, sc) : 0;

  // Keep the active screen visible: arriving on an Admin & health screen (deep
  // link, ⌘K, the topbar sync pill) expands that group.
  useEffect(() => {
    if (navGroupOf(route.screen) === "admin" && !navGroupState.isOpen("admin")) {
      navGroupState.setOpen("admin", true);
    }
  }, [route.screen]);

  const badges: Record<NavBadge, ReactNode> = {
    needs:
      needs + unread ? (
        <span className="badge acc" title={`${needs} need you · ${unread} unread`}>
          {needs + unread}
        </span>
      ) : null,
    approvals: approvals ? <span className="badge acc">{approvals}</span> : null,
    sync: conflicts ? <span className="badge hot">{conflicts}</span> : null,
    agents: <span className="badge acc">{live} live</span>,
    "ai-spend": vendorAlerts ? <span className="badge hot">{vendorAlerts}</span> : null,
  };

  // Items are real links (open in a new tab, copy the URL); a plain click stays
  // a client-side nav() so screens switch without a reload.
  const link = (key: string, target: Route, active: boolean, body: ReactNode) => (
    <a
      key={key}
      href={navHref(target)}
      className={`item${active ? " active" : ""}`}
      aria-current={active ? "page" : undefined}
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
          <span className="ic" aria-hidden="true">+</span>
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
          <span className="ic" aria-hidden="true">+</span>
          <span className="nm">New initiative</span>
        </button>
      </div>
    ),
  };

  const groups = visibleNavGroups({
    meetingIntake: meetingIntakeEnabled(),
    routingInbox: routingInboxEnabled(),
  });

  // Open drawer: Tab / Shift+Tab wrap inside it (the page is under the scrim).
  const trapFocus = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (!drawerOpen || event.key !== "Tab") return;
    const focusables = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>("a[href], button:not([disabled])")
    ).filter((el) => el.offsetParent !== null);
    const next = wrapFocusIndex(
      focusables.length,
      focusables.indexOf(document.activeElement as HTMLElement),
      event.shiftKey
    );
    if (next !== null) {
      event.preventDefault();
      focusables[next].focus();
    }
  };

  return (
    <nav
      className={`mc-side${drawerOpen ? " open" : ""}`}
      id="mc-nav"
      aria-label="Main"
      ref={drawerRef}
      onKeyDown={trapFocus}
    >
      {/* ≤1024px only (CSS): dismisses the drawer. */}
      <button type="button" className="side-close" aria-label="Close navigation" onClick={() => onDrawer?.("close")}>
        <span aria-hidden="true">✕</span>
      </button>
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
            <div id={bodyId} hidden={!open}>
              {group.items.map((item) =>
                link(
                  item.screen,
                  { screen: item.screen },
                  route.screen === item.screen,
                  <>
                    <span className="ic" aria-hidden="true">
                      {item.icon}
                    </span>
                    <span className="nm">{item.label}</span>
                    {item.badge ? badges[item.badge] : null}
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

// The drawer's backdrop (≤1024px only, CSS): a tap dismisses. Decorative for
// assistive tech — Esc and the close button are the keyboard paths.
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

// OfflineBanner — app-wide honesty strip under the topbar (Wave 2 — UI trust).
// When GET /api/state fails the store keeps rendering seed/cached data that
// looks real, so say so and offer a retry (hydrate() reloads state + viewer).
// Renders nothing while the data is live or the first load is still pending.
export function OfflineBanner() {
  useMcVersion();
  const [retrying, setRetrying] = useState(false);
  if (dataSource() !== "offline") return null;
  const retry = () => {
    setRetrying(true);
    void hydrate().finally(() => setRetrying(false));
  };
  return (
    <div className="sk-banner mc-offline" role="alert" data-testid="offline-banner">
      <span className="dot" />
      <span className="sk-banner-body">
        <span className="sk-banner-ct">Offline — showing cached or demo data</span>
      </span>
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
