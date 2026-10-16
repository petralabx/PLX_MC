-- TASK-3026: the checkout-principal lookups (getDispatchCheckoutPrincipal,
-- hasActiveCheckoutForPrincipal in src/lib/compliance/repo.ts) filter
-- mc_events on kind = 'checkout' AND payload->>'checkoutId' = $1. No existing
-- index covers the payload key (only (kind, ts), (kind, seq) and dedup_key),
-- so each lookup walks every checkout event. A partial expression index on
-- the checkout rows serves both queries. Additive and safe to run twice.
--
-- The runner (scripts/migrate.mjs) wraps each file in a transaction, so this
-- is a plain CREATE INDEX (CONCURRENTLY cannot run inside a transaction); it
-- blocks mc_events writes for the length of the build.
--
-- ROLLBACK:
--   DROP INDEX IF EXISTS mc_events_checkout_id_idx;
--   DELETE FROM schema_migrations WHERE filename = '041_mc_events_checkout_id_idx.sql';

CREATE INDEX IF NOT EXISTS mc_events_checkout_id_idx
    ON mc_events ((payload->>'checkoutId'))
    WHERE kind = 'checkout';
