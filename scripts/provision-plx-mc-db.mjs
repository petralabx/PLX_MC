#!/usr/bin/env node
// Provision the dedicated plx_mc database + app role on the staging RDS
// instance. Mirrors the evidence discipline of provision-sharepoint.py:
// dry-run by default, --apply to mutate, idempotent (safe to re-run).
//
// The app NEVER uses the instance admin or any other database's credentials
// at runtime — it gets its own `plx_mc_app` role scoped to the `plx_mc`
// database. The runtime URL lives in AWS Secrets Manager (prod/ec2-secrets,
// key PLX_MC_DATABASE_URL) per TOOLS.md "Secrets Source of Truth".
//
// Env:
//   PLX_MC_PROVISION_ADMIN_URL  admin connection URL (CREATEDB/CREATEROLE)
//   PLX_MC_DB_PASSWORD          password for plx_mc_app (required on --apply)
//
// Usage: node scripts/provision-plx-mc-db.mjs [--apply]
// Exit codes: 0 — ok (or nothing to do), 1 — failure.

import { Client } from "pg";
import { resolveDbSsl } from "./lib/db-ssl.mjs";

const APP_ROLE = "plx_mc_app";
const APP_DB = "plx_mc";

const apply = process.argv.includes("--apply");

// Identifiers above are script constants; the password is the only literal
// that needs escaping (single-quote doubling — DDL cannot be parameterized).
const quoteLiteral = (s) => `'${String(s).replaceAll("'", "''")}'`;

async function main() {
  const adminUrl = process.env.PLX_MC_PROVISION_ADMIN_URL;
  if (!adminUrl) {
    console.error("PLX_MC_PROVISION_ADMIN_URL is not set — refusing to guess a connection.");
    return 1;
  }
  const password = process.env.PLX_MC_DB_PASSWORD;
  if (apply && !password) {
    console.error("PLX_MC_DB_PASSWORD is required with --apply.");
    return 1;
  }

  // Strip sslmode from the URL — it would override the ssl option below;
  // verification config comes from scripts/lib/db-ssl.mjs (TASK-623).
  const client = new Client({
    connectionString: adminUrl.replace(/([?&])sslmode=[^&]+&?/, "$1").replace(/[?&]$/, ""),
    ssl: resolveDbSsl(),
  });
  await client.connect();
  try {
    const who = await client.query("select current_user, rolcreatedb, rolcreaterole from pg_roles where rolname = current_user");
    const me = who.rows[0];
    console.log(`connected as ${me.current_user} (createdb=${me.rolcreatedb} createrole=${me.rolcreaterole})`);

    const roleExists = (await client.query("select 1 from pg_roles where rolname = $1", [APP_ROLE])).rowCount > 0;
    const dbExists = (await client.query("select 1 from pg_database where datname = $1", [APP_DB])).rowCount > 0;

    console.log(`role ${APP_ROLE}: ${roleExists ? "exists" : "missing"}`);
    console.log(`database ${APP_DB}: ${dbExists ? "exists" : "missing"}`);

    if (!apply) {
      console.log("dry-run — pass --apply to create what is missing.");
      return 0;
    }

    if (!roleExists) {
      await client.query(`CREATE ROLE ${APP_ROLE} LOGIN PASSWORD ${quoteLiteral(password)}`);
      console.log(`created role ${APP_ROLE}`);
    }
    if (!dbExists) {
      // RDS: the master user must be a member of a role to make it a db owner.
      await client.query(`GRANT ${APP_ROLE} TO current_user`);
      await client.query(`CREATE DATABASE ${APP_DB} OWNER ${APP_ROLE}`);
      await client.query(`REVOKE CONNECT ON DATABASE ${APP_DB} FROM PUBLIC`);
      console.log(`created database ${APP_DB} (owner ${APP_ROLE}, PUBLIC connect revoked)`);
    }
    console.log("provisioning complete.");
    return 0;
  } finally {
    await client.end();
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(`provisioning failed: ${err.message}`);
    process.exit(1);
  }
);
