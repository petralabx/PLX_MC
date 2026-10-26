# Module: stars

## What

Starred (navigation redesign P2c, TASK-3842): the screens, projects and
initiatives a person stars, stored per person on the server so they follow the
person to every device, the way MRP pins work in the portal. This module owns
the `nav_stars` table, the star key rule and `GET|PATCH /api/stars`. The
sidebar's Starred zone and the star toggles are the web module's
(`src/components/mc/`); this module only stores and checks the list.

## Why

Mission Control's sidebar holds what a person uses, not everything (portal
ADR-011, the shared PLX shell contract). A star kept in one browser's storage
would be lost on the next device, so Vince chose server-side stars on
2026-10-24, matching MRP pins.

## How

1. **Table** — `db/migrations/049_nav_stars.sql`: one `nav_stars` row per
   person (`person_id` text primary key, `stars` text[], `updated_at`). The
   table checks the cap (at most 6) and that no element is NULL. Rollback:
   `db/rollback/049_nav_stars_rollback.sql`.
2. **Keys** — `isStarKey` (`index.ts`, client-safe): `screen:<screen>` for any
   screen but a task, project or initiative page, `project:PRJ-…` or
   `bucket:BKT-…` (the sync mapping's id rules), at most 120 characters.
   `STAR_CAP` is 6. `applyStarChange` is the one rule for a change: a new
   star goes last, and adding or removing it twice changes nothing.
3. **Store** — `readStars(personId)` and `changeStars(personId, change)`
   (`store.ts`, server-only, imported as `@/lib/stars/store` the way
   `@/lib/api/route` is). Each change is one parameterized statement on the
   person's row: an `INSERT … ON CONFLICT DO UPDATE` that appends once and
   leaves a full list alone, or an `array_remove`. So two devices changing
   stars at once both land, and racing adds stop at 6. A full list throws
   `StarsFullError`. Without `PLX_MC_DATABASE_URL` it falls back to
   process-local memory (the skills-directory and vendor-spend contract), so
   tests and the e2e server need no database.
4. **API** — `src/app/api/stars/route.ts`, through the shared `route()`
   wrapper. `GET` returns `{ stars }`. `PATCH` takes one change,
   `{ op: "add" | "remove", key }` (Zod), and returns the stored list; a full
   list answers 409 `stars_full`. No request ever sends a whole list, so a
   stale tab cannot overwrite another device's stars. The person is the
   session's Entra object id (`requireSessionActor("task.read")`), which
   survives an email or directory change; the body never names it. Dormant
   local/test mode (no Entra) uses the operator, as `resolveViewer` does.
5. **Client** — `src/components/mc/use-stars.ts` loads the list in the zoned
   shell, and again on window focus to pick up other devices' stars. Each
   change shows at once and goes to the server in order, one at a time; the
   server's list replaces the copy, and a refused change is put back with a
   notice. A failed load retries a few times, and on focus. `nav-model.ts`
   turns keys into rows (a closed or archived record still shows). A star
   that cannot show (its record is gone, or its screen is behind an off flag)
   keeps its place until the list is full and the person stars something
   new; then it makes room.

## Dependencies

- `db` (`query`), `secrets` (`databaseConfigured`), `sync/mapping` (project
  and initiative id rules).
- `api/route` and `api/session-actor` (`sessionPersonId`, shared with
  `nav-prefs`) for the route.
- Used by the web module's zoned sidebar, top bar and More sheet.

### Key Files

- `db/migrations/049_nav_stars.sql` — the table.
- `src/lib/stars/index.ts` — `STAR_CAP`, `isStarKey`, `applyStarChange` (client-safe).
- `src/lib/stars/store.ts` — `readStars`, `changeStars`, `StarsFullError`, memory fallback.
- `src/app/api/stars/route.ts` — `GET|PATCH /api/stars`.
- `tests/stars-routes.test.ts`, `tests/stars-postgres.test.ts` — the API and
  the table.

## Owner

Vince Alton

## Criticality

Low — a lost star costs a person one click to star again. Every API route
waits on the schema check, so migration 049 must be live before the code that
lists it deploys (`docs/runbooks/db-migrate.md`).
