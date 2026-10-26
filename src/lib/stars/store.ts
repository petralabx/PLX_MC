// Stars persistence (TASK-3842): one row per person in nav_stars (migration
// 049; the cap is 10 since 053), and the key check the API applies to a new
// star. Uses Postgres when configured; otherwise a process-local fallback keeps
// tests and local dev from needing PLX_MC_DATABASE_URL (the contract the
// skills-directory and vendor-spend stores keep). Server-only.

import { SCREEN_VALUES } from "@/components/mc/route";
import { query } from "@/lib/db";
import { databaseConfigured } from "@/lib/secrets";
import { BUCKET_ID_RE, PROJECT_ID_RE } from "@/lib/sync/mapping";

import { STARS_FULL_MESSAGE, STAR_CAP, applyStarChange, type StarChange, type StarKey } from "./index";

/** Adding a star to a full list: the API answers 409 stars_full. */
export class StarsFullError extends Error {
  constructor() {
    super(STARS_FULL_MESSAGE);
  }
}

export const MAX_STAR_KEY_LENGTH = 120;

// A project or initiative page is starred by its record, and a task never is.
// List and Timeline are views of the All work row, so they star as Board
// (nav-model.ts ALL_WORK_NAV_ITEM.also; tests/mc-stars.test.ts keeps the two in step).
const NOT_A_STAR_SCREEN: ReadonlySet<string> = new Set(["task", "project", "bucket", "list", "timeline"]);
const STAR_SCREENS: ReadonlySet<string> = new Set(SCREEN_VALUES.filter((s) => !NOT_A_STAR_SCREEN.has(s)));

/** Whether `raw` can be a new star: a starrable screen, a PRJ-* project or a BKT-* initiative. */
export function isStarKey(raw: string): raw is StarKey {
  if (raw.length > MAX_STAR_KEY_LENGTH) return false;
  if (raw.startsWith("project:")) return PROJECT_ID_RE.test(raw.slice("project:".length));
  if (raw.startsWith("bucket:")) return BUCKET_ID_RE.test(raw.slice("bucket:".length));
  return raw.startsWith("screen:") && STAR_SCREENS.has(raw.slice("screen:".length));
}

const globalForStars = globalThis as unknown as { __plxNavStars?: Map<string, string[]> };

function memory(): Map<string, string[]> {
  globalForStars.__plxNavStars ??= new Map();
  return globalForStars.__plxNavStars;
}

/** Tests only: forget the memory fallback's stars. */
export function __resetStarsMemoryForTests(): void {
  memory().clear();
}

/** A person's stars, in their order; [] before they star anything. */
export async function readStars(personId: string): Promise<string[]> {
  if (!databaseConfigured()) return [...(memory().get(personId) ?? [])];
  const rows = await query<{ stars: string[] }>("SELECT stars FROM nav_stars WHERE person_id = $1", [personId]);
  return rows[0]?.stars ?? [];
}

/**
 * Apply one change to a person's stars and return the stored list. Each change
 * is one statement on the person's row, so two devices starring at once both
 * land. Adding to a full list changes nothing and throws StarsFullError. A move
 * of a key the row does not hold changes nothing.
 */
export async function changeStars(personId: string, change: StarChange): Promise<string[]> {
  if (!databaseConfigured()) {
    const next = applyStarChange(memory().get(personId) ?? [], change);
    if (next.length > STAR_CAP) throw new StarsFullError();
    memory().set(personId, next);
    return [...next];
  }
  if (change.op === "remove") {
    const rows = await query<{ stars: string[] }>(
      "UPDATE nav_stars SET stars = array_remove(stars, $2::text), updated_at = now() WHERE person_id = $1 RETURNING stars",
      [personId, change.key]
    );
    return rows[0]?.stars ?? [];
  }
  if (change.op === "move") {
    // The list without the key, cut at place `to`, with the key between.
    const rows = await query<{ stars: string[] }>(
      `UPDATE nav_stars
          SET stars = (array_remove(stars, $2::text))[1:$3::int] || ARRAY[$2::text] || (array_remove(stars, $2::text))[$3::int + 1:],
              updated_at = now()
        WHERE person_id = $1 AND $2::text = ANY (stars)
        RETURNING stars`,
      [personId, change.key, change.to]
    );
    return rows[0]?.stars ?? readStars(personId);
  }
  // A full list fails the WHERE, so no row comes back.
  const rows = await query<{ stars: string[] }>(
    `INSERT INTO nav_stars (person_id, stars, updated_at) VALUES ($1, ARRAY[$2::text], now())
     ON CONFLICT (person_id) DO UPDATE
       SET stars = CASE WHEN $2::text = ANY (nav_stars.stars) THEN nav_stars.stars ELSE array_append(nav_stars.stars, $2::text) END,
           updated_at = now()
       WHERE $2::text = ANY (nav_stars.stars) OR cardinality(nav_stars.stars) < $3
     RETURNING stars`,
    [personId, change.key, STAR_CAP]
  );
  if (!rows[0]) throw new StarsFullError();
  return rows[0].stars;
}
