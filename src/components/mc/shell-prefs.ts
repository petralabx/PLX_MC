"use client";

// Shell preferences and tier signals (ADR-005). Each preference is remembered
// in localStorage when it works and always held in memory, so blocked or full
// storage still behaves for the page. Read through useSyncExternalStore with a
// server snapshot, so SSR and the hydrating render agree and no effect has to
// copy storage into state.
//
// Layout never depends on these: CSS owns every width decision. JS only needs
// the tier for behaviour — whether opening a task fills the pane or leaves the
// collection, and whether the pane is an overlay layer or a grid column.
import { useSyncExternalStore } from "react";

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

export interface Pref<T> {
  get(): T;
  /** persist=false updates memory only (e.g. while a drag is in progress). */
  set(value: T, persist?: boolean): void;
  subscribe(listener: () => void): () => void;
}

function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null; // storage access itself can throw (blocked site data)
  }
}

export function createPref<T>(
  key: string,
  decode: (raw: string | null) => T,
  encode: (value: T) => string,
  getStorage: () => Storage | null = browserStorage
): Pref<T> {
  let held: { value: T } | null = null;
  const listeners = new Set<() => void>();
  return {
    get() {
      if (held) return held.value;
      let raw: string | null = null;
      try {
        raw = getStorage()?.getItem(key) ?? null;
      } catch {
        raw = null;
      }
      held = { value: decode(raw) };
      return held.value;
    },
    set(value, persist = true) {
      held = { value };
      if (persist) {
        try {
          getStorage()?.setItem(key, encode(value));
        } catch {
          // not persisted — memory still holds it for this page
        }
      }
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function usePref<T>(pref: Pref<T>, serverValue: T): T {
  return useSyncExternalStore(pref.subscribe, pref.get, () => serverValue);
}

export const PANE_MIN = 360;
export const PANE_MAX = 640;
export const PANE_STEP = 16;

export function clampPaneWidth(width: number): number {
  return Math.round(Math.max(PANE_MIN, Math.min(PANE_MAX, width)));
}

/** User-chosen pane width; null = the tier default from mc-surface.css (440, 520 ≥2200). */
export const paneWidthPref = createPref<number | null>(
  "mc.pane.w",
  (raw) => {
    const n = Number(raw);
    return raw !== null && Number.isFinite(n) && n >= PANE_MIN && n <= PANE_MAX ? n : null;
  },
  (value) => (value === null ? "" : String(value))
);

/** The persistent pane collapsed by the user (≥1600). */
export const paneHiddenPref = createPref<boolean>("mc.pane.hidden", (raw) => raw === "1", (v) => (v ? "1" : "0"));

/** The live column pinned by the user (shown ≥2200 only; dormant below). */
export const livePinnedPref = createPref<boolean>("mc.live.pinned", (raw) => raw === "1", (v) => (v ? "1" : "0"));

// One stable subscribe function per query, so useSyncExternalStore does not
// resubscribe on every render.
const mediaSubscribers = new Map<string, (listener: () => void) => () => void>();

function subscribeMedia(query: string) {
  let subscribe = mediaSubscribers.get(query);
  if (!subscribe) {
    subscribe = (listener: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", listener);
      return () => list.removeEventListener("change", listener);
    };
    mediaSubscribers.set(query, subscribe);
  }
  return subscribe;
}

/** True while the viewport is at least `px` wide (ADR-005 tiers: 641 / 1025 / 1600 / 2200). */
export function useMinWidth(px: 641 | 1025 | 1600 | 2200): boolean {
  const query = `(min-width: ${px}px)`;
  return useSyncExternalStore(subscribeMedia(query), () => window.matchMedia(query).matches, () => false);
}

export function minWidthNow(px: 641 | 1025 | 1600 | 2200): boolean {
  return typeof window !== "undefined" && window.matchMedia(`(min-width: ${px}px)`).matches;
}
