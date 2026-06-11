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
