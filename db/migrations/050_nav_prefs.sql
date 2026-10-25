-- Navigation preferences (navigation redesign P5b, TASK-3855). Additive and
-- idempotent.
--
-- One row per person: their "Try the new navigation" switch and whether they
-- have closed its one-screen tour, so both follow them to every device.
-- person_id is the signed-in person's Entra object id (the operator's directory
-- id in dormant local mode), as in nav_stars (049). zones is true (on), false
-- (switched back) or NULL (never used: the build's default applies).
-- tour_seen_at is when they first closed the tour; NULL shows it the next time
-- the switch is on. Nothing else references this table.
-- Rollback: db/rollback/050_nav_prefs_rollback.sql.

CREATE TABLE IF NOT EXISTS nav_prefs (
    person_id    text PRIMARY KEY CHECK (person_id <> ''),
    zones        boolean,
    tour_seen_at timestamptz,
    updated_at   timestamptz NOT NULL DEFAULT now()
);
