#!/usr/bin/env node
// Audit the app-only Graph app registration against the least-privilege
// contract in config/graph-app-permissions.json (TASK-621). Acquires a
// client-credentials token, decodes the JWT `roles` claim, and fails on
// drift: any forbidden role, any role outside required+transitional, or a
// transitional role past its retire-by date.
//
// Exit codes: 0 = compliant, 1 = drift/violations, 2 = not configured.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

export function loadManifest(path = join(repoRoot, "config", "graph-app-permissions.json")) {
  return JSON.parse(readFileSync(path, "utf8"));
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

async function main() {
  const tenantId = process.env.MICROSOFT_GRAPH_TENANT_ID;
  const clientId = process.env.MICROSOFT_GRAPH_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_GRAPH_CLIENT_SECRET;
  if (!tenantId || !clientId || !clientSecret) {
    console.error("[graph-audit] MICROSOFT_GRAPH_* credentials not configured — nothing to audit.");
    process.exit(2);
  }

  const manifest = loadManifest();
  const token = await fetchAppToken({ tenantId, clientId, clientSecret });
  const roles = decodeJwtRoles(token);
  console.log(`[graph-audit] granted application roles: ${roles.join(", ") || "(none)"}`);

  const { violations, warnings } = evaluateGraphAppRoles(roles, manifest);
  for (const w of warnings) console.log(`[graph-audit] WARN ${w}`);
  for (const v of violations) console.error(`[graph-audit] FAIL ${v}`);

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
