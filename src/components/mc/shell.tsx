"use client";

// The Mission Control application shell: the brand boundary, dark-mode state,
// route state, and the chrome shared by every screen. Screens come from the
// registry in screens.tsx; modal-level surfaces (New Task, command palette)
// mount here.
//
// Layout is mobile-first and CSS-owned (src/styles/mc-shell.css, ADR-005):
//   <641     top bar · group strip · main · bottom tabs (+ More sheet, FAB)
//   641–1024 top bar · 64px icon rail (→ labelled drawer) · main
//   ≥1025    top bar · 240px sidebar · main
//   ≥1600    + persistent context pane on collection screens
//   ≥2200    + optional pinned live column (Agent activity)
// JS reads the tier only for behaviour: at ≥1600 opening a task from a
// collection screen fills the pane instead of leaving the collection.
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

import { BrandBoundary } from "@/components/brand";
import { hydrate } from "@/lib/mc-data/store";

import { AgentFeed } from "./agent-feed";
import { BottomTabs, GroupStrip, NewTaskFab, rememberTabScreen } from "./bottom-tabs";
import { NavScrim, NoticeHost, OfflineBanner, Sidebar, navFlags, useNavCounts, useNavDrawer } from "./chrome";
import { CommandPalette } from "./command-palette";
import { ContextPane, LiveColumn, PaneEmpty } from "./context-pane";
import { InboxView } from "./inbox";
import { MoreSheet } from "./more-sheet";
import { isPaneScreen } from "./nav-model";
import { NewInitiativeModal } from "./new-initiative-modal";
import { NewProjectModal } from "./new-project-modal";
import { NewTaskModal } from "./new-task-modal";
import type { Nav, Route, Screen } from "./route";
import { routeToUrl, urlToRoute } from "./route";
import { SCREENS } from "./screens";
import {
  clampPaneWidth,
  livePinnedPref,
  minWidthNow,
  paneHiddenPref,
  paneWidthPref,
  useMinWidth,
  usePref,
} from "./shell-prefs";
import { TaskDetailView } from "./task-detail";
import { Topbar } from "./top-bar";
import { useLayerSlot } from "./use-layer";

export function MissionControlShell() {
  const [dark, setDark] = useState(false);
  const [route, setRoute] = useState<Route>({ screen: "home" });
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [newTaskCtx, setNewTaskCtx] = useState<{ bucketId?: string } | undefined>(undefined);
  const [newInitiativeOpen, setNewInitiativeOpen] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  // Post-hydration readiness flag (see the effect below): surfaced as
  // data-mc-ready on the shell root so automation can wait for genuine
  // interactivity, not the SSR-present-but-not-hydrated DOM.
  const [ready, setReady] = useState(false);
  // <1025px: the sidebar is a drawer (phone: More → All screens; tablet: the rail toggle).
  const drawer = useNavDrawer();
  const moreRef = useRef<HTMLButtonElement | null>(null);
  const counts = useNavCounts();
  const flags = navFlags();

  // Wide-tier preferences (ADR-005): the pane width and hidden state, and the
  // pinned live column. CSS owns the layout; these only pick the form.
  const wide = useMinWidth(1600);
  const ultra = useMinWidth(2200);
  const storedPaneWidth = usePref(paneWidthPref, null);
  const paneHidden = usePref(paneHiddenPref, false);
  const livePinned = usePref(livePinnedPref, false);
  const paneWidth = storedPaneWidth ?? (ultra ? 520 : 440);

  // The palette and modals handle their own Esc; registering them keeps the
  // layer stack honest (use-layer.ts) and returns focus to what opened them.
  useLayerSlot(paletteOpen);
  useLayerSlot(newTaskOpen);
  useLayerSlot(newProjectOpen);
  useLayerSlot(newInitiativeOpen);

  // Hydrate after mount so SSR HTML and the first client render stay
  // identical: invited people from localStorage, then the engine's live
  // snapshot from the API.
  useEffect(() => {
    hydrate();
  }, []);

  // P3 deep links — route state ⇄ URL. The URL is adopted AFTER mount (not in
  // the useState initializer) so the SSR HTML and the first client render stay
  // identical ("home") and hydration never mismatches; browser back/forward
  // then replay screens via popstate. `filter` is intentionally not in the URL
  // (transient hand-off state — see routeToUrl in route.ts).
  useEffect(() => {
    // Deferred one tick (same pattern as the `ready` flag below) so the
    // adoption is not a synchronous setState inside the effect body; effects
    // run in declaration order, so this timer is scheduled — and fires —
    // before the readiness timer, i.e. data-mc-ready still implies the deep
    // link has been adopted.
    const timer = window.setTimeout(() => setRoute(urlToRoute(window.location.search)), 0);
    const onPopState = () => setRoute(urlToRoute(window.location.search));
    window.addEventListener("popstate", onPopState);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("popstate", onPopState);
    };
  }, []);

  // Each phone tab remembers the last screen it showed.
  useEffect(() => {
    rememberTabScreen(route.screen);
  }, [route.screen]);

  // The latest route and pane preference, for nav() to read at click time
  // without re-creating nav (every screen receives it).
  const routeRef = useRef(route);
  const paneHiddenRef = useRef(paneHidden);
  useEffect(() => {
    routeRef.current = route;
    paneHiddenRef.current = paneHidden;
  });

  const go = useCallback((next: Route) => {
    setRoute(next);
    // Shallow history update via the native History API: Next 14+ syncs its
    // router state from pushState without re-rendering server components or
    // refetching, so every nav stays a pure client-state transition. Skip the
    // push when the URL wouldn't change (e.g. re-clicking the current screen)
    // so history doesn't fill with duplicates.
    const url = routeToUrl(next);
    if (url !== window.location.pathname + window.location.search) {
      window.history.pushState(null, "", url);
    }
  }, []);

  const nav = useCallback<Nav>(
    (screen: Screen, extra) => {
      const current = routeRef.current;
      // Panes, not pages, on wide screens (ADR-005): at ≥1600 a task opened
      // from a collection screen fills the context pane and the collection
      // stays put. The selection is in the URL, so narrowing the window shows
      // the same task as an overlay. "Open page" still reaches the task page.
      if (
        screen === "task" &&
        extra?.taskId &&
        isPaneScreen(current.screen) &&
        !paneHiddenRef.current &&
        minWidthNow(1600)
      ) {
        go({
          screen: current.screen,
          bucketId: current.bucketId,
          projectId: current.projectId,
          taskId: extra.taskId,
        });
        return;
      }
      go({ screen, ...extra });
    },
    [go]
  );

  const paneScreen = isPaneScreen(route.screen);
  const selected = paneScreen ? route.taskId : undefined;
  const persistentPane = wide && paneScreen && !paneHidden;

  const closePane = useCallback(() => {
    const current = routeRef.current;
    if (current.taskId) {
      // Deselect; the collection (and its filters) stay.
      go({ screen: current.screen, bucketId: current.bucketId, projectId: current.projectId });
    } else {
      paneHiddenPref.set(true);
    }
  }, [go]);

  const openTaskPage = useCallback((taskId: string) => go({ screen: "task", taskId }), [go]);

  const setPaneWidth = useCallback((width: number, persist: boolean) => {
    paneWidthPref.set(clampPaneWidth(width), persist);
  }, []);

  const openPalette = useCallback(() => {
    setMoreOpen(false);
    setPaletteOpen(true);
  }, []);

  const closePalette = useCallback(() => {
    setPaletteOpen(false);
  }, []);

  const openNewTask = useCallback((ctx?: { bucketId?: string }) => {
    setPaletteOpen(false);
    setNewTaskCtx(ctx);
    setNewTaskOpen(true);
  }, []);

  const closeNewTask = useCallback(() => {
    setNewTaskOpen(false);
    setNewTaskCtx(undefined);
  }, []);

  const openNewProject = useCallback(() => {
    setPaletteOpen(false);
    setNewProjectOpen(true);
  }, []);

  const closeNewProject = useCallback(() => {
    setNewProjectOpen(false);
  }, []);

  const openNewInitiative = useCallback(() => {
    setPaletteOpen(false);
    setNewInitiativeOpen(true);
  }, []);

  const closeNewInitiative = useCallback(() => {
    setNewInitiativeOpen(false);
  }, []);

  const closeMore = useCallback(() => setMoreOpen(false), []);
  const openAllScreens = useCallback(() => {
    setMoreOpen(false);
    drawer.send("toggle");
  }, [drawer]);

  // Pending `g`-prefix for two-key view chords (g b / g l / g t / g m / g i). A
  // ref (not state) so arming the prefix never triggers a render.
  const gPrefix = useRef<number | null>(null);

  useEffect(() => {
    // Prefixed `g _` view chords. SPEC §3: PR-A adds a persistent filter input
    // to the views surface, so bare single-key chords would fire while typing.
    // `g m` (My Tasks) is the PR-D1 chord deferred from PR-A; it rides the same
    // guard (newTaskOpen || paletteOpen + the input/textarea/contenteditable
    // check below).
    const VIEW_CHORDS: Record<string, Screen> = {
      b: "board",
      l: "list",
      t: "timeline",
      m: "mine",
      // `g i` (Insights) is the Module E chord; rides the same guard as g b/l/t/m
      // (newTaskOpen || paletteOpen + the input/textarea/contenteditable check).
      i: "insights",
    };

    const onKeyDown = (event: KeyboardEvent) => {
      // ⌘K / Ctrl-K toggles the palette (a modifier combo — safe while typing);
      // only suppressed while the New Task modal is open, as before.
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        if (newTaskOpen || newInitiativeOpen) return;
        event.preventDefault();
        setMoreOpen(false);
        setPaletteOpen((prev) => !prev);
        return;
      }

      // Bare-key chords are gated so they never fire while typing or while a
      // modal/palette owns the keyboard (the filter input lives on the views
      // surface; PeoplePicker's capture-phase Esc closes a picker first).
      if (newTaskOpen || newInitiativeOpen || paletteOpen) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest?.("input,textarea,[contenteditable]")) return;

      const key = event.key.toLowerCase();

      // Second key of a `g _` chord.
      if (gPrefix.current !== null) {
        window.clearTimeout(gPrefix.current);
        gPrefix.current = null;
        const screen = VIEW_CHORDS[key];
        if (screen) {
          event.preventDefault();
          nav(screen);
        }
        return;
      }

      // Arm the `g` prefix for a short window.
      if (key === "g") {
        event.preventDefault();
        gPrefix.current = window.setTimeout(() => {
          gPrefix.current = null;
        }, 900);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (gPrefix.current !== null) window.clearTimeout(gPrefix.current);
    };
  }, [nav, newTaskOpen, newInitiativeOpen, paletteOpen]);

  // Flip the readiness flag once, AFTER mount — i.e. after the client effects
  // above (notably the global ⌘K / `g _` chord keydown listener) have attached.
  // The marker only paints on the re-render that follows this first effect
  // flush, so its presence guarantees the shell is interactive, not merely
  // server-painted. Lets E2E wait for true interactivity (see e2e/helpers.ts).
  useEffect(() => {
    const timer = window.setTimeout(() => setReady(true), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const ScreenComponent = SCREENS[route.screen];
  const showLive = livePinned && route.screen !== "feed";
  // The only inline style: the user's pane width as data (a custom property).
  const bodyStyle =
    storedPaneWidth === null ? undefined : ({ "--p-pane-w": `${storedPaneWidth}px` } as CSSProperties);

  return (
    <BrandBoundary className={`mc mc-app${dark ? " dark" : ""}`} data-mc-ready={ready ? "true" : undefined}>
      <a className="mc-skip" href="#mc-main">
        Skip to content
      </a>
      <div className="mc-chrome">
        <Topbar
          route={route}
          nav={nav}
          dark={dark}
          setDark={setDark}
          onOpenPalette={openPalette}
          pane={paneScreen ? { shown: !paneHidden, toggle: () => paneHiddenPref.set(!paneHidden) } : undefined}
          live={{ pinned: livePinned, toggle: () => livePinnedPref.set(!livePinned) }}
        />
        <OfflineBanner />
      </div>
      <div
        className="mc-body"
        data-pane={persistentPane ? "open" : "closed"}
        data-live={showLive ? "pinned" : "off"}
        style={bodyStyle}
      >
        <Sidebar
          route={route}
          nav={nav}
          counts={counts}
          onNewProject={openNewProject}
          onNewInitiative={openNewInitiative}
          drawerOpen={drawer.open}
          onDrawer={drawer.send}
          drawerRef={drawer.panelRef}
          onDrawerKeyDown={drawer.onKeyDown}
        />
        <NavScrim open={drawer.open} onDrawer={drawer.send} />
        <main className="mc-stage" id="mc-main" tabIndex={-1}>
          <GroupStrip route={route} nav={nav} flags={flags} />
          {route.screen === "home" ? (
            <InboxView route={route} nav={nav} openNewTask={() => openNewTask()} />
          ) : (
            <ScreenComponent route={route} nav={nav} />
          )}
        </main>
        {paneScreen ? (
          <ContextPane
            selected={selected}
            persistent={persistentPane}
            width={paneWidth}
            onWidth={setPaneWidth}
            onClose={closePane}
            onOpenPage={openTaskPage}
          >
            {selected ? <TaskDetailView route={{ screen: "task", taskId: selected }} nav={nav} /> : <PaneEmpty />}
          </ContextPane>
        ) : null}
        {showLive ? (
          <LiveColumn onUnpin={() => livePinnedPref.set(false)}>
            <AgentFeed route={{ screen: "feed" }} nav={nav} />
          </LiveColumn>
        ) : null}
      </div>
      <NewTaskFab route={route} onNewTask={() => openNewTask({ bucketId: route.bucketId })} />
      <BottomTabs
        route={route}
        nav={nav}
        counts={counts}
        moreOpen={moreOpen}
        onMore={() => setMoreOpen((open) => !open)}
        moreRef={moreRef}
      />
      <MoreSheet
        open={moreOpen}
        onClose={closeMore}
        onAllScreens={openAllScreens}
        route={route}
        nav={nav}
        flags={flags}
        counts={counts}
        dark={dark}
        setDark={setDark}
      />
      {paletteOpen ? (
        <CommandPalette
          onClose={closePalette}
          nav={nav}
          onOpenNewTask={() => openNewTask({ bucketId: route.bucketId })}
          onOpenNewInitiative={openNewInitiative}
          onOpenNewProject={openNewProject}
        />
      ) : null}
      {newTaskOpen ? <NewTaskModal ctx={newTaskCtx} onClose={closeNewTask} nav={nav} /> : null}
      {newProjectOpen ? <NewProjectModal onClose={closeNewProject} nav={nav} /> : null}
      {newInitiativeOpen ? <NewInitiativeModal onClose={closeNewInitiative} nav={nav} projectId={route.projectId} /> : null}
      <NoticeHost />
    </BrandBoundary>
  );
}
