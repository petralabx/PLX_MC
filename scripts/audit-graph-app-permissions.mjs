#!/usr/bin/env node
// Audit the app-only Graph app registration against the least-privilege
// contract in config/graph-app-permissions.json (TASK-621). Acquires a
// client-credentials token, decodes the JWT `roles` claim, and fails on
// drift: any forbidden role, any role outside required+transitional, or a
// transitional role past its retire-by date.
//
// Site grants (TASK-4422): every SharePoint site the code writes to must have
// a declared `siteGrants` entry with `write`. The sites are read from the
// source (CODE_SITE_SOURCES), not copied here, so a new or moved site cannot
// slip past the manifest. This half is static: an app on Sites.Selected cannot
// read /sites/{id}/permissions (that needs Sites.FullControl.All, forbidden
// here), so live per-site grants are not compared — a person verifies them
// (docs/runbooks/graph-least-privilege.md). It runs even without credentials.
//
// Exit codes: 0 = compliant, 1 = drift/violations (role or site grant),
// 2 = credentials not configured and the static site-grant check passed.
// Usage: node scripts/audit-graph-app-permissions.mjs [--manifest <path>]

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

export function loadManifest(path = join(repoRoot, "config", "graph-app-permissions.json")) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * Where the code names each SharePoint site it writes to. `pattern` captures
 * the site path; a source that no longer matches fails the audit loudly.
 */
export const CODE_SITE_SOURCES = [
  {
    use: "sync engine (default site)",
    file: "src/lib/sync/graph.ts",
    pattern: /PLX_MC_SHAREPOINT_SITE_PATH\s*\?\?\s*"([^"]+)"/,
  },
  {
    use: "evidence store (Mission Control library)",
    file: "src/lib/compliance/evidence-artifacts.ts",
    pattern: /PLX_EVIDENCE_STORE\s*=\s*\{\s*site:\s*"([^"]+)"/,
  },
];

/**
 * Read the written-to sites out of the source tree.
 * Returns { sites: {site, use, file}[], errors: string[] }.
 */
export function discoverCodeSites(root = repoRoot, sources = CODE_SITE_SOURCES) {
  const sites = [];
  const errors = [];
  for (const { use, file, pattern } of sources) {
    let text;
    try {
      text = readFileSync(join(root, file), "utf8");
    } catch (err) {
      errors.push(`cannot read ${file} (${use}): ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    const match = pattern.exec(text);
    if (!match) {
      errors.push(`cannot find the ${use} site in ${file}; update CODE_SITE_SOURCES`);
      continue;
    }
    sites.push({ site: match[1], use, file });
  }
  return { sites, errors };
}

const normSite = (site) => String(site).trim().replace(/\/+$/, "").toLowerCase();

/**
 * Pure evaluation: sites the code writes to vs the manifest's siteGrants.
 * A written-to site without a `write` grant is a violation; a declared grant
 * no code uses is a warning (stale). Returns { violations, warnings }.
 */
export function evaluateSiteGrants(codeSites, manifest) {
  const grants = new Map((manifest.siteGrants ?? []).map((g) => [normSite(g.site), g]));
  const used = new Set();
  const violations = [];
  const warnings = [];

  for (const { site, use, file } of codeSites) {
    const key = normSite(site);
    used.add(key);
    const grant = grants.get(key);
    if (!grant) {
      violations.push(`site written by ${use} (${file}) has no siteGrants entry: ${site}`);
    } else if (grant.permission !== "write") {
      violations.push(`site written by ${use} needs permission "write", manifest declares "${grant.permission ?? "unset"}": ${site}`);
    }
  }
  for (const [key, grant] of grants) {
    if (!used.has(key)) warnings.push(`siteGrants entry not written by any known code path: ${grant.site}`);
  }
  return { violations, warnings };
}

/**
 * Pure evaluation: granted roles vs the manifest.
 * Returns { violations: string[], warnings: string[] }.
 */
export function evaluateGraphAppRoles(grantedRoles, manifest, now = new Date()) {
  const granted = new Set(grantedRoles);
  const required = new Set(manifest.requiredRoles ?? []);
  const forbidden = new Set(manifest.forbiddenRoles ?? []);
  const transitional = new Map(
    (manifest.transitionalRoles ?? []).map((t) => [t.role, t.retireBy ?? null])
  );

  const violations = [];
  const warnings = [];

  for (const role of granted) {
    if (forbidden.has(role)) {
      violations.push(`forbidden role granted: ${role}`);
      continue;
    }
    if (required.has(role)) continue;
    if (transitional.has(role)) {
      const retireBy = transitional.get(role);
      if (retireBy && new Date(`${retireBy}T23:59:59Z`) < now) {
        violations.push(`transitional role past retire-by (${retireBy}): ${role}`);
      } else {
        warnings.push(`transitional role still granted (retire by ${retireBy ?? "unset"}): ${role}`);
      }
      continue;
    }
    violations.push(`role outside the least-privilege contract: ${role}`);
  }

  for (const role of required) {
    if (!granted.has(role)) {
      // Missing Sites.Selected is a warning while a transitional broad role
      // still covers the sync engine; a violation once none does.
      const coveredByTransitional = [...transitional.keys()].some((t) => granted.has(t));
      if (coveredByTransitional) {
        warnings.push(`required role not yet granted: ${role}`);
      } else {
        violations.push(`required role missing and no transitional coverage: ${role}`);
      }
    }
  }

  return { violations, warnings };
}

function decodeJwtRoles(token) {
  const payload = token.split(".")[1];
  if (!payload) return [];
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  return Array.isArray(claims.roles) ? claims.roles : [];
}

async function fetchAppToken({ tenantId, clientId, clientSecret }) {
  const res = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }),
    }
  );
  if (!res.ok) {
    throw new Error(`token request failed: ${res.status} ${await res.text()}`);
  }
  const body = await res.json();
  return body.access_token;
}

function manifestArg(argv) {
  const i = argv.indexOf("--manifest");
  return i >= 0 && argv[i + 1] ? argv[i + 1] : undefined;
}

async function main() {
  const manifest = loadManifest(manifestArg(process.argv.slice(2)));

  const discovered = discoverCodeSites();
  const siteResult = evaluateSiteGrants(discovered.sites, manifest);
  const violations = [...discovered.errors, ...siteResult.violations];
  const warnings = [...siteResult.warnings];
  console.log(
    `[graph-audit] sites written by code: ${discovered.sites.map((s) => s.site).join(", ") || "(none)"}`
  );

  const tenantId = process.env.MICROSOFT_GRAPH_TENANT_ID;
  const clientId = process.env.MICROSOFT_GRAPH_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_GRAPH_CLIENT_SECRET;
  const configured = Boolean(tenantId && clientId && clientSecret);
  if (configured) {
    const token = await fetchAppToken({ tenantId, clientId, clientSecret });
    const roles = decodeJwtRoles(token);
    console.log(`[graph-audit] granted application roles: ${roles.join(", ") || "(none)"}`);
    const roleResult = evaluateGraphAppRoles(roles, manifest);
    violations.push(...roleResult.violations);
    warnings.push(...roleResult.warnings);
  }

  for (const w of warnings) console.log(`[graph-audit] WARN ${w}`);
  for (const v of violations) console.error(`[graph-audit] FAIL ${v}`);

  if (!configured) {
    if (violations.length > 0) {
      console.error("[graph-audit] siteGrants in the manifest do not cover the sites the code writes to");
      process.exit(1);
    }
    console.error("[graph-audit] MICROSOFT_GRAPH_* credentials not configured — site grants checked, roles not audited.");
    process.exit(2);
  }

  if (violations.length > 0) {
    console.error("[graph-audit] app registration drifts from config/graph-app-permissions.json");
    process.exit(1);
  }
  console.log("[graph-audit] app registration is within the least-privilege contract.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`[graph-audit] ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
