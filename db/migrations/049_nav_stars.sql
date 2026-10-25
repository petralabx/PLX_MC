-- Starred (navigation redesign P2c, TASK-3842). Additive and idempotent.
--
-- One row per person: the screens, projects and initiatives they starred, in
-- their order, so stars follow them to every device (as MRP pins do in the
-- portal). person_id is the signed-in person's Entra object id (the operator's
-- directory id in dormant local mode), which survives an email or directory
-- change. Keys are 'screen:<screen>', 'project:PRJ-…' or 'bucket:BKT-…'; the API
-- checks a new key's shape, and each change adds or removes one key, so none
-- repeats. At most 6 stars, enforced here too. Nothing else references this
-- table. Rollback: db/rollback/049_nav_stars_rollback.sql.

CREATE TABLE IF NOT EXISTS nav_stars (
    person_id  text PRIMARY KEY CHECK (person_id <> ''),
    stars      text[] NOT NULL DEFAULT '{}'
               CHECK (cardinality(stars) <= 6 AND array_position(stars, NULL) IS NULL),
    updated_at timestamptz NOT NULL DEFAULT now()
);
