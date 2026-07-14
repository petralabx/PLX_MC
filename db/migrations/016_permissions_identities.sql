-- Permissions identities — durable Entra users, verified GitHub links, and
-- service principals. Additive / idempotent only (IF NOT EXISTS / ON CONFLICT;
-- no destructive table operations).

CREATE TABLE IF NOT EXISTS mc_users (
    id            text PRIMARY KEY,
    entra_oid     text NOT NULL UNIQUE,
    email         text NOT NULL,
    display_name  text,
    access_role   text NOT NULL
                  CHECK (access_role IN ('owner', 'admin', 'member')),
    status        text NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'revoked')),
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS mc_users_entra_oid_idx
    ON mc_users (entra_oid);

CREATE INDEX IF NOT EXISTS mc_users_email_idx
    ON mc_users (lower(email));

CREATE TABLE IF NOT EXISTS github_identities (
    github_user_id bigint PRIMARY KEY,
    mc_user_id     text NOT NULL REFERENCES mc_users (id),
    github_login   text NOT NULL,
    verified_at    timestamptz NOT NULL DEFAULT now(),
    revoked_at     timestamptz
);

CREATE INDEX IF NOT EXISTS github_identities_mc_user_idx
    ON github_identities (mc_user_id)
    WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS service_principals (
    id          text PRIMARY KEY,
    name        text NOT NULL UNIQUE,
    status      text NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'revoked')),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Durable MCP cursor API principal (shared API key authenticates this row).
INSERT INTO service_principals (id, name, status)
VALUES ('sp_mcp_cursor', 'PLX MC MCP', 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO service_principals (id, name, status)
VALUES ('sp_sync_inbound', 'PLX MC Sync Inbound', 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO service_principals (id, name, status)
VALUES ('sp_routing_maintenance', 'PLX MC Routing Maintenance', 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO service_principals (id, name, status)
VALUES ('sp_github_actions_routing', 'PLX MC GitHub Actions Routing', 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO service_principals (id, name, status)
VALUES ('sp_compliance_projection', 'PLX MC Compliance Projection', 'active')
ON CONFLICT (id) DO NOTHING;
