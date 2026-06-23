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

// Presence check (no secret values exposed) for health surfaces.
export function graphConfigured(): boolean {
  return !!(
    process.env.MICROSOFT_GRAPH_TENANT_ID &&
    process.env.MICROSOFT_GRAPH_CLIENT_ID &&
    process.env.MICROSOFT_GRAPH_CLIENT_SECRET
  );
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

// Azure OpenAI for the in-tenant meeting-transcript extractor (EN-004 / WS-4).
// Transcripts are reasoned over IN-TENANT only (data-boundary decision) — never
// an external LLM. Absent by default; the meeting-intake feature stays off and
// the Tier A live path is dormant until these are configured.
export interface AzureOpenAIConfig {
  endpoint: string;
  apiKey: string;
  deployment: string;
  apiVersion: string;
}

export function azureOpenAiConfigured(): boolean {
  return !!(
    process.env.AZURE_OPENAI_ENDPOINT &&
    process.env.AZURE_OPENAI_API_KEY &&
    process.env.AZURE_OPENAI_DEPLOYMENT
  );
}

export function azureOpenAiConfig(): AzureOpenAIConfig {
  return {
    endpoint: requireSecret("AZURE_OPENAI_ENDPOINT"),
    apiKey: requireSecret("AZURE_OPENAI_API_KEY"),
    deployment: requireSecret("AZURE_OPENAI_DEPLOYMENT"),
    apiVersion: process.env.AZURE_OPENAI_API_VERSION ?? "2024-10-21",
  };
}

// EN-007 compliance webhook (git → MC ingestion). The shared secret signs the
// GitHub webhook delivery (HMAC-SHA256). Absent by default — the webhook route
// returns 503 until it is configured (the gate ships default-off).
export function complianceWebhookConfigured(): boolean {
  return !!process.env.COMPLIANCE_WEBHOOK_SECRET;
}

export function complianceWebhookSecret(): string {
  return requireSecret("COMPLIANCE_WEBHOOK_SECRET");
}

// Vercel Cron auth for the scheduled sweep on the deployed app. The in-app
// setInterval scheduler stays OFF on Vercel (serverless timers are unreliable —
// TOOLS.md); a Vercel Cron job (vercel.json, every 5 min) calls
// GET /api/cron/sweep instead. Vercel injects `Authorization: Bearer
// $CRON_SECRET` on each cron invocation; the route rejects anything that does
// not match. Absent by default → the cron route returns 503 (the scheduled
// sweep ships default-off until CRON_SECRET is configured).
export function cronConfigured(): boolean {
  return !!process.env.CRON_SECRET;
}

export function cronSecret(): string {
  return requireSecret("CRON_SECRET");
}

// CI auth for the compliance verify endpoint (EN-007 review #3). The GitHub
// status-check workflow calls POST /api/compliance/verify with
// `Authorization: Bearer $COMPLIANCE_CI_TOKEN`; the route rejects anything that
// doesn't match. Absent by default → the verify route returns 503, so even
// though it is carved out of the UI auth middleware it is never world-callable
// (closed/unconfigured, not open).
export function complianceCiTokenConfigured(): boolean {
  return !!process.env.COMPLIANCE_CI_TOKEN;
}

export function complianceCiToken(): string {
  return requireSecret("COMPLIANCE_CI_TOKEN");
}
