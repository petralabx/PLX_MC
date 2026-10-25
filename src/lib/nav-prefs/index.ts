// Navigation preferences (TASK-3855): what nav_prefs keeps per person, and the
// change the API applies. Client-safe, with no imports; the server-only store is
// ./store.ts, imported separately, as @/lib/stars/store is (module contract:
// docs/modules/nav-prefs/README.md).

export interface NavPrefs {
  /** The "Try the new navigation" switch: on, switched back, or never used (null: the build's default). */
  zones: boolean | null;
  /** The person has closed the one-screen tour. */
  tourSeen: boolean;
}

/** One or both preferences. `zones: null` forgets the switch; `tourSeen: false` shows the tour again. */
export interface NavPrefsChange {
  zones?: boolean | null;
  tourSeen?: boolean;
}

export const NO_NAV_PREFS: NavPrefs = { zones: null, tourSeen: false };

/** The preferences after a change: each field it gives replaces the stored one. */
export function applyNavPrefsChange(prefs: NavPrefs, change: NavPrefsChange): NavPrefs {
  return {
    zones: change.zones === undefined ? prefs.zones : change.zones,
    tourSeen: change.tourSeen ?? prefs.tourSeen,
  };
}
