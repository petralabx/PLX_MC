-- Rollback for db/migrations/053_nav_stars_cap_10.sql. NOT a numbered migration —
-- kept out of db/migrations/ so the migration gate's "one row per numeric prefix"
-- rule is not tripped. Run manually ONLY to undo the 10-star cap, after the code
-- that allows 10 (STAR_CAP in src/lib/stars) has been reverted to 6.
--
-- It refuses while anyone holds more than 6 stars: putting the cap back would
-- otherwise fail on their rows, or would have to drop stars they chose. Ask them
-- to unstar down to 6 first. Nothing is deleted.

DO $$
DECLARE
    over integer;
BEGIN
    SELECT count(*) INTO over FROM nav_stars WHERE cardinality(stars) > 6;
    IF over > 0 THEN
        RAISE EXCEPTION 'nav_stars: % person(s) hold more than 6 stars; they must unstar down to 6 before this rollback', over;
    END IF;
END $$;

ALTER TABLE nav_stars DROP CONSTRAINT IF EXISTS nav_stars_stars_check;
ALTER TABLE nav_stars
    ADD CONSTRAINT nav_stars_stars_check
    CHECK (cardinality(stars) <= 6 AND array_position(stars, NULL) IS NULL);
DELETE FROM schema_migrations WHERE filename = '053_nav_stars_cap_10.sql';
