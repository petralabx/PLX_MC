-- Starred holds 10 (navigation v2, TASK-3956; portal ADR-011 v2 amendment,
-- Starred 1). Raises nav_stars' cap from 6 to 10; nothing else changes.
--
-- 049 declared the cap as an unnamed column CHECK, so this drops every CHECK
-- on nav_stars that counts the stars, whatever Postgres named it, and adds the
-- cap back under a fixed name. Re-running it drops and re-adds the same CHECK.
-- Raising a cap never fails on the rows already there.
-- Rollback: db/rollback/053_nav_stars_cap_10_rollback.sql (refuses while anyone
-- holds more than 6 stars).

DO $$
DECLARE
    old record;
BEGIN
    FOR old IN
        SELECT conname
          FROM pg_constraint
         WHERE conrelid = 'nav_stars'::regclass
           AND contype = 'c'
           AND pg_get_constraintdef(oid) LIKE '%cardinality(stars)%'
    LOOP
        EXECUTE format('ALTER TABLE nav_stars DROP CONSTRAINT %I', old.conname);
    END LOOP;
END $$;

ALTER TABLE nav_stars
    ADD CONSTRAINT nav_stars_stars_check
    CHECK (cardinality(stars) <= 10 AND array_position(stars, NULL) IS NULL);
