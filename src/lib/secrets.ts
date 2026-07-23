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

/** First non-empty env value among `names` (canonical first, then aliases). */
function firstSecret(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  return undefined;
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

// GitHub App auth for read-only repo Contents reads (loop-ledgers + repo
// validation). Preferred over a long-lived classic PAT: the App mints
// short-lived (≤1h) installation access tokens scoped to read-only Contents on
// only the installed repos. Absent by default → the github-app module falls back
// to the static GITHUB_TOKEN (and then to honest degraded). The private key is a
// PEM string (runtime-injected from the secrets manager — never logged/committed).
export interface GithubAppCredentials {
  appId: string;
  privateKey: string;
  installationId: string;
}

export function githubAppConfigured(): boolean {
  return !!(
    process.env.GITHUB_APP_ID &&
    process.env.GITHUB_APP_PRIVATE_KEY &&
    (process.env.GITHUB_APP_INSTALLATION_ID || process.env.GITHUB_APP_INSTALLATION_ID_PLX)
  );
}

/** Pick the App installation for a repo owner (EN-008 dual-org). */
export function githubAppInstallationIdForOwner(repoOwner?: string | null): string {
  const owner = (repoOwner ?? "").trim();
  const plxOrg = (process.env.REPO_ORG_PLX ?? "petralabx").toLowerCase();
  if (owner.toLowerCase() === plxOrg) {
    return requireSecret("GITHUB_APP_INSTALLATION_ID_PLX");
  }
  return requireSecret("GITHUB_APP_INSTALLATION_ID");
}

export function githubAppCredentials(repoOwner?: string | null): GithubAppCredentials {
  return {
    appId: requireSecret("GITHUB_APP_ID"),
    privateKey: requireSecret("GITHUB_APP_PRIVATE_KEY").replace(/\\n/g, "\n"),
    installationId: githubAppInstallationIdForOwner(repoOwner),
  };
}

// Skills Directory publish writes are intentionally separate from the read-only
// GitHub App resolver. The write path stays default-off and requires an explicit
// fine-scoped token for plx-cursor-skills PR creation.
export function skillsSubmitGithubWriteEnabled(): boolean {
  const raw = process.env.SKILLS_SUBMIT_GITHUB_WRITE_ENABLED ?? "";
  return raw === "1" || raw.toLowerCase() === "true";
}

export function skillsSubmitGithubToken(): string {
  return requireSecret("SKILLS_SUBMIT_GITHUB_TOKEN");
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

// Graph change-notification webhooks (P11). Default-off: unset kill switch or
// missing clientState / notification URL keeps subscriptions/processing idle
// while the five-minute delta sweep remains the recovery path.
export function graphWebhookEnabled(): boolean {
  const raw = process.env.PLX_MC_GRAPH_WEBHOOK_ENABLED ?? "";
  return raw === "1" || raw.toLowerCase() === "true";
}

export function graphWebhookConfigured(): boolean {
  return !!(
    process.env.PLX_MC_GRAPH_WEBHOOK_CLIENT_STATE &&
    process.env.PLX_MC_GRAPH_NOTIFICATION_URL
  );
}

export function graphWebhookClientState(): string {
  return requireSecret("PLX_MC_GRAPH_WEBHOOK_CLIENT_STATE");
}

export function graphNotificationUrl(): string {
  return requireSecret("PLX_MC_GRAPH_NOTIFICATION_URL");
}

// P11 go-live (TASK-626): allow live Graph subscription create/renew. Still
// runtime-gated on the mirror-is-boring streak in the subscriptions cron.
export function graphSubscriptionsLive(): boolean {
  return (process.env.PLX_MC_GRAPH_SUBSCRIPTIONS_LIVE ?? "0").trim() === "1";
}

// Inline post-ack queue drain from the webhook (TASK-627, <60s edit-to-UI).
// Default ON when the webhook itself is enabled; =0 falls back to cron drain.
export function graphInlineDrainEnabled(): boolean {
  return (process.env.PLX_MC_GRAPH_NOTIFICATION_INLINE_DRAIN ?? "1").trim() === "1";
}

// Project Documents library sync increment (TASK-628). Default OFF.
export function documentsSyncEnabled(): boolean {
  return (process.env.PLX_MC_DOCUMENTS_SYNC_ENABLED ?? "0").trim() === "1";
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

// GitHub Actions OIDC for POST /api/compliance/verify. These are config
// (flags / audience / allowlist), not secrets — they still live here as the
// single env-accessor surface so callers never scatter process.env reads.
// Fail-closed: when OIDC is enabled but audience or allowlist is empty,
// complianceOidcConfigured() is false and the OIDC path must reject.
const DEFAULT_COMPLIANCE_OIDC_AUDIENCE = "plx-mc-compliance-verify";

export function complianceOidcEnabled(): boolean {
  return process.env.COMPLIANCE_OIDC_ENABLED === "1";
}

export function complianceOidcAudience(): string {
  const raw = process.env.COMPLIANCE_OIDC_AUDIENCE;
  if (raw === undefined || raw === "") return DEFAULT_COMPLIANCE_OIDC_AUDIENCE;
  return raw;
}

export function complianceOidcRepoAllowlist(): string[] {
  const raw = process.env.COMPLIANCE_OIDC_REPO_ALLOWLIST ?? "";
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function complianceOidcConfigured(): boolean {
  return (
    complianceOidcEnabled() &&
    complianceOidcAudience().length > 0 &&
    complianceOidcRepoAllowlist().length > 0
  );
}

// Vendor spend (AI Spend) adapter credentials. Each automated adapter is
// default-off: when its key is absent the adapter returns a visible degraded
// result and the vendor stays manual-entry — never fabricated spend.
//
// AWS Cost Explorer uses the standard AWS credential chain (env keys on the
// box, or an instance role) rather than a bespoke env var, so its presence
// check looks for either an explicit access key or the ambient-credential
// opt-in flag set where an IAM role is known to exist.
export function awsCostExplorerConfigured(): boolean {
  return !!(
    (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) ||
    process.env.AWS_COST_EXPLORER_USE_AMBIENT === "1"
  );
}

export interface AwsCostExplorerCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  region: string;
}

/** Explicit env credentials, or null to let the SDK use its ambient chain. */
export function awsCostExplorerCredentials(): AwsCostExplorerCredentials | null {
  if (!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY)) {
    return null;
  }
  return {
    accessKeyId: requireSecret("AWS_ACCESS_KEY_ID"),
    secretAccessKey: requireSecret("AWS_SECRET_ACCESS_KEY"),
    sessionToken: process.env.AWS_SESSION_TOKEN || undefined,
    region: process.env.AWS_REGION ?? "us-east-1",
  };
}

// Anthropic org cost report needs an ADMIN key (sk-ant-admin01-…); the
// standard ANTHROPIC_API_KEY cannot read /v1/organizations/cost_report.
// Canonical env: ANTHROPIC_ADMIN_API_KEY. Alias accepted: ANTHROPIC_ADMIN_KEY
// (name used in prod/ec2-secrets / staging/ec2-secrets).
export function anthropicAdminConfigured(): boolean {
  return !!firstSecret("ANTHROPIC_ADMIN_API_KEY", "ANTHROPIC_ADMIN_KEY");
}

export function anthropicAdminApiKey(): string {
  const value = firstSecret("ANTHROPIC_ADMIN_API_KEY", "ANTHROPIC_ADMIN_KEY");
  if (!value) {
    throw new Error(
      "missing secret ANTHROPIC_ADMIN_API_KEY (or alias ANTHROPIC_ADMIN_KEY) — run the secrets loader (see TOOLS.md)"
    );
  }
  return value;
}

// Cursor team spend needs an Enterprise Admin API key (/teams/spend).
// Canonical env: CURSOR_ADMIN_API_KEY. Alias accepted: CURSOR_ADMIN_KEY.
export function cursorAdminConfigured(): boolean {
  return !!firstSecret("CURSOR_ADMIN_API_KEY", "CURSOR_ADMIN_KEY");
}

export function cursorAdminApiKey(): string {
  const value = firstSecret("CURSOR_ADMIN_API_KEY", "CURSOR_ADMIN_KEY");
  if (!value) {
    throw new Error(
      "missing secret CURSOR_ADMIN_API_KEY (or alias CURSOR_ADMIN_KEY) — run the secrets loader (see TOOLS.md)"
    );
  }
  return value;
}
