-- EN-005 / WS-5: persist the repo registry (= allow-list) and the self-service
-- request queue server-side, so the server task mutation validates against the
-- SAME runtime registry the client uses (kills the static-REPOS allow-list drift,
-- EN-005 obs. #7). Mirrors the sync/compliance entity-store pattern: additive +
-- idempotent (CREATE TABLE IF NOT EXISTS), no DROP/ALTER of existing schema,
-- timestamps in UTC (timestamptz). A SharePoint "Repo Registry" list is deferred
-- to the EN-006 sync increment (site unprovisioned).

-- mc_repos — the registry/allow-list. Seeded from the data.ts REPOS fixture on
-- first run (ensureRegistrySeeded, ON CONFLICT DO NOTHING); an approved request
-- inserts a row. Columns mirror the Repo TS shape (lib/mc-data/types.ts).
CREATE TABLE IF NOT EXISTS mc_repos (
    id         text PRIMARY KEY,
    name       text NOT NULL,
    lang       text NOT NULL DEFAULT '—',
    def        text NOT NULL DEFAULT 'main',
    owner      text NOT NULL,
    visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('public', 'private')),
    scope      text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- mc_repo_requests — the self-service request queue (request → approve). A repo
-- joins mc_repos only through an approver-gated, GitHub-validated approval. The
-- request's verified flag is set server-side at validate time; the registry is
-- never populated from an unverified request. Columns mirror the RepoRequest TS
-- shape; requested_at/decided_at are timestamptz (rendered to the prototype stamp
-- string in the accessor, like sync_audit_log).
CREATE TABLE IF NOT EXISTS mc_repo_requests (
    id           text PRIMARY KEY,
    name         text NOT NULL,
    owner        text NOT NULL,
    lang         text,
    visibility   text CHECK (visibility IN ('public', 'private')),
    scope        text,
    def          text,
    requested_by text NOT NULL,
    requested_at timestamptz NOT NULL DEFAULT now(),
    status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    verified     boolean NOT NULL DEFAULT false,
    note         text,
    decided_by   text,
    decided_at   timestamptz
);

CREATE INDEX IF NOT EXISTS mc_repo_requests_status_idx ON mc_repo_requests (status, requested_at DESC);
