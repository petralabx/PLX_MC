"use client";

// React binding for the meeting-intake triage store (EN-004 / WS-4). Mirrors
// mc-data/hooks.ts: a component calls useMeetingIntakeVersion() once, then reads
// the store getters — the version bump re-renders it after any triage action.
import { useSyncExternalStore } from "react";

import { getIntakeVersion, subscribe } from "./store";

export function useMeetingIntakeVersion(): number {
  return useSyncExternalStore(subscribe, getIntakeVersion, getIntakeVersion);
}
