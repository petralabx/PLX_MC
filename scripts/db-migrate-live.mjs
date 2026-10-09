#!/usr/bin/env node
// Manual live-release reads only. Writes remain in the workflow's existing tools.
import { appendFileSync, readdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseApprovedSpec, parseConnectionIdentity } from "./lib/db-identity.mjs";
import { resolveDbSsl } from "./lib/db-ssl.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE_ORDER = ["staging", "production"];
const GRAPH_KEYS = ["MICROSOFT_GRAPH_TENANT_ID", "MICROSOFT_GRAPH_CLIENT_ID", "MICROSOFT_GRAPH_CLIENT_SECRET"];
class ReleaseError extends Error {}
class GraphReadError extends ReleaseError {}
/** @typedef {{ verdict: string, expected?: string, actual?: string, reason?: string, suggested?: string }} Identity */

/** Host/database only, including when a malformed URL contains sensitive text. */
export function redactedTarget(rawUrl) {
  if (!rawUrl) return "secret unset (MC_LIVE_DATABASE_URL)";
  try {
    const u = new URL(rawUrl);
    // Reject malformed identities rather than rendering arbitrary pathname text.
    const database = decodeURIComponent(u.pathname.slice(1));
    if (!/^[A-Za-z0-9_-]+$/.test(database)) return "invalid target (details withheld)";
    return `host=${u.hostname} database=${database}`;
  } catch {
    return "invalid target (details withheld)";
  }
}

export function computePending({ localFiles, ledgerFiles, schema, liveColumnsBySite }) {
  const local = new Set(localFiles);
  const ledger = new Set(ledgerFiles ?? []); // null means the ledger table is absent
  const sharepoint = {};
  for (const stage of SITE_ORDER) {
    const site = schema.site.paths[stage];
    const missing = {};
    for (const list of schema.lists) {
      const have = new Set(liveColumnsBySite[site]?.[list.displayName] ?? []);
      const columns = list.columns.filter(c => !have.has(c.name) && !have.has(c.displayName)).map(c => c.name);
      if (columns.length || !Object.hasOwn(liveColumnsBySite[site] ?? {}, list.displayName)) missing[list.displayName] = columns;
    }
    if (Object.keys(missing).length) sharepoint[site] = missing;
  }
  return {
    migrations: [...local].filter(f => !ledger.has(f)).sort(),
    ledgerOrphans: [...ledger].filter(f => !local.has(f)).sort(),
    sharepoint,
  };
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}

/** Pending sets are order-independent; display retains configured schema order. */
export function pendingHash(pending, { db = "readable", sharepoint = "readable", missingLists = {} } = {}) {
  const normalized = {
    migrations: db === "readable" ? [...pending.migrations].sort() : "unavailable",
    ledgerOrphans: db === "readable" ? [...pending.ledgerOrphans].sort() : "unavailable",
    sharepoint: sharepoint === "readable" ? Object.fromEntries(Object.entries(pending.sharepoint).map(([site, lists]) => [site,
      Object.fromEntries(Object.entries(lists).map(([list, columns]) => [list, [...columns].sort()]))])) : "unavailable",
    missingLists: Object.fromEntries(Object.entries(missingLists).map(([site, lists]) => [site, [...lists].sort()])),
  };
  return `sha256:${createHash("sha256").update(JSON.stringify(canonical(normalized))).digest("hex")}`;
}

export function commitSha({ env = process.env, gitHead = () => execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim() } = {}) {
  const head = gitHead();
  if (!/^[a-f0-9]{40}$/.test(head)) throw new ReleaseError("commit SHA: git HEAD is not 40 lowercase hex");
  if (env.GITHUB_SHA && env.GITHUB_SHA !== head) throw new ReleaseError(`commit SHA mismatch: GITHUB_SHA=${env.GITHUB_SHA} HEAD=${head}`);
  return head;
}

export function parseExpectedIdentity(raw) {
  if (typeof raw !== "string" || raw !== raw.trim()) throw new Error("invalid identity");
  const match = /^([^#]+)(?:#sysid=([0-9]{1,20}))?$/.exec(raw);
  if (!match) throw new Error("invalid identity");
  const spec = parseApprovedSpec(match[1]);
  if (`${spec.database}@${spec.host}` !== match[1]) throw new Error("invalid identity");
  return { ...spec, sysid: match[2] };
}

function identityLines(identity) {
  return [`======== IDENTITY: ${identity.verdict} ========`,
    `expected: ${identity.expected ?? "unavailable"}   actual: ${identity.actual ?? "unavailable"}`,
    ...(identity.reason ? [identity.reason] : []), ...(identity.suggested ? [identity.suggested] : [])];
}

export async function readLiveDb({ env = process.env, ClientClass, localFiles = [], readMigration = filename => readFileSync(path.join(ROOT, "db", "migrations", filename), "utf8") }) {
  /** @type {Identity} */
  const identity = { verdict: "NOT CHECKED" };
  if (!env.MC_LIVE_DATABASE_URL) return { identity };
  let target;
  try {
    target = parseConnectionIdentity(env.MC_LIVE_DATABASE_URL, env);
    parseApprovedSpec(`${target.database}@${target.host}`);
  }
  catch { throw new ReleaseError("DB identity check failed: invalid URL or target overrides refused (details withheld)"); }
  let expected;
  if (!env.MC_LIVE_EXPECTED_IDENTITY) identity.verdict = "UNSET";
  else {
    try { expected = parseExpectedIdentity(env.MC_LIVE_EXPECTED_IDENTITY); identity.expected = env.MC_LIVE_EXPECTED_IDENTITY; }
    catch { identity.verdict = "INVALID FORMAT"; identity.reason = `MC_LIVE_EXPECTED_IDENTITY invalid (length=${env.MC_LIVE_EXPECTED_IDENTITY.length})`; }
  }
  identity.actual = `${target.database}@${target.host} sysid=unavailable`;
  if (expected && (target.host !== expected.host || target.database !== expected.database)) {
    identity.verdict = "MISMATCH";
    identity.reason = "URL host/database differs from expected identity";
    return { identity };
  }
  const client = new ClientClass({ ...target, ssl: resolveDbSsl(env), connectionTimeoutMillis: 15000 });
  try { await client.connect(); }
  catch (err) { await client.end(); throw err; }
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '5s'");
    const live = (await client.query("SELECT current_database() AS db")).rows?.[0]?.db;
    let sysid = "unavailable";
    await client.query("SAVEPOINT sysid");
    try {
      const value = (await client.query("SELECT system_identifier::text AS sysid FROM pg_control_system()")).rows?.[0]?.sysid;
      if (typeof value === "string" && /^[0-9]{1,20}$/.test(value)) sysid = value;
    } catch { await client.query("ROLLBACK TO SAVEPOINT sysid"); }
    identity.actual = `${live ?? "unavailable"}@${target.host} sysid=${sysid}`;
    if (!expected) {
      // Only emit a copyable suggestion when the observed database is parseable.
      try {
        const suggestion = `${live}@${target.host}${sysid === "unavailable" ? "" : `#sysid=${sysid}`}`;
        parseExpectedIdentity(suggestion);
        identity.suggested = `suggested MC_LIVE_EXPECTED_IDENTITY=${suggestion} (a human must confirm this is the Vercel plx-mission-control Production database before setting it)`;
      } catch { /* No valid identity to suggest. */ }
      return { identity };
    }
    if (live !== expected.database || (expected.sysid && expected.sysid !== sysid)) {
      identity.verdict = "MISMATCH";
      identity.reason = live !== expected.database ? "current_database() differs from expected database" : sysid === "unavailable" ? "sysid expected but unavailable" : "sysid differs from expected fingerprint";
      return { identity };
    }
    identity.verdict = "MATCH";
    const exists = (await client.query("SELECT to_regclass('schema_migrations') AS ledger")).rows?.[0]?.ledger;
    const ledgerFiles = exists ? (await client.query("SELECT filename FROM schema_migrations")).rows.map(r => r.filename) : null;
    const sanity = await schemaSanity({ client, localFiles, ledgerFiles, readMigration });
    return { identity, ledgerFiles, sanity };
  } finally {
    try { await client.query("ROLLBACK"); } finally { await client.end(); }
  }
}

// This deliberately extracts key DDL objects only; it is an advisory existence
// check, not a SQL interpreter or proof that a migration fully took effect.
export function parseSchemaObjects(sql) {
  const clean = sql.replace(/"(?:[^"]|"")*"|'(?:[^']|'')*'|--[^\n]*|\/\*[\s\S]*?\*\//g,
    token => token.startsWith('"') ? token : " ");
  const identifier = String.raw`(?:"(?:[^"]|"")+"|[a-zA-Z_][a-zA-Z0-9_$]*)`;
  const name = `${identifier}(?:\\s*\\.\\s*${identifier})?`;
  const parts = raw => raw.match(new RegExp(identifier, "g")).map(v => v.startsWith('"') ? v.slice(1, -1).replace(/""/g, '"') : v.toLowerCase());
  const objects = [];
  const add = (kind, raw, column) => {
    const names = parts(raw);
    const object = { kind, names, regname: names.map(n => '"' + n.replace(/"/g, '""') + '"').join("."), label: names.join(".") };
    if (column) { object.column = parts(column)[0]; object.label += `.${object.column}`; }
    if (!objects.some(o => o.kind === kind && o.regname === object.regname && o.column === object.column)) objects.push(object);
  };
  for (const [kind, prefix] of [
    ["table", "CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?"],
    ["index", "CREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+(?:CONCURRENTLY\\s+)?(?:IF\\s+NOT\\s+EXISTS\\s+)?"],
    ["view", "CREATE\\s+(?:OR\\s+REPLACE\\s+)?VIEW\\s+"],
    ["function", "CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+"],
  ]) for (const m of clean.matchAll(new RegExp(`\\b${prefix}(${name})`, "gi"))) add(kind, m[1]);
  for (const m of clean.matchAll(new RegExp(`\\bALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:ONLY\\s+)?(${name})([\\s\\S]*?)(?:;|$)`, "gi"))) {
    for (const c of m[2].matchAll(new RegExp(`\\bADD\\s+COLUMN\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(${identifier})`, "gi"))) add("column", m[1], c[1]);
  }
  return objects.slice(0, 50);
}

export async function schemaSanity({ client, localFiles, ledgerFiles, readMigration }) {
  const newest = (ledgerFiles ?? []).filter(f => localFiles.includes(f)).sort().at(-1);
  if (!newest) return ["### Schema sanity", "no local ledgered migration to check"];
  const out = [`### Schema sanity (newest ledgered: ${newest})`];
  for (const orphan of (ledgerFiles ?? []).filter(f => f > newest && !localFiles.includes(f)).sort()) out.push(`note: newer ledger entry ${orphan} has no local file`);
  const objects = parseSchemaObjects(readMigration(newest));
  if (!objects.length) out.push(`no checkable objects found in ${newest}`);
  let missing = 0;
  for (const obj of objects) {
    if (obj.kind === "function") { out.push(`- skipped function ${obj.label} (overloaded function signatures require manual inspection)`); continue; }
    let present;
    if (obj.kind === "column") {
      const qualified = obj.names.length === 2;
      const result = await client.query(`SELECT 1 FROM information_schema.columns WHERE ${qualified ? "table_schema = $3" : "table_schema = ANY (current_schemas(false))"} AND table_name = $1 AND column_name = $2`, [obj.names.at(-1), obj.column, ...(qualified ? [obj.names[0]] : [])]);
      present = result.rows.length > 0;
    } else present = Boolean((await client.query("SELECT to_regclass($1) AS object", [obj.regname])).rows?.[0]?.object);
    out.push(`- ${present ? "OK" : "MISSING"} ${obj.kind} ${obj.label}`);
    if (!present) missing++;
  }
  if (missing) out.push(`WARNING: ledger says ${newest} is applied but ${missing} key object(s) are missing; ledger and schema disagree`);
  return out;
}

export async function verify(options) {
  const result = await readLiveDb(options);
  return result.identity;
}

export async function readLiveSharepoint({ env = process.env, schema, fetchImpl = fetch }) {
  const missing = GRAPH_KEYS.filter(k => !env[k]);
  if (missing.length) throw new ReleaseError(`SharePoint: NOT READ - ${missing.join(", ")} not set in this workflow; missing columns unknown; apply will refuse`);
  async function request(url, options) {
    const u = new URL(url);
    const method = options.method;
    if ((method === "GET" && (u.origin !== "https://graph.microsoft.com" || !u.pathname.startsWith("/v1.0/") || u.username || u.password)) ||
      (method === "POST" && u.origin !== "https://login.microsoftonline.com")) throw new GraphReadError("Graph request rejected: unexpected host/path");
    try {
      const response = await fetchImpl(u.href, { ...options, redirect: "error", signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new GraphReadError(`${method} ${u.pathname} status=${response.status}`);
      return await response.json();
    } catch (err) {
      if (err instanceof GraphReadError) throw err;
      throw new GraphReadError(`${method} ${u.pathname} status=unavailable (request or JSON error)`);
    }
  }
  const token = await request(`https://login.microsoftonline.com/${encodeURIComponent(env.MICROSOFT_GRAPH_TENANT_ID)}/oauth2/v2.0/token`, {
    method: "POST", body: new URLSearchParams({ client_id: env.MICROSOFT_GRAPH_CLIENT_ID, client_secret: env.MICROSOFT_GRAPH_CLIENT_SECRET, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" }),
  });
  if (typeof token.access_token !== "string" || !token.access_token) throw new GraphReadError("POST /oauth2/v2.0/token status=200 (token missing)");
  const headers = { Authorization: `Bearer ${token.access_token}` };
  const get = url => request(url, { method: "GET", headers });
  async function collection(url) {
    const values = [];
    const seen = new Set();
    while (url) {
      if (seen.has(url)) throw new GraphReadError("Graph pagination cycle");
      seen.add(url);
      const data = await get(url);
      if (!Array.isArray(data.value)) throw new GraphReadError("Graph collection malformed");
      values.push(...data.value);
      url = data["@odata.nextLink"];
    }
    return values;
  }
  const liveColumnsBySite = {};
  for (const stage of SITE_ORDER) {
    const sitePath = schema.site.paths[stage];
    const site = await get(`https://graph.microsoft.com/v1.0/sites/${schema.site.hostname}:${sitePath}`);
    if (typeof site.id !== "string" || !site.id) throw new GraphReadError("Graph site response malformed");
    const base = `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(site.id)}`;
    const lists = await collection(`${base}/lists?$select=id,displayName,list`);
    const columnsByList = {};
    for (const list of schema.lists) {
      const actual = lists.find(l => l.displayName === list.displayName);
      if (!actual) continue;
      if (typeof actual.id !== "string" || !actual.id) throw new GraphReadError("Graph list response malformed");
      const columns = await collection(`${base}/lists/${encodeURIComponent(actual.id)}/columns?$select=name,displayName`);
      if (columns.some(c => typeof c?.name !== "string" || typeof c?.displayName !== "string")) throw new GraphReadError("Graph column response malformed");
      columnsByList[list.displayName] = [...new Set(columns.flatMap(c => [c.name, c.displayName]))];
    }
    liveColumnsBySite[sitePath] = columnsByList;
  }
  return liveColumnsBySite;
}

export async function buildPlan({ env = process.env, ClientClass, fetchImpl, gitHead, readMigration, localFiles = readdirSync(path.join(ROOT, "db", "migrations")).filter(f => f.endsWith(".sql")), schema = JSON.parse(readFileSync(path.join(ROOT, "config", "sharepoint-schema.json"), "utf8")) } = {}) {
  const sha = commitSha({ env, gitHead });
  const problems = [];
  let failedRead = false;
  let db;
  /** @type {Identity} */
  let identity = { verdict: "NOT CHECKED" };
  let sanity;
  let liveColumnsBySite;
  for (const source of ["DB", "SharePoint"]) {
    const keys = source === "DB" ? ["MC_LIVE_DATABASE_URL"] : GRAPH_KEYS;
    const missing = keys.filter(k => !env[k]);
    if (missing.length) {
      problems.push(`${source}: NOT READ - ${missing.join(", ")} not set in this workflow; ${source === "DB" ? "pending migrations" : "missing columns"} unknown; apply will refuse`);
      continue;
    }
    try {
      if (source === "DB") {
        if (!ClientClass) ({ Client: ClientClass } = await import("pg"));
        const result = await readLiveDb({ env, ClientClass, localFiles, readMigration });
        identity = result.identity;
        sanity = result.sanity;
        if (identity.verdict === "MATCH") db = result;
        else problems.push(`DB: NOT READ - identity ${identity.verdict}; pending migrations unknown; apply will refuse`);
      } else liveColumnsBySite = await readLiveSharepoint({ env, schema, fetchImpl });
    } catch (err) {
      if (!(err instanceof ReleaseError) || err instanceof GraphReadError) failedRead = true;
      problems.push(`${source}: NOT READ - ${err instanceof ReleaseError ? err.message : "read error (details withheld)"}; error_class=${source === "SharePoint" ? "GraphReadError" : err instanceof ReleaseError ? "IdentityError" : "DatabaseReadError"}; apply will refuse`);
    }
  }
  const pending = computePending({ localFiles: db ? localFiles : [], ledgerFiles: db?.ledgerFiles, schema, liveColumnsBySite: liveColumnsBySite ?? {} });
  if (!liveColumnsBySite) pending.sharepoint = {};
  const missingLists = {};
  if (liveColumnsBySite) for (const stage of SITE_ORDER) {
    const site = schema.site.paths[stage];
    const lists = schema.lists.filter(l => !Object.hasOwn(liveColumnsBySite[site], l.displayName)).map(l => l.displayName);
    if (lists.length) missingLists[site] = lists;
  }
  const hash = pendingHash(pending, { db: db ? "readable" : "unavailable", sharepoint: liveColumnsBySite ? "readable" : "unavailable", missingLists });
  const ready = Boolean(db && liveColumnsBySite);
  const out = [`plan_commit_sha=${sha}`, `pending_hash=${hash}`, `apply_ready=${ready ? "yes" : "no"}${ready ? "" : ` (identity ${identity.verdict}; sources unreadable; see problems below)`}`, ...identityLines(identity), `target: ${redactedTarget(env.MC_LIVE_DATABASE_URL)}`, ...problems];
  if (Object.hasOwn(env, "MC_LIVE_APPROVED_DB")) out.push("note: MC_LIVE_APPROVED_DB is no longer read by the live release (replaced by MC_LIVE_EXPECTED_IDENTITY); an admin may delete it");
  out.push(...(sanity ?? ["### Schema sanity", identity.verdict === "NOT CHECKED" ? "unknown (DB not read)" : "skipped (identity not MATCH)"]));
  if (db?.ledgerFiles === null) out.push("DB: schema_migrations table missing; every local migration is pending");
  out.push(`### Pending migrations (${db ? pending.migrations.length : "unknown"})`, ...(db ? (pending.migrations.length ? pending.migrations.map(f => `- ${f}`) : ["none"]) : ["unknown (DB not read)"]), "### SharePoint columns missing");
  for (const stage of SITE_ORDER) {
    const site = schema.site.paths[stage];
    out.push(`#### ${site}`);
    const lists = Object.entries(pending.sharepoint[site] ?? {});
    out.push(...(!liveColumnsBySite ? ["unknown (SharePoint not read)"] : lists.length ? lists.map(([list, cols]) => `- ${list}${missingLists[site]?.includes(list) ? " (list missing)" : ""}: ${cols.join(", ") || "no configured columns"}`) : ["none"]));
  }
  out.push("### Ledger anomalies", ...(db ? pending.ledgerOrphans.length ? pending.ledgerOrphans.map(f => `- schema_migrations has ${f} but db/migrations has no such file`) : ["none"] : ["unknown (DB not read)"]));
  return { sha, hash, ready, identity, pending, missingLists, output: out.join("\n"), exitCode: failedRead ? 1 : 0 };
}

export async function preflightApply(options = {}) {
  const env = options.env ?? process.env;
  if (!/^[a-f0-9]{40}$/.test(env.PLAN_SHA ?? "")) throw new ReleaseError("plan_sha malformed: require 40 lowercase hex");
  if (!/^sha256:[a-f0-9]{64}$/.test(env.PENDING_HASH ?? "")) throw new ReleaseError("pending_hash malformed: require sha256: plus 64 lowercase hex");
  const sha = commitSha({ ...options, env });
  if (sha !== env.PLAN_SHA) throw new ReleaseError(`plan_sha mismatch: expected=${env.PLAN_SHA} actual=${sha}`);
  const plan = await buildPlan({ ...options, env });
  if (plan.identity.verdict !== "MATCH") throw new ReleaseError(`preflight-apply refused: identity ${plan.identity.verdict}\n${plan.output}`);
  if (!plan.ready || plan.exitCode) throw new ReleaseError(`preflight-apply refused: both sources must be readable\n${plan.output}`);
  if (plan.hash !== env.PENDING_HASH) throw new ReleaseError(`pending_hash mismatch: expected=${env.PENDING_HASH} actual=${plan.hash}`);
  return plan;
}

export async function runCommand({ command = "plan", env = process.env, log = console.log, ...options } = {}) {
  try {
    if (!["plan", "preflight-apply", "post-apply", "verify"].includes(command)) throw new ReleaseError("usage: db-migrate-live.mjs plan|preflight-apply|post-apply|verify");
    if (command === "verify") {
      let ClientClass = options.ClientClass;
      if (!ClientClass) ({ Client: ClientClass } = await import("pg"));
      try {
        const id = await verify({ env, ClientClass });
        log(identityLines(id).join("\n"));
        return id.verdict === "MATCH" ? 0 : 1;
      } catch (err) {
        log(err instanceof ReleaseError ? err.message : "live verify failed: DatabaseReadError (details withheld)");
        return 1;
      }
    }
    const plan = command === "preflight-apply" ? await preflightApply({ ...options, env }) : await buildPlan({ ...options, env });
    log(plan.output);
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${plan.output}\n`);
    if (command === "post-apply" && (!plan.ready || plan.exitCode || plan.pending.migrations.length || Object.keys(plan.pending.sharepoint).length)) {
      log("post-apply refused: sources must be readable and remaining pending items must be empty");
      return 1;
    }
    return plan.exitCode;
  } catch (err) {
    log(err instanceof ReleaseError ? err.message : "live release failed: read or output error (details withheld)");
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await runCommand({ command: process.argv[2] ?? "plan" });
