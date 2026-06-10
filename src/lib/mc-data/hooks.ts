"use client";

// React binding for the Mission Control store. Components call useMcVersion()
// once, then read store getters — the version bump re-renders them after any
// store action (the prototype's `mc-sync` window event, made idiomatic).
import { useSyncExternalStore } from "react";

import { getVersion, subscribe } from "./store";

export function useMcVersion(): number {
  return useSyncExternalStore(subscribe, getVersion, getVersion);
}
