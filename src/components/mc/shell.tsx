"use client";

// The Mission Control application shell: the brand boundary, dark-mode state,
// route state, and the chrome (Topbar + Sidebar) shared by every screen.
// Screens come from the registry in screens.tsx; modal-level surfaces (New
// Task, command palette) mount here when their lane lands.
import { useCallback, useEffect, useRef, useState } from "react";

import { BrandBoundary } from "@/components/brand";
import { hydrate } from "@/lib/mc-data/store";

import { NoticeHost, Sidebar, Topbar } from "./chrome";
import { CommandPalette } from "./command-palette";
import { InboxView } from "./inbox";
import { NewInitiativeModal } from "./new-initiative-modal";
import { NewTaskModal } from "./new-task-modal";
import type { Nav, Route, Screen } from "./route";
import { SCREENS } from "./screens";

export function MissionControlShell() {
  const [dark, setDark] = useState(false);
  const [route, setRoute] = useState<Route>({ screen: "home" });
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [newTaskCtx, setNewTaskCtx] = useState<{ bucketId?: string } | undefined>(undefined);
  const [newInitiativeOpen, setNewInitiativeOpen] = useState(false);
  // Post-hydration readiness flag (see the effect below): surfaced as
  // data-mc-ready on the shell root so automation can wait for genuine
  // interactivity, not the SSR-present-but-not-hydrated DOM.
  const [ready, setReady] = useState(false);

  // Hydrate after mount so SSR HTML and the first client render stay
  // identical: invited people from localStorage, then the engine's live
  // snapshot from the API.
  useEffect(() => {
    hydrate();
  }, []);

  const nav = useCallback<Nav>((screen: Screen, extra) => {
    setRoute({ screen, ...extra });
  }, []);

  const openPalette = useCallback(() => {
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

  const openNewInitiative = useCallback(() => {
    setPaletteOpen(false);
    setNewInitiativeOpen(true);
  }, []);

  const closeNewInitiative = useCallback(() => {
    setNewInitiativeOpen(false);
  }, []);

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
    setReady(true);
  }, []);

  const ScreenComponent = SCREENS[route.screen];

  return (
    <BrandBoundary className={`mc${dark ? " dark" : ""}`} data-mc-ready={ready ? "true" : undefined}>
      <Topbar nav={nav} dark={dark} setDark={setDark} onOpenPalette={openPalette} />
      <div className="mc-shell">
        <Sidebar route={route} nav={nav} onNewInitiative={openNewInitiative} />
        {route.screen === "home" ? (
          <InboxView route={route} nav={nav} openNewTask={() => openNewTask()} />
        ) : (
          <ScreenComponent route={route} nav={nav} />
        )}
      </div>
      {paletteOpen ? (
        <CommandPalette
          onClose={closePalette}
          nav={nav}
          onOpenNewTask={() => openNewTask({ bucketId: route.bucketId })}
          onOpenNewInitiative={openNewInitiative}
        />
      ) : null}
      {newTaskOpen ? <NewTaskModal ctx={newTaskCtx} onClose={closeNewTask} nav={nav} /> : null}
      {newInitiativeOpen ? <NewInitiativeModal onClose={closeNewInitiative} nav={nav} /> : null}
      <NoticeHost />
    </BrandBoundary>
  );
}
