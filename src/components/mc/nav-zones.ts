// The zoned sidebar — navigation redesign Phase 2 (TASK-3840), built to the
// shared PLX shell contract (portal ADR-011). Default OFF.
//
// NEXT_PUBLIC_PLX_MC_NAV_ZONES=1 turns it on for a whole build. One browser can
// also opt in with localStorage `mc.nav.zones` = "1" (UAT and the e2e checks in
// ui-shell-responsive; the per-person switch comes with TASK-3855). The server
// snapshot is the build flag alone, so SSR and the hydrating render agree.
import { useSyncExternalStore } from "react";

export const NAV_ZONES_STORAGE_KEY = "mc.nav.zones";

// Static property access so Next can inline NEXT_PUBLIC_* at build time.
let buildEnabled = process.env.NEXT_PUBLIC_PLX_MC_NAV_ZONES === "1";

/** Tests only: stand in for the build flag. */
export function setNavZonesBuildFlag(on: boolean): void {
  buildEnabled = on;
}

function optedIn(): boolean {
  try {
    return window.localStorage.getItem(NAV_ZONES_STORAGE_KEY) === "1";
  } catch {
    return false; // blocked storage → the default
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

/** Whether this browser shows the zoned sidebar. */
export function useNavZones(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => buildEnabled || optedIn(),
    () => buildEnabled
  );
}
