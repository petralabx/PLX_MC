#!/usr/bin/env node
// No migration writes; this check must succeed before Next/Vercel promotion.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { resolveDbSsl } from "./lib/db-ssl.mjs";
import { parseConnectionIdentity } from "./lib/db-identity.mjs";
import { expectedMigrations } from "./lib/migration-manifest.mjs";
import { readSchemaVersion } from "./lib/schema-version.mjs";

export async function main({ env = process.env, ClientClass = Client, migrationsDir, log = console.log } = {}) {
  if (!env.PLX_MC_SCHEMA_CHECK_DATABASE_URL) {
    log("deploy blocked: PLX_MC_SCHEMA_CHECK_DATABASE_URL is required (dedicated read-only target credential)");
    return 1;
  }
  let client;
  try {
    const target = parseConnectionIdentity(env.PLX_MC_SCHEMA_CHECK_DATABASE_URL, env);
    const runtime = parseConnectionIdentity(env.PLX_MC_DATABASE_URL, env);
    if (target.host !== runtime.host || target.database !== runtime.database || target.port !== runtime.port) {
      log("deploy blocked: read-only credential must target the runtime database host, port and name");
      return 1;
    }
    const files = await expectedMigrations(migrationsDir);
    client = new ClientClass({ ...target, ssl: resolveDbSsl(env), connectionTimeoutMillis: 10000, query_timeout: 10000 });
    await client.connect();
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '5s'");
    const schema = await readSchemaVersion(sql => client.query(sql), files);
    log(schema.ok ? schema.message : `deploy blocked: ${schema.message}`);
    return schema.ok ? 0 : 1;
  } catch {
    // Driver errors can contain connection credentials; never emit raw errors.
    log("deploy blocked: schema ledger unavailable or configuration invalid (details withheld)");
    return 1;
  } finally {
    if (client) {
      try { await client.query("ROLLBACK"); } finally { await client.end(); }
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Ordinary local builds need no database. Vercel builds cannot opt out.
  if (process.argv.includes("--build") && process.env.VERCEL !== "1") {
    console.log("schema deploy check: local build (target check runs on every Vercel build)");
  } else {
    main().then(code => { process.exitCode = code; }, () => {
      console.error("deploy blocked: schema check failed (details withheld)");
      process.exitCode = 1;
    });
  }
}
