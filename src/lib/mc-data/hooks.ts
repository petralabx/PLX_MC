"use client";

// React binding for the Mission Control store. Components call useMcVersion()
// once, then read store getters — the version bump re-renders them after any
// store action (the prototype's `mc-sync` window event, made idiomatic).
import { useSyncExternalStore } from "react";

import { activeNotices, getVersion, subscribe, subscribeNotices } from "./store";
import type { Notice } from "./store";

export function useMcVersion(): number {
  return useSyncExternalStore(subscribe, getVersion, getVersion);
}

// The notice channel (rollback-on-PATCH-failure surfacing). Separate from the
// version channel so a transient notice never forces a board-wide re-render.
const NO_NOTICES: Notice[] = [];

export function useMcNotices(): Notice[] {
  return useSyncExternalStore(subscribeNotices, activeNotices, () => NO_NOTICES);
}
