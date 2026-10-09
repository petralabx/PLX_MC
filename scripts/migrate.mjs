#!/usr/bin/env node
// Numbered migration runner for the plx_mc database (governance: "All DDL
// goes through a numbered migration runner"). Applies db/migrations/*.sql in
// numeric order, one transaction per migration, recording each in
// schema_migrations. A failure rolls back and exits 1 — never continue with
// a broken schema. Filename policy (duplicate numeric prefixes, naming) is
// also enforced pre-commit by scripts/check-migrations.py.
//
// Env:  PLX_MC_DATABASE_URL  runtime connection URL (plx_mc_app)
// Usage: node scripts/migrate.mjs
// Action: npm run migrate -- --non-prod --approved-db <database>@<host>
//         --mode deploy|status-only (status-only performs no writes)
// Exit codes: 0 — schema up to date, 1 — failure.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { resolveDbSsl } from "./lib/db-ssl.mjs";
import { assertApprovedNonProdDb, checkUrlAgainstApproved, parseApprovedDb } from "./lib/db-identity.mjs";

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "db", "migrations");
const NAME_RE = /^(\d{3})_[a-z0-9_]+\.sql$/;

export async function main({ argv = process.argv.slice(2), env = process.env, ClientClass = Client, migrationsDir = MIGRATIONS_DIR, log = console.log } = {}) {
  const url = env.PLX_MC_DATABASE_URL;
  if (!url) {
    console.error("PLX_MC_DATABASE_URL is not set.");
    return 1;
  }

  const modeIndex = argv.indexOf("--mode");
  const mode = modeIndex >= 0 ? argv[modeIndex + 1] : "deploy";
  if (!["deploy", "status-only"].includes(mode)) throw new Error("Unknown migration mode.");
  const guarded = argv.includes("--non-prod");
  if (argv.includes("--approved-db") && !guarded) throw new Error("--approved-db requires --non-prod.");
  const approved = guarded ? parseApprovedDb(argv) : null;
  // Validate BEFORE connecting; use exactly the parsed target to prevent overrides.
  const target = guarded ? checkUrlAgainstApproved(url, approved, env) : null;
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
  const seen = new Map();
  for (const f of files) {
    const m = f.match(NAME_RE);
    if (!m) {
      console.error(`migration name violates NNN_snake_case.sql: ${f}`);
      return 1;
    }
    if (seen.has(m[1])) {
      console.error(`duplicate migration prefix ${m[1]}: ${seen.get(m[1])} and ${f}`);
      return 1;
    }
    seen.set(m[1], f);
  }

  // Strip sslmode from the URL — it would override the ssl option below;
  // verification config comes from scripts/lib/db-ssl.mjs (TASK-623).
  const client = new ClientClass({
    ...(target ?? { connectionString: url.replace(/([?&])sslmode=[^&]+&?/, "$1").replace(/[?&]$/, "") }),
    ssl: resolveDbSsl(env),
    connectionTimeoutMillis: 15000,
  });
  await client.connect();
  try {
    if (guarded) await assertApprovedNonProdDb(client, url, approved, env);
    // Status must remain read-only, including on a database with no ledger yet.
    const ledgerExists = mode === "deploy" || Boolean(
      (await client.query("SELECT to_regclass('schema_migrations') AS ledger")).rows[0]?.ledger
    );
    if (mode === "deploy") await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"
    );
    const applied = new Set(
      ledgerExists ? (await client.query("SELECT filename FROM schema_migrations")).rows.map((r) => r.filename) : []
    );
    const alreadyApplied = files.filter((f) => applied.has(f)).length;

    let ran = 0;
    for (const f of files) {
      if (applied.has(f)) {
        log(`skip   ${f} (already applied)`);
        continue;
      }
      if (mode === "status-only") {
        log(`pending ${f}`);
        continue;
      }
      const sql = await readFile(path.join(migrationsDir, f), "utf-8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [f]);
        await client.query("COMMIT");
        applied.add(f);
        log(`apply  ${f}`);
        ran += 1;
      } catch (err) {
        await client.query("ROLLBACK");
        console.error(`FAILED ${f}: ${err.message}`);
        for (const pending of files) if (!applied.has(pending)) log(`pending ${pending}`);
        return 1;
      }
    }
    log(`migrations complete — ${ran} applied, ${alreadyApplied} already in place, ${files.filter((f) => !applied.has(f)).length} pending.`);
    return 0;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(`migrate failed: ${err.message}`);
    process.exit(1);
  }
);
