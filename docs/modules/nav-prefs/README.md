# Module: nav-prefs

## What

Navigation preferences (navigation redesign P5b, TASK-3855): each person's
"Try the new navigation" switch and whether they have closed its one-screen
tour, stored on the server so both follow the person to every device. This
module owns the `nav_prefs` table and `GET|PATCH /api/nav-prefs`. The switch
in the account menu, the tour and the choice of sidebar are the web module's
(`src/components/mc/nav-zones.ts`, `nav-tour.tsx`, `user-menu.tsx`); this
module only stores the two preferences.

## Why

People must try the new sidebar before it becomes the default, and UAT
(TASK-3856) runs for two weeks without a deploy. A per-person switch lets each
tester turn it on and switch back at any time. A switch kept in one browser's
storage would be lost on the next device, so it lives on the server, like
stars.

## How

1. **Table** — `db/migrations/050_nav_prefs.sql`: one `nav_prefs` row per
   person (`person_id` text primary key, `zones` boolean, `tour_seen_at`,
   `updated_at`). `zones` is true (on), false (switched back) or NULL (never
   used: the build's default applies). `tour_seen_at` is when the person
   first closed the tour. Rollback: `db/rollback/050_nav_prefs_rollback.sql`.
2. **Types** — `NavPrefs` and `NavPrefsChange` (`index.ts`, client-safe).
   `applyNavPrefsChange` is the one rule for a change: each field it gives
   replaces the stored one, and a field it leaves out keeps its value.
3. **Store** — `readNavPrefs(personId)` and `changeNavPrefs(personId,
   change)` (`store.ts`, server-only, imported as `@/lib/nav-prefs/store`).
   A change is one parameterized `INSERT … ON CONFLICT DO UPDATE` that says
   which fields it gives, so two devices changing different preferences at
   once both land; the tour keeps the first time it was closed. Without
   `PLX_MC_DATABASE_URL` it falls back to process-local memory (the stars
   contract), so tests and the e2e server need no database.
4. **API** — `src/app/api/nav-prefs/route.ts`, through the shared `route()`
   wrapper. `GET` returns `{ zones, tourSeen }`. `PATCH` takes one or both,
   `{ zones?: boolean | null, tourSeen?: boolean }` (strict Zod: anything
   else is a 400), and returns what is stored. `zones: null` forgets the
   switch and `tourSeen: false` shows the tour again; the e2e checks use them
   to start clean. The person is the session's Entra object id
   (`sessionPersonId` in `api/session-actor`, shared with stars); the body
   never names it. Dormant local/test mode (no Entra) uses the operator.
5. **Client** — `src/components/mc/nav-zones.ts` reads the switch once per
   page, in either shell, and again on window focus after a failed read. A
   flip shows at once and is saved in order; a refused save puts back what
   the server last confirmed, with a notice. This browser keeps a copy in
   localStorage `mc.nav.zones` ("on" / "off") for the next load and the other
   tabs, and drops it when the server holds no switch, so a second person
   on the same browser does not get the first one's. "1" there is a by-hand
   opt-in for a person who never used the switch. With
   `NEXT_PUBLIC_PLX_MC_NAV_ZONES=1` the whole build has the new navigation,
   nothing is read and the menu offers no switch.

## Dependencies

- `db` (`query`), `secrets` (`databaseConfigured`).
- `api/route` and `api/session-actor` for the route.
- Used by the web module's `nav-zones.ts`, the account menu and the tour.

### Key Files

- `db/migrations/050_nav_prefs.sql` — the table.
- `src/lib/nav-prefs/index.ts` — `NavPrefs`, `NavPrefsChange`, `applyNavPrefsChange` (client-safe).
- `src/lib/nav-prefs/store.ts` — `readNavPrefs`, `changeNavPrefs`, memory fallback.
- `src/app/api/nav-prefs/route.ts` — `GET|PATCH /api/nav-prefs`.
- `tests/nav-prefs-routes.test.ts`, `tests/nav-prefs-postgres.test.ts` — the
  API and the table.

## Owner

Vince Alton

## Criticality

Low — a lost switch costs a person one click in the account menu. Every API
route waits on the schema check, so migration 050 must be live before the
code that lists it deploys (`docs/runbooks/db-migrate.md`).
