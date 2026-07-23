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
// Exit codes: 0 — schema up to date, 1 — failure.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { resolveDbSsl } from "./lib/db-ssl.mjs";

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "db", "migrations");
const NAME_RE = /^(\d{3})_[a-z0-9_]+\.sql$/;

async function main() {
  const url = process.env.PLX_MC_DATABASE_URL;
  if (!url) {
    console.error("PLX_MC_DATABASE_URL is not set.");
    return 1;
  }

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
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
  const client = new Client({
    connectionString: url.replace(/([?&])sslmode=[^&]+&?/, "$1").replace(/[?&]$/, ""),
    ssl: resolveDbSsl(),
  });
  await client.connect();
  try {
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"
    );
    const applied = new Set(
      (await client.query("SELECT filename FROM schema_migrations")).rows.map((r) => r.filename)
    );

    let ran = 0;
    for (const f of files) {
      if (applied.has(f)) {
        console.log(`skip   ${f} (already applied)`);
        continue;
      }
      const sql = await readFile(path.join(MIGRATIONS_DIR, f), "utf-8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [f]);
        await client.query("COMMIT");
        console.log(`apply  ${f}`);
        ran += 1;
      } catch (err) {
        await client.query("ROLLBACK");
        console.error(`FAILED ${f}: ${err.message}`);
        return 1;
      }
    }
    console.log(`migrations complete — ${ran} applied, ${files.length - ran} already in place.`);
    return 0;
  } finally {
    await client.end();
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(`migrate failed: ${err.message}`);
    process.exit(1);
  }
);
