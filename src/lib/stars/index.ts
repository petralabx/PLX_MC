// Starred (TASK-3842): what nav_stars keeps per person, and the one change at a
// time the API applies. Client-safe, with no imports; the server-only store and
// key check are ./store.ts, imported separately, as @/lib/api/route is (module
// contract: docs/modules/stars/README.md).

/** At most this many stars per person (also a CHECK on nav_stars, migration 053; 6 before TASK-3956). */
export const STAR_CAP = 10;

/** What an eleventh star is refused with (portal ADR-011 v2, Starred 7). */
export const STARS_FULL_MESSAGE = "Starred is full. Unstar one to add another.";

/** A screen ('screen:goals'), a project ('project:PRJ-…') or an initiative ('bucket:BKT-…'). */
export type StarKey = `screen:${string}` | `project:${string}` | `bucket:${string}`;

/**
 * One change to a person's stars. The API applies one at a time, so a device
 * never overwrites another's. A remove takes any stored key, so a star that no
 * longer checks out can still go. A move puts a stored key at place `to`
 * (0 first), so a person can reorder (TASK-3956).
 */
export type StarChange =
  | { op: "add"; key: StarKey }
  | { op: "remove"; key: string }
  | { op: "move"; key: string; to: number };

/**
 * The stars after one change: a new star goes last, and adding or removing it
 * twice changes nothing. A move of a key that is not there changes nothing; a
 * place past the end means last.
 */
export function applyStarChange(stars: readonly string[], change: StarChange): string[] {
  if (change.op === "remove") return stars.filter((k) => k !== change.key);
  if (change.op === "move") {
    if (!stars.includes(change.key)) return [...stars];
    const rest = stars.filter((k) => k !== change.key);
    const to = Math.max(0, Math.min(change.to, rest.length));
    return [...rest.slice(0, to), change.key, ...rest.slice(to)];
  }
  return stars.includes(change.key) ? [...stars] : [...stars, change.key];
}
