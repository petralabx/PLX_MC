// Postgres access for the sync engine — one pool per server process.
// Schema is owned by db/migrations/ (numbered runner); this module only
// queries. All SQL goes through parameterized placeholders.

import { Pool } from "pg";
import { databaseUrl } from "@/lib/secrets";
import { readSchemaVersion, SchemaMismatchError } from "../../../scripts/lib/schema-version.mjs";
import migrationManifest from "./migration-manifest.json";
import { resolveDbSsl } from "./tls";

// Survive Next.js dev-mode module reloads without leaking pools.
const globalForDb = globalThis as unknown as { __plxMcPool?: Pool };

function pool(): Pool {
  if (!globalForDb.__plxMcPool) {
    globalForDb.__plxMcPool = new Pool({
      // Strip sslmode — it would override the ssl option; verification config
      // comes from resolveDbSsl (vendored RDS CA bundle, TASK-623).
      connectionString: databaseUrl()
        .replace(/([?&])sslmode=[^&]+&?/, "$1")
        .replace(/[?&]$/, ""),
      ssl: resolveDbSsl(),
      max: 5,
      // Idle sockets to RDS get dropped silently after long quiet periods;
      // without these a checkout of a dead connection hangs a request
      // forever (observed 2026-06-11: /api/state hung after ~80 idle min).
      keepAlive: true,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      query_timeout: 20_000,
    });
  }
  return globalForDb.__plxMcPool;
}

export async function query<R extends object = Record<string, unknown>>(
  text: string,
  params: unknown[] = []
): Promise<R[]> {
  await assertSchemaReady();
  const result = await pool().query(text, params);
  return result.rows as R[];
}

// Parameterized query bound to a single transaction's client.
export type TxQuery = <R extends object = Record<string, unknown>>(
  text: string,
  params?: unknown[]
) => Promise<R[]>;

// Run a set of statements on ONE pooled connection inside a transaction:
// BEGIN, run `fn`, COMMIT — or ROLLBACK on any throw (the connection is always
// released). The plain `query()` above checks out a fresh connection per call,
// so it CANNOT span a multi-statement transaction; use this when several writes
// must be atomic (e.g. the bucket-comment replace-thread).
export async function withTransaction<T>(fn: (q: TxQuery) => Promise<T>): Promise<T> {
  await assertSchemaReady();
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const q: TxQuery = async (text, params = []) => (await client.query(text, params)).rows as never;
    const result = await fn(q);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Cache only successful checks, briefly; failures recheck so applying the
// missing migration recovers without a redeploy. Never recurse through query().
let schemaReadyUntil = 0;
let schemaCheck: Promise<void> | undefined;
export async function assertSchemaReady(): Promise<void> {
  if (Date.now() < schemaReadyUntil) return;
  if (!schemaCheck) schemaCheck = (async () => {
    const schema = await readSchemaVersion(sql => pool().query(sql), migrationManifest);
    if (!schema.ok) {
      console.error("[db] SCHEMA MISMATCH:", schema.message);
      throw new SchemaMismatchError(schema);
    }
    schemaReadyUntil = Date.now() + 30_000;
  })().finally(() => { schemaCheck = undefined; });
  await schemaCheck;
}
