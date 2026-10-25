// The zoned sidebar — navigation redesign Phase 2 (TASK-3840), built to the
// shared PLX shell contract (portal ADR-011). Default OFF.
//
// Who sees it:
// - NEXT_PUBLIC_PLX_MC_NAV_ZONES=1 turns it on for a whole build, and then
//   there is no switch (the default flip, TASK-3857).
// - Otherwise the person's "Try the new navigation" switch in the account menu
//   decides (TASK-3855). GET|PATCH /api/nav-prefs keeps it on the server, so it
//   follows them to every device.
// - This browser keeps a copy in localStorage `mc.nav.zones` ("on" / "off"), so
//   a reload shows the right navigation before the server answers, and other
//   tabs follow a flip. When the server holds no switch (another person signed
//   in here, or the switch was forgotten), the copy goes.
// - "1" there opts one browser in by hand, for a person who never used the
//   switch (UAT, and the e2e checks); the person's switch still wins.
// The server snapshot is the build flag alone, so SSR and the hydrating render
// agree.
//
// The first time the switch is on, the shell shows the one-screen tour
// (nav-tour.tsx) until the person closes it; the server keeps that too. A flip
// shows at once and is then saved, in order; a refused save puts back what the
// server last confirmed and says so on the store's notice channel.
import { useSyncExternalStore } from "react";

import { ApiClientError, api } from "@/lib/api";
import { pushNotice } from "@/lib/mc-data/store";
import type { NavPrefs, NavPrefsChange } from "@/lib/nav-prefs";

export const NAV_ZONES_STORAGE_KEY = "mc.nav.zones";

const BY_HAND = "1";
const copyOf = (on: boolean) => (on ? "on" : "off");

// Static property access so Next can inline NEXT_PUBLIC_* at build time.
let buildEnabled = process.env.NEXT_PUBLIC_PLX_MC_NAV_ZONES === "1";

interface NavPrefsClient {
  get: () => Promise<NavPrefs>;
  change: (change: NavPrefsChange) => Promise<NavPrefs>;
}

const defaultClient: NavPrefsClient = {
  get: () => api<NavPrefs>("/nav-prefs"),
  change: (change) => api<NavPrefs>("/nav-prefs", { method: "PATCH", body: JSON.stringify(change) }),
};

let client = defaultClient;
// This browser's copy as this tab shows it; undefined until read.
let shown: string | null | undefined;
// The copy as of the last answer this tab trusts: a refused flip goes back to it.
let saved: string | null = null;
let tourSeen = false;
let tourOpen = false;
let loaded = false;
// Bumped by every flip in this tab: an answer to a request sent before one is out of date.
let generation = 0;
// Bumped by every save the server confirms.
let confirmations = 0;
let saving: Promise<void> = Promise.resolve();
const listeners = new Set<() => void>();

function publish(): void {
  for (const listener of listeners) listener();
}

function readCopy(): string | null {
  try {
    return window.localStorage.getItem(NAV_ZONES_STORAGE_KEY);
  } catch {
    return null; // blocked storage → the default
  }
}

function writeCopy(next: string | null): void {
  shown = next;
  try {
    if (next === null) window.localStorage.removeItem(NAV_ZONES_STORAGE_KEY);
    else window.localStorage.setItem(NAV_ZONES_STORAGE_KEY, next);
  } catch {
    // not kept for the next load — this page still shows it
  }
}

function copy(): string | null {
  if (shown === undefined) {
    shown = readCopy();
    saved = shown;
  }
  return shown;
}

// Another tab flipped the switch, or heard from the server: follow it.
function onStorage(event: StorageEvent): void {
  if (event.key !== NAV_ZONES_STORAGE_KEY && event.key !== null) return;
  shown = saved = readCopy();
  publish();
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) window.addEventListener("storage", onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

/** The switch's state for code outside React; the hooks below read the same. */
export const navZonesStore = {
  /** This browser shows the zoned sidebar. */
  zoned: (): boolean => {
    const value = copy();
    return buildEnabled || value === "on" || value === BY_HAND;
  },
  /** The shell shows the one-screen tour (only over the zoned sidebar). */
  tourShown: (): boolean => tourOpen && navZonesStore.zoned(),
  subscribe,
};

/** Tests only: stand in for the build flag. */
export function setNavZonesBuildFlag(on: boolean): void {
  buildEnabled = on;
  publish();
}

/** Tests only: stand in for the API (null puts the real one back). */
export function __setNavPrefsClientForTests(next: NavPrefsClient | null): void {
  client = next ?? defaultClient;
}

/** Tests only: forget the switch, the tour and the load. */
export function __resetNavZonesForTests(): void {
  shown = undefined;
  saved = null;
  tourSeen = false;
  tourOpen = false;
  loaded = false;
  generation += 1;
  confirmations = 0;
  saving = Promise.resolve();
  publish();
}

/** Tests only: wait for the saves in flight. */
export function __navPrefsSettled(): Promise<void> {
  return saving;
}

/**
 * Read the person's switch from the server: once per page, and again (the
 * shell calls it on window focus) only after a failed read.
 */
export function loadNavPrefs(): void {
  if (loaded || buildEnabled) return;
  loaded = true;
  const at = generation;
  const confirmedAt = confirmations;
  const before = copy();
  client.get().then(
    (prefs) => {
      // Seen here or on another device: a tour opened before this answer closes.
      if (prefs.tourSeen) {
        tourSeen = true;
        tourOpen = false;
      }
      const next = prefs.zones !== null ? copyOf(prefs.zones) : before === BY_HAND ? BY_HAND : null;
      if (at !== generation) {
        // A flip here is newer and shows, but a refused one goes back to what the server held.
        if (confirmations === confirmedAt) saved = next;
      } else if (readCopy() === before) {
        // Unless another tab wrote since this read began: its copy is newer.
        if (next !== before) writeCopy(next);
        saved = next;
        // Turned on, on another device or before a reload, and the tour still unseen.
        if (prefs.zones === true && !tourSeen) tourOpen = true;
      }
      publish();
    },
    (err) => {
      // A refusal (no Entra session, a revoked person) stays; anything else is read again.
      if (!(err instanceof ApiClientError && err.code === "forbidden")) loaded = false;
      console.warn("[mc-nav] the navigation switch could not be read; this browser's copy stands:", err);
    }
  );
}

// Save in order, one request at a time. A refused save is undone unless a
// newer flip has its own save on the way.
function save(change: NavPrefsChange, undo: () => void, tell: boolean): void {
  const at = generation;
  saving = saving.then(() =>
    client.change(change).then(
      (prefs) => {
        confirmations += 1;
        if (typeof change.zones === "boolean") saved = copyOf(change.zones);
        if (!prefs.tourSeen || tourSeen) return;
        // Seen on another device before this page knew: close the tour it opened.
        tourSeen = true;
        tourOpen = false;
        publish();
      },
      (err) => {
        if (at !== generation) return;
        undo();
        publish();
        if (!tell) {
          console.warn("[mc-nav] could not save that the tour was seen:", err);
          return;
        }
        pushNotice(
          `Couldn't save the navigation switch. ${err instanceof Error ? err.message : "The server rejected the update."} Your navigation is as it was.`
        );
      }
    )
  );
  // Keep the queue going for the next save, whatever went wrong in this one.
  saving = saving.catch((err) => console.error("[mc-nav] a navigation switch save failed to finish:", err));
}

function flip(on: boolean, change: NavPrefsChange, undoMore?: () => void): void {
  copy();
  generation += 1;
  writeCopy(copyOf(on));
  tourOpen = on && !tourSeen;
  publish();
  save(
    change,
    () => {
      writeCopy(saved);
      tourOpen = false;
      undoMore?.();
    },
    true
  );
}

/**
 * The switch: on shows the new navigation, and the tour the first time; off
 * switches back. True when the tour opened.
 */
export function setNavSwitch(on: boolean): boolean {
  flip(on, { zones: on });
  return tourOpen;
}

/** Close the tour: Got it, or Switch back. Either way it is seen. */
export function closeNavTour({ switchBack = false }: { switchBack?: boolean } = {}): void {
  const seenBefore = tourSeen;
  tourSeen = true;
  const unsee = () => {
    tourSeen = seenBefore;
  };
  if (switchBack) {
    flip(false, { zones: false, tourSeen: true }, unsee);
    return;
  }
  tourOpen = false;
  publish();
  save({ tourSeen: true }, unsee, false);
}

/** Whether this browser shows the zoned sidebar. */
export function useNavZones(): boolean {
  return useSyncExternalStore(subscribe, navZonesStore.zoned, () => buildEnabled);
}

/** Whether the shell shows the one-screen tour. */
export function useNavTour(): boolean {
  return useSyncExternalStore(subscribe, navZonesStore.tourShown, () => false);
}

export interface NavSwitch {
  /** The account menu offers the switch: not when the whole build has the new navigation. */
  offered: boolean;
  on: boolean;
  /** True when the tour opened. */
  set: (on: boolean) => boolean;
}

/** The "Try the new navigation" switch, for the account menu. */
export function useNavSwitch(): NavSwitch {
  const on = useNavZones();
  return { offered: !buildEnabled, on: !buildEnabled && on, set: setNavSwitch };
}
