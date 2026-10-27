-- Draft Projects, step 2 (TASK-4059; PRD docs/product/PRD-draft-projects.md).
-- Additive and idempotent. Two new tables and a sequence; nothing else changes.
--
-- drafts holds each draft's working copy (title, plan, research) in `working`,
-- with its reviews in `reviews`, the house pattern for approval gates and
-- questions on a task. draft_versions holds each frozen version. A version is
-- immutable: its digest (sha256 over its canonical content) is its identity, and
-- a trigger refuses UPDATE and DELETE. Drafts are DB-only: no SharePoint list.
--
-- The accept and materialized columns are for step 3, so step 3 needs no
-- migration of its own. Nothing outside src/lib/drafts reads these tables.
-- Rollback: db/rollback/056_drafts_rollback.sql.

CREATE SEQUENCE IF NOT EXISTS mc_draft_id_seq;

CREATE TABLE IF NOT EXISTS drafts (
    id              text PRIMARY KEY CHECK (id ~ '^DRF-[0-9]+$'),
    status          text NOT NULL DEFAULT 'drafting'
                    CHECK (status IN ('drafting', 'in_review', 'accepted', 'withdrawn')),
    author          text NOT NULL CHECK (author <> ''),
    created_by      text NOT NULL CHECK (created_by <> ''),
    visibility      text NOT NULL DEFAULT 'shared' CHECK (visibility IN ('shared', 'restricted')),
    members         text[] NOT NULL DEFAULT '{}',
    reviewers       text[] NOT NULL DEFAULT '{}',
    version         integer NOT NULL DEFAULT 0 CHECK (version >= 0),
    digest          text CHECK (digest ~ '^sha256:[0-9a-f]{64}$'),
    working         jsonb NOT NULL,
    reviews         jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(reviews) = 'array'),
    materialized    jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(materialized) = 'object'),
    accepted_at     timestamptz,
    accepted_by     text,
    withdrawn_at    timestamptz,
    withdrawn_by    text,
    withdraw_reason text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    -- A digest exists exactly when a version has been frozen.
    CONSTRAINT drafts_version_digest CHECK ((version = 0) = (digest IS NULL)),
    -- Review needs a frozen version.
    CONSTRAINT drafts_review_has_version CHECK (status = 'drafting' OR status = 'withdrawn' OR version > 0)
);

CREATE INDEX IF NOT EXISTS drafts_status_updated_idx ON drafts (status, updated_at DESC);
CREATE INDEX IF NOT EXISTS drafts_author_idx ON drafts (author);

CREATE TABLE IF NOT EXISTS draft_versions (
    draft_id   text NOT NULL REFERENCES drafts (id),
    version    integer NOT NULL CHECK (version >= 1),
    digest     text NOT NULL CHECK (digest ~ '^sha256:[0-9a-f]{64}$'),
    content    jsonb NOT NULL,
    frozen_by  text NOT NULL CHECK (frozen_by <> ''),
    frozen_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (draft_id, version)
);

CREATE OR REPLACE FUNCTION draft_versions_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'draft versions are immutable' USING ERRCODE = '23514';
END;
$$;

DROP TRIGGER IF EXISTS draft_versions_no_change ON draft_versions;
CREATE TRIGGER draft_versions_no_change
    BEFORE UPDATE OR DELETE ON draft_versions
    FOR EACH ROW EXECUTE FUNCTION draft_versions_immutable();
