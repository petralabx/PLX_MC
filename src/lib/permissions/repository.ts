// Narrow read-only repository for migration-016 identities. The default query
// seam is loaded lazily so importing permissions/auth with enforcement off
// never loads database configuration or opens a connection.

import type {
  AccessRole,
  ActorStatus,
  GithubIdentityRecord,
  IdentityQuery,
  McUserRecord,
  ServicePrincipalRecord,
} from "./types";

export type { IdentityQuery } from "./types";

async function defaultIdentityQuery(
  text: string,
  params: unknown[] = []
): Promise<Record<string, unknown>[]> {
  const { query } = await import("@/lib/db");
  return query(text, params);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function timestampValue(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date && !Number.isNaN(value.valueOf())) {
    return value.toISOString();
  }
  return stringValue(value);
}

function accessRole(value: unknown): AccessRole | null {
  return value === "owner" || value === "admin" || value === "member" ? value : null;
}

function actorStatus(value: unknown): ActorStatus | null {
  return value === "active" || value === "revoked" ? value : null;
}

export async function findMcUserByEntraOid(
  entraOid: string,
  runQuery: IdentityQuery = defaultIdentityQuery
): Promise<McUserRecord | null> {
  const rows = await runQuery(
    `SELECT id, entra_oid, email, display_name, access_role, status
       FROM mc_users
      WHERE entra_oid = $1
      LIMIT 1`,
    [entraOid]
  );
  const row = rows[0];
  if (!row) return null;

  const id = stringValue(row.id);
  const persistedOid = stringValue(row.entra_oid);
  const email = stringValue(row.email);
  const role = accessRole(row.access_role);
  const status = actorStatus(row.status);
  if (!id || !persistedOid || !email || !role || !status) return null;

  return {
    id,
    entraOid: persistedOid,
    email,
    displayName: stringValue(row.display_name) ?? undefined,
    accessRole: role,
    status,
  };
}

export async function findGithubIdentityByUserId(
  githubUserId: number,
  runQuery: IdentityQuery = defaultIdentityQuery
): Promise<GithubIdentityRecord | null> {
  const rows = await runQuery(
    `SELECT github_user_id, mc_user_id, github_login, verified_at, revoked_at
       FROM github_identities
      WHERE github_user_id = $1
      LIMIT 1`,
    [githubUserId]
  );
  const row = rows[0];
  if (!row) return null;

  const persistedId = Number(row.github_user_id);
  const mcUserId = stringValue(row.mc_user_id);
  const githubLogin = stringValue(row.github_login);
  const verifiedAt = timestampValue(row.verified_at);
  if (!Number.isSafeInteger(persistedId) || !mcUserId || !githubLogin || !verifiedAt) {
    return null;
  }

  return {
    githubUserId: persistedId,
    mcUserId,
    githubLogin,
    verifiedAt,
    revokedAt: timestampValue(row.revoked_at),
  };
}

export async function findServicePrincipalById(
  id: string,
  runQuery: IdentityQuery = defaultIdentityQuery
): Promise<ServicePrincipalRecord | null> {
  const rows = await runQuery(
    `SELECT id, name, status
       FROM service_principals
      WHERE id = $1
      LIMIT 1`,
    [id]
  );
  const row = rows[0];
  if (!row) return null;

  const persistedId = stringValue(row.id);
  const name = stringValue(row.name);
  const status = actorStatus(row.status);
  if (!persistedId || !name || !status) return null;

  return { id: persistedId, name, status };
}
