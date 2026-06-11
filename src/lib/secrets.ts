// The one shared secrets accessor (TOOLS.md "Secrets Source of Truth").
// Secrets reach the process env via AWS Secrets Manager (prod/ec2-secrets,
// loaded by ~/load-secrets.ps1 on the dev box); no other module reads
// process.env for credentials. Server-side only — never import from
// client components.

function requireSecret(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`missing secret ${name} — run the secrets loader (see TOOLS.md)`);
  }
  return value;
}

export function databaseUrl(): string {
  return requireSecret("PLX_MC_DATABASE_URL");
}

export interface GraphCredentials {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

export function graphCredentials(): GraphCredentials {
  return {
    tenantId: requireSecret("MICROSOFT_GRAPH_TENANT_ID"),
    clientId: requireSecret("MICROSOFT_GRAPH_CLIENT_ID"),
    clientSecret: requireSecret("MICROSOFT_GRAPH_CLIENT_SECRET"),
  };
}

// User sign-in (OIDC auth-code flow) uses its own app registration —
// `plx-mission-control` in the Petra tenant — distinct from the app-only
// Graph credentials above. Configured on Vercel; absent in local dev, where
// the auth gate stays dormant.
export interface EntraAuthCredentials extends GraphCredentials {
  authSecret: string;
}

export function entraAuthConfigured(): boolean {
  return !!(process.env.PLX_MC_AUTH_CLIENT_ID && process.env.PLX_MC_AUTH_CLIENT_SECRET);
}

export function entraAuthCredentials(): EntraAuthCredentials {
  return {
    tenantId: requireSecret("MICROSOFT_GRAPH_TENANT_ID"),
    clientId: requireSecret("PLX_MC_AUTH_CLIENT_ID"),
    clientSecret: requireSecret("PLX_MC_AUTH_CLIENT_SECRET"),
    authSecret: requireSecret("AUTH_SECRET"),
  };
}
