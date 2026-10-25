// Navigation preferences persistence (TASK-3855): one row per person in
// nav_prefs (migration 050). Uses Postgres when configured; otherwise a
// process-local fallback keeps tests and local dev from needing
// PLX_MC_DATABASE_URL (the contract the stars and skills-directory stores
// keep). Server-only.

import { query } from "@/lib/db";
import { databaseConfigured } from "@/lib/secrets";

import { NO_NAV_PREFS, applyNavPrefsChange, type NavPrefs, type NavPrefsChange } from "./index";

const globalForNavPrefs = globalThis as unknown as { __plxNavPrefs?: Map<string, NavPrefs> };

function memory(): Map<string, NavPrefs> {
  globalForNavPrefs.__plxNavPrefs ??= new Map();
  return globalForNavPrefs.__plxNavPrefs;
}

/** Tests only: forget the memory fallback's preferences. */
export function __resetNavPrefsMemoryForTests(): void {
  memory().clear();
}

interface PrefsRow {
  zones: boolean | null;
  tour_seen: boolean;
}

const toPrefs = (row: PrefsRow | undefined): NavPrefs =>
  row ? { zones: row.zones, tourSeen: row.tour_seen } : { ...NO_NAV_PREFS };

/** A person's preferences; the defaults before they use the switch. */
export async function readNavPrefs(personId: string): Promise<NavPrefs> {
  if (!databaseConfigured()) return { ...(memory().get(personId) ?? NO_NAV_PREFS) };
  const rows = await query<PrefsRow>(
    "SELECT zones, tour_seen_at IS NOT NULL AS tour_seen FROM nav_prefs WHERE person_id = $1",
    [personId]
  );
  return toPrefs(rows[0]);
}

// One statement on the person's row. $3 and $5 say whether the change gives
// zones ($2) and tourSeen ($4); a field it leaves out keeps its value, and the
// tour keeps the first time it was closed.
const CHANGE_SQL = `INSERT INTO nav_prefs AS p (person_id, zones, tour_seen_at)
  VALUES ($1, $2::boolean, CASE WHEN $4::boolean THEN now() END)
  ON CONFLICT (person_id) DO UPDATE SET
    zones = CASE WHEN $3::boolean THEN EXCLUDED.zones ELSE p.zones END,
    tour_seen_at = CASE WHEN NOT $5::boolean THEN p.tour_seen_at WHEN $4::boolean THEN coalesce(p.tour_seen_at, now()) END,
    updated_at = now()
  RETURNING zones, tour_seen_at IS NOT NULL AS tour_seen`;

/** Apply a change to a person's preferences and return what is stored. */
export async function changeNavPrefs(personId: string, change: NavPrefsChange): Promise<NavPrefs> {
  if (!databaseConfigured()) {
    const next = applyNavPrefsChange(memory().get(personId) ?? NO_NAV_PREFS, change);
    memory().set(personId, next);
    return { ...next };
  }
  const rows = await query<PrefsRow>(CHANGE_SQL, [
    personId,
    change.zones ?? null,
    change.zones !== undefined,
    change.tourSeen ?? false,
    change.tourSeen !== undefined,
  ]);
  return toPrefs(rows[0]);
}
