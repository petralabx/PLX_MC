"use client";

// The Mission Control application shell: the brand boundary, dark-mode state,
// route state, and the chrome (Topbar + Sidebar) shared by every screen.
// Screens come from the registry in screens.tsx; modal-level surfaces (New
// Task, command palette) mount here when their lane lands.
import { useCallback, useEffect, useState } from "react";

import { BrandBoundary } from "@/components/brand";
import { hydrateFromStorage } from "@/lib/mc-data/store";

import { Sidebar, Topbar } from "./chrome";
import type { Nav, Route, Screen } from "./route";
import { SCREENS } from "./screens";

export function MissionControlShell() {
  const [dark, setDark] = useState(false);
  const [route, setRoute] = useState<Route>({ screen: "home" });

  // Rehydrate user-created tasks / invited people after hydration so SSR HTML
  // and the first client render stay identical.
  useEffect(() => {
    hydrateFromStorage();
  }, []);

  const nav = useCallback<Nav>((screen: Screen, extra) => {
    setRoute({ screen, ...extra });
  }, []);

  const ScreenComponent = SCREENS[route.screen];

  return (
    <BrandBoundary className={`mc${dark ? " dark" : ""}`}>
      <Topbar nav={nav} dark={dark} setDark={setDark} />
      <div className="mc-shell">
        <Sidebar route={route} nav={nav} />
        <ScreenComponent route={route} nav={nav} />
      </div>
    </BrandBoundary>
  );
}
