"use client";

// Starred (TASK-3842): the person's stars, kept on the server (GET|PATCH
// /api/stars) so they follow the person to every device. The zoned shell loads
// them, and again when the window gets focus, so another device's stars show
// up. Each star or unstar shows at once, then goes to the server as single
// changes, in order, one at a time; the server's list after each one replaces
// this copy. A change the server refuses is dropped with the rest of its
// toggle, said on the store's notice channel, and the list is read again, so a
// lost star is never silent. A failed load retries, and on focus. Rows, their
// slots and the cap are nav-model.ts's; a move reorders (TASK-3956).
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";

import { ApiClientError, api } from "@/lib/api";
import { useMcVersion } from "@/lib/mc-data/hooks";
import { allBuckets, allProjects, dataSource, pushNotice } from "@/lib/mc-data/store";
import { STARS_FULL_MESSAGE, STAR_CAP, applyStarChange, type StarChange, type StarKey } from "@/lib/stars";

import { navFlags } from "./nav-flags";
import { starChanges, starRows, type StarRow } from "./nav-model";

type StarsStatus = "idle" | "loading" | "ready" | "error";

interface StarsState {
  status: StarsStatus;
  /** What the person sees: the server's list with the changes not yet confirmed. */
  stars: readonly string[];
}

interface StarsClient {
  get: () => Promise<string[]>;
  change: (change: StarChange) => Promise<string[]>;
}

const defaultClient: StarsClient = {
  get: async () => (await api<{ stars: string[] }>("/stars")).stars,
  change: async (change) =>
    (await api<{ stars: string[] }>("/stars", { method: "PATCH", body: JSON.stringify(change) })).stars,
};

const RETRY_MS = [5_000, 30_000, 120_000];
const NO_ROWS: StarRow[] = [];

let client = defaultClient;
let status: StarsStatus = "idle";
let confirmed: readonly string[] = [];
// Changes not yet confirmed, oldest first; `toggle` groups the changes of one star or unstar.
let queue: { change: StarChange; toggle: number }[] = [];
let toggles = 0;
// Bumped by every change: a read that began before one is out of date.
let generation = 0;
let saving: Promise<void> = Promise.resolve();
let retries = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let refreshing = false;
let state: StarsState = { status, stars: [] };
const listeners = new Set<() => void>();

function publish(): void {
  state = { status, stars: queue.reduce((stars, item) => applyStarChange(stars, item.change), confirmed) };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const snapshot = () => state;

/** Tests only: stand in for the API (null puts the real one back). */
export function __setStarsClientForTests(next: StarsClient | null): void {
  client = next ?? defaultClient;
}

/** Tests only: start over, loaded with `stars` when given. */
export function __resetStarsForTests(stars?: readonly string[]): void {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  confirmed = stars ?? [];
  queue = [];
  generation += 1;
  saving = Promise.resolve();
  retries = 0;
  refreshing = false;
  status = stars ? "ready" : "idle";
  publish();
}

/** Tests only: wait for the changes in flight. */
export function __starsSettled(): Promise<void> {
  return saving;
}

/** Load the person's stars. Until it works, Starred and the toggles stay out; it retries a few times. */
export function loadStars(): void {
  if (status === "loading" || status === "ready") return;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  status = "loading";
  publish();
  client.get().then(
    (stars) => {
      confirmed = stars;
      status = "ready";
      retries = 0;
      publish();
    },
    (err) => {
      console.warn("[mc-stars] stars unavailable, Starred stays hidden for now:", err);
      status = "error";
      publish();
      const wait = RETRY_MS[retries++];
      if (wait !== undefined && typeof window !== "undefined") retryTimer = setTimeout(loadStars, wait);
    }
  );
}

// Read the list again, unless a change has been made since the read began.
function reread(): Promise<void> {
  const at = generation;
  return client.get().then(
    (stars) => {
      if (at !== generation || queue.length > 0) return;
      confirmed = stars;
      publish();
    },
    (err) => console.warn("[mc-stars] could not read the stars again:", err)
  );
}

/** Back on this window: retry a failed load, or pick up another device's stars. */
export function refreshStars(): void {
  if (status === "error") {
    retries = 0;
    loadStars();
    return;
  }
  if (status !== "ready" || queue.length > 0 || refreshing) return;
  refreshing = true;
  void reread().finally(() => {
    refreshing = false;
  });
}

async function sendChanges(): Promise<void> {
  let refused = false;
  while (queue.length > 0) {
    const [{ change, toggle }] = queue;
    try {
      confirmed = await client.change(change);
      queue.shift();
    } catch (err) {
      refused = true;
      // The rest of that star or unstar goes too: an add after a failed remove would only fail again.
      queue = queue.filter((item) => item.toggle !== toggle);
      if (err instanceof ApiClientError && err.code === "stars_full") pushNotice(STARS_FULL_MESSAGE, "info");
      else
        pushNotice(
          `Couldn't save your star. ${err instanceof Error ? err.message : "The server rejected the update."} Starred shows what is saved.`
        );
    }
    publish();
  }
  // A failed request may still have been saved: read what the server holds.
  if (refused) await reread();
}

function send(changes: StarChange[]): void {
  const idle = queue.length === 0;
  toggles += 1;
  generation += 1;
  queue.push(...changes.map((change) => ({ change, toggle: toggles })));
  publish();
  if (idle) saving = sendChanges();
}

export interface Stars {
  /** Not the zoned shell, or the list could not be loaded: no Starred zone, no toggles. */
  off: boolean;
  /** The list has loaded; until then the toggles are disabled. */
  ready: boolean;
  rows: StarRow[];
  /** How many stars the person keeps, shown or not (a screen behind an off flag keeps its slot). */
  count: number;
  /** The row a key would show as, starred or not; undefined when it cannot show or its record is gone. */
  rowFor: (key: StarKey) => StarRow | undefined;
  starred: (key: StarKey) => boolean;
  /** No room for a new star: STAR_CAP stars are kept (a gone one keeps its slot until removed). */
  full: boolean;
  /** Star or unstar `key`. When the stars are full, a new star is refused with a notice. */
  toggle: (key: StarKey) => void;
  /** Put a starred `key` at place `to` (0 first). */
  move: (key: string, to: number) => void;
}

/** The person's stars, for the zoned shell only (`enabled`); off, nothing loads. */
export function useStars(enabled: boolean): Stars {
  const version = useMcVersion();
  const current = useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => {
    if (!enabled) return;
    loadStars();
    window.addEventListener("focus", refreshStars);
    return () => window.removeEventListener("focus", refreshStars);
  }, [enabled]);
  const ready = enabled && current.status === "ready";
  const flags = navFlags();
  const { meetingIntake, routingInbox } = flags;
  // One array until the stars, the store or a flag change, so callers can memoize on it.
  // Stable while `ready` holds, so callers can memoize on them.
  const toggle = useCallback(
    (key: StarKey) => {
      if (!ready) return;
      const changes = starChanges(state.stars, key);
      if (!changes) {
        pushNotice(STARS_FULL_MESSAGE, "info");
        return;
      }
      send(changes);
    },
    [ready]
  );
  const move = useCallback(
    (key: string, to: number) => {
      if (!ready || !state.stars.includes(key) || state.stars.indexOf(key) === to) return;
      send([{ op: "move", key, to }]);
    },
    [ready]
  );
  // Until the server's data is live the records are seed or cached, so no star shows as gone.
  const live = dataSource() === "live";
  const rows = useMemo(() => {
    void version;
    return ready ? starRows(current.stars, allProjects(), allBuckets(), { meetingIntake, routingInbox }, live) : NO_ROWS;
  }, [ready, current.stars, version, meetingIntake, routingInbox, live]);
  return {
    off: !enabled || current.status === "error",
    ready,
    rows,
    count: current.stars.length,
    rowFor: (key) => starRows([key], allProjects(), allBuckets(), flags, false)[0],
    starred: (key) => current.stars.includes(key),
    full: current.stars.length >= STAR_CAP,
    toggle,
    move,
  };
}
