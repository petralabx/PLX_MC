"use client";

// React binding for the Mission Control store. Components call useMcVersion()
// once, then read store getters — the version bump re-renders them after any
// store action (the prototype's `mc-sync` window event, made idiomatic).
import { useSyncExternalStore } from "react";

import { activeNotices, getVersion, subscribe, subscribeNotices, viewer } from "./store";
import type { Notice } from "./store";
import type { Human } from "./types";

export function useMcVersion(): number {
  return useSyncExternalStore(subscribe, getVersion, getVersion);
}

// The signed-in viewer the server resolved (GET /api/viewer), or null until it
// has — the replacement for the old hardcoded CURRENT_USER. The server
// snapshot is null so SSR and the hydrating render agree.
export function useViewer(): Human | null {
  return useSyncExternalStore(subscribe, viewer, () => null);
}

// The notice channel (rollback-on-PATCH-failure surfacing). Separate from the
// version channel so a transient notice never forces a board-wide re-render.
const NO_NOTICES: Notice[] = [];

export function useMcNotices(): Notice[] {
  return useSyncExternalStore(subscribeNotices, activeNotices, () => NO_NOTICES);
}
