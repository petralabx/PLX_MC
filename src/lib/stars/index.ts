// Starred (TASK-3842): what nav_stars keeps per person, and the one change at a
// time the API applies. Client-safe, with no imports; the server-only store and
// key check are ./store.ts, imported separately, as @/lib/api/route is (module
// contract: docs/modules/stars/README.md).

/** At most this many stars per person (also a CHECK on nav_stars, migration 049). */
export const STAR_CAP = 6;

export const STARS_FULL_MESSAGE = `You can keep up to ${STAR_CAP} stars. Unstar one first.`;

/** A screen ('screen:goals'), a project ('project:PRJ-…') or an initiative ('bucket:BKT-…'). */
export type StarKey = `screen:${string}` | `project:${string}` | `bucket:${string}`;

/**
 * One change to a person's stars. The API applies one at a time, so a device
 * never overwrites another's. A remove takes any stored key, so a star that no
 * longer checks out can still go.
 */
export type StarChange = { op: "add"; key: StarKey } | { op: "remove"; key: string };

/** The stars after one change: a new star goes last, and adding or removing it twice changes nothing. */
export function applyStarChange(stars: readonly string[], change: StarChange): string[] {
  if (change.op === "remove") return stars.filter((k) => k !== change.key);
  return stars.includes(change.key) ? [...stars] : [...stars, change.key];
}
