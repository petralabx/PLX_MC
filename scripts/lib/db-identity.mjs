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

// Env vars libpq/pg would use to fill or redirect a connection target.
const TARGET_ENV_VARS = ["PGHOST", "PGHOSTADDR", "PGPORT", "PGDATABASE", "PGUSER", "PGSERVICE", "PGSERVICEFILE"];
// The only query param accepted: it never changes the target (the script's own
// resolveDbSsl() decides TLS). Every other param (host, hostaddr, port, dbname,
// database, service, options, ...) can redirect or rewrite the connection.
const ALLOWED_QUERY_PARAMS = new Set(["sslmode"]);

/**
 * The effective connection target from a postgres URL: { host, port, database,
 * user, password }. Fails closed on anything that could make the driver connect
 * elsewhere than the URL authority: query-param overrides, multiple hosts,
 * unix-socket hosts, a missing host/database/user, and PG* target env vars.
 * Callers must build the client from this object (never from the raw URL), so
 * what is validated is exactly what connects.
 */
export function parseConnectionIdentity(connectionUrl, env = process.env) {
  let url;
  try {
    url = new URL(connectionUrl);
  } catch {
    throw new DbIdentityError("Cannot establish DB identity: connection URL is not parseable.");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new DbIdentityError("Cannot establish DB identity: connection URL is not a postgres URL.");
  }
  for (const key of new Set(url.searchParams.keys())) {
    if (!ALLOWED_QUERY_PARAMS.has(key)) {
      throw new DbIdentityError(`Refusing: connection URL parameter "${key}" can override the connection target.`);
    }
  }
  const set = TARGET_ENV_VARS.filter((name) => env?.[name]);
  if (set.length > 0) {
    throw new DbIdentityError(`Refusing: ${set.join(", ")} can override the connection target; unset it.`);
  }
  const host = normalizeHost(url.hostname);
  if (host.includes(",") || host.includes("%") || host.includes("/") || host.startsWith("[")) {
    throw new DbIdentityError("Refusing: multiple, socket or non-DNS connection hosts are not allowed.");
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  const user = decodeURIComponent(url.username);
  if (!host || !database || !user || database.includes("/")) {
    throw new DbIdentityError("Cannot establish DB identity: connection URL has no host, database or user.");
  }
  const port = url.port ? Number(url.port) : 5432;
  return { host, port, database, user, password: decodeURIComponent(url.password) };
}

/**
 * Pure URL-level check; run it before connecting. Returns the effective
 * connection target (see parseConnectionIdentity) to build the client from.
 * Refuses the runtime identity (in the URL or the approved spec) and any mismatch.
 */
export function checkUrlAgainstApproved(connectionUrl, approved, env = process.env) {
  const spec = approved ?? {};
  if (!spec.database || !spec.host) {
    throw new DbIdentityError("--approved-db <database>@<host> is required.");
  }
  const fromUrl = parseConnectionIdentity(connectionUrl, env);
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
export async function assertApprovedNonProdDb(client, connectionUrl, approved, env = process.env) {
  const fromUrl = checkUrlAgainstApproved(connectionUrl, approved, env);
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
