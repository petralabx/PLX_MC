#!/usr/bin/env node
// Live plx_mc release helper, used ONLY by .github/workflows/db-migrate-live.yml.
//   plan   offline; prints pending files, redacted target and SharePoint columns.
//          Changes nothing and never connects to a database or Graph.
//   verify connects read-only and requires the URL, MC_LIVE_APPROVED_DB and live
//          current_database() to be the documented runtime identity. Run before
//          any write. Refuses every other database.
// The automatic workflow's guard (scripts/lib/db-identity.mjs) still refuses the
// runtime identity; this exception lives here only.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isRuntimeIdentity, parseApprovedSpec, parseConnectionIdentity } from "./lib/db-identity.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE_ORDER = ["staging", "production"]; // dev site first, then production

/** Redacted "host / database" only; never user, password, port or query. */
export function redactedTarget(rawUrl) {
  if (!rawUrl) return "secret unset (MC_LIVE_DATABASE_URL)";
  try {
    const u = new URL(rawUrl);
    const database = decodeURIComponent(u.pathname.replace(/^\//, ""));
    return `host=${u.hostname} database=${database}`;
  } catch {
    return "set, but not a parseable URL (details withheld)";
  }
}

export function buildPlan({ env = process.env, migrationsDir = path.join(ROOT, "db", "migrations"), schemaPath = path.join(ROOT, "config", "sharepoint-schema.json") } = {}) {
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  const schema = JSON.parse(readFileSync(schemaPath, "utf-8"));
  const out = ["## DB Migrate (live release): PLAN", "", "Plan only. Nothing was migrated, provisioned or written.", ""];
  out.push("### Target database (redacted)", "", redactedTarget(env.MC_LIVE_DATABASE_URL), "");
  out.push("### Migration files an apply would run", "",
    "Local db/migrations set (the live ledger is not read in plan); apply skips files already recorded.", "");
  out.push(...files.map((f) => `- ${f}`), "");
  out.push("### SharePoint columns an apply would add", "",
    "Configured columns from config/sharepoint-schema.json; apply creates only the ones missing.", "");
  for (const envName of SITE_ORDER) {
    out.push(`#### ${schema.site.paths[envName]}`, "");
    for (const list of schema.lists) out.push(`- ${list.displayName}: ${list.columns.map((c) => c.name).join(", ")}`);
    out.push("");
  }
  return out.join("\n");
}

export async function verify({ env = process.env, ClientClass }) {
  const url = env.MC_LIVE_DATABASE_URL;
  if (!url || !env.MC_LIVE_APPROVED_DB) throw new Error("MC_LIVE_DATABASE_URL and MC_LIVE_APPROVED_DB are required for apply.");
  const spec = parseApprovedSpec(env.MC_LIVE_APPROVED_DB);
  const target = parseConnectionIdentity(url, env);
  if (!isRuntimeIdentity(spec)) throw new Error("Refusing: approved identity is not the documented live plx_mc.");
  if (target.host !== spec.host || target.database !== spec.database) throw new Error("Refusing: URL does not match the approved live identity.");
  const client = new ClientClass({ host: target.host, port: target.port, database: target.database, user: target.user, password: target.password, connectionTimeoutMillis: 15000 });
  await client.connect();
  try {
    const live = (await client.query("SELECT current_database() AS db")).rows?.[0]?.db;
    if (live !== spec.database) throw new Error("Refusing: connected database is not the approved live database.");
  } finally {
    await client.end();
  }
  return { host: target.host, database: target.database };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cmd = process.argv[2];
  if (cmd === "plan") console.log(buildPlan());
  else if (cmd === "verify") {
    const { Client } = await import("pg");
    const { resolveDbSsl } = await import("./lib/db-ssl.mjs");
    const Wrapped = class extends Client { constructor(o) { super({ ...o, ssl: resolveDbSsl(process.env) }); } };
    verify({ ClientClass: Wrapped }).then(
      (id) => console.log(`live identity verified: host=${id.host} database=${id.database}`),
      (err) => { console.error(`live verify failed: ${err.message}`); process.exit(1); }
    );
  } else { console.error("usage: db-migrate-live.mjs plan|verify"); process.exit(1); }
}
