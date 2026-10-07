// Verified non-production DB identity guard for ops scripts that write data
// (TASK-2528). A `--env` label or "the URL does not contain prod" proves
// nothing: the documented runtime database (TOOLS.md: Postgres `plx_mc` on
// staging RDS `plx-postgres-staging`) carries no "prod" in its name. Instead
// the operator names the intended UAT/staging database with
// `--approved-db <database>@<host>` and this guard requires BOTH the
// connection URL (host + database) AND the live `current_database()` to match
// it exactly, and always refuses the runtime identity, even if "approved".
//
// Usage (before any read or write, dry-run included):
//   const spec = parseApprovedDb(argv)               // throws DbIdentityError
//   await client.connect()
//   await assertApprovedNonProdDb(client, url, spec) // throws DbIdentityError
//
// `client` is anything with query(sql) -> {rows}; a pg Client in production.

// TOOLS.md Postgres row / AGENTS.md "Database Safety": the runtime database
// `plx_mc` lives on staging RDS instance `plx-postgres-staging`.
export const RUNTIME_DB_NAME = "plx_mc";
export const RUNTIME_DB_HOST_PREFIX = "plx-postgres-staging";

export class DbIdentityError extends Error {}

function normalizeHost(host) {
  return String(host).trim().toLowerCase();
}

/** True for the documented runtime/production identity (db `plx_mc` on `plx-postgres-staging*`). */
export function isRuntimeIdentity({ database, host }) {
  return (
    String(database).toLowerCase() === RUNTIME_DB_NAME &&
    normalizeHost(host).startsWith(RUNTIME_DB_HOST_PREFIX)
  );
}

/** Parse "<database>@<host>"; throws DbIdentityError when missing or malformed. */
export function parseApprovedSpec(raw) {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new DbIdentityError("--approved-db <database>@<host> is required.");
  }
  const m = /^([A-Za-z0-9_][A-Za-z0-9_-]*)@([A-Za-z0-9][A-Za-z0-9.-]*)$/.exec(raw.trim());
  if (!m) {
    throw new DbIdentityError(`--approved-db must look like <database>@<host>, got "${raw}".`);
  }
  return { database: m[1], host: normalizeHost(m[2]) };
}

/** Read `--approved-db <value>` from argv (undefined value -> malformed). */
export function parseApprovedDb(argv) {
  const idx = argv.indexOf("--approved-db");
  return parseApprovedSpec(idx >= 0 ? argv[idx + 1] : undefined);
}

/** Host + database from a postgres connection URL; throws when not derivable. */
export function parseConnectionIdentity(connectionUrl) {
  let url;
  try {
    url = new URL(connectionUrl);
  } catch {
    throw new DbIdentityError("Cannot establish DB identity: connection URL is not parseable.");
  }
  const host = normalizeHost(url.hostname);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!host || !database) {
    throw new DbIdentityError("Cannot establish DB identity: connection URL has no host or database.");
  }
  return { host, database };
}

/**
 * Pure URL-level check; run it before connecting. Returns the URL identity.
 * Refuses the runtime identity (in the URL or the approved spec) and any mismatch.
 */
export function checkUrlAgainstApproved(connectionUrl, approved) {
  const spec = approved ?? {};
  if (!spec.database || !spec.host) {
    throw new DbIdentityError("--approved-db <database>@<host> is required.");
  }
  const fromUrl = parseConnectionIdentity(connectionUrl);
  if (isRuntimeIdentity(spec) || isRuntimeIdentity(fromUrl)) {
    throw new DbIdentityError(
      `Refusing: ${RUNTIME_DB_NAME} on ${RUNTIME_DB_HOST_PREFIX}* is the runtime database and is never an approved target.`
    );
  }
  if (fromUrl.host !== normalizeHost(spec.host) || fromUrl.database !== spec.database) {
    throw new DbIdentityError(
      `Refusing: connection URL points at ${fromUrl.database}@${fromUrl.host}, not the approved ${spec.database}@${spec.host}.`
    );
  }
  return fromUrl;
}

/**
 * Full guard: URL check, then the live `current_database()` must equal the
 * approved database. Returns { database, host, serverAddr } on success;
 * throws DbIdentityError otherwise. Reads nothing but identity.
 */
export async function assertApprovedNonProdDb(client, connectionUrl, approved) {
  const fromUrl = checkUrlAgainstApproved(connectionUrl, approved);
  let row;
  try {
    row = (await client.query("SELECT current_database() AS db, inet_server_addr()::text AS addr")).rows?.[0];
  } catch (err) {
    throw new DbIdentityError(`Cannot establish DB identity: ${err.message}`);
  }
  const live = row?.db;
  if (typeof live !== "string" || !live) {
    throw new DbIdentityError("Cannot establish DB identity: current_database() returned nothing.");
  }
  if (isRuntimeIdentity({ database: live, host: fromUrl.host })) {
    throw new DbIdentityError(`Refusing: live database is the runtime database ${RUNTIME_DB_NAME}.`);
  }
  if (live !== approved.database) {
    throw new DbIdentityError(
      `Refusing: connected database is "${live}", not the approved "${approved.database}".`
    );
  }
  return { database: live, host: fromUrl.host, serverAddr: row.addr ?? null };
}
