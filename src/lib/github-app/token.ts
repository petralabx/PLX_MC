// GitHub App authentication: mint short-lived installation access tokens for
// read-only repo Contents reads. Preferred over a long-lived classic PAT — the
// installation token is scoped (read-only Contents on only the installed repos)
// and expires within the hour, so a leak has a bounded blast radius.
//
// Server-side only. RS256 signing uses node:crypto (no extra dependency). The
// App private key + ids come from the shared secrets accessor; nothing here is
// ever logged. `resolveGithubToken()` is the one accessor every server-side
// GitHub read goes through: App token when configured, else the static
// GITHUB_TOKEN, else null (callers then emit an honest degraded result).

import { createSign } from "node:crypto";

import {
  githubAppConfigured,
  githubAppCredentials,
  type GithubAppCredentials,
} from "@/lib/secrets";

const GH_API = "https://api.github.com";

// GitHub App JWTs must expire within 10 minutes; use 9 and backdate `iat` 60s to
// tolerate clock skew between this host and GitHub (per GitHub's guidance).
const JWT_SKEW_S = 60;
const JWT_TTL_S = 9 * 60;

// Refresh an installation token this far before its real expiry, so an in-flight
// request never races the boundary.
const REFRESH_SKEW_MS = 60_000;

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

/**
 * Mint a short-lived GitHub App JWT (RS256), signed with the App private key.
 * `nowMs` is injectable for deterministic tests.
 */
export function mintAppJwt(
  creds: Pick<GithubAppCredentials, "appId" | "privateKey">,
  nowMs: number = Date.now()
): string {
  const iat = Math.floor(nowMs / 1000) - JWT_SKEW_S;
  const exp = iat + JWT_SKEW_S + JWT_TTL_S;
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({ iat, exp, iss: creds.appId }));
  const signingInput = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = base64url(signer.sign(creds.privateKey));
  return `${signingInput}.${signature}`;
}

export interface InstallationToken {
  token: string;
  /** Epoch milliseconds at which the token expires. */
  expiresAt: number;
}

type FetchLike = typeof fetch;

interface TokenOpts {
  fetchImpl?: FetchLike;
  nowMs?: number;
  /** GitHub repo owner slug — selects the org App installation when configured. */
  repoOwner?: string | null;
}

/** Until `GITHUB_APP_INSTALLATION_ID_PLX` exists, petralabx reads use `GITHUB_TOKEN`. */
function plxOrgNeedsPatFallback(repoOwner?: string | null): boolean {
  const owner = (repoOwner ?? "").trim().toLowerCase();
  const plxOrg = (process.env.REPO_ORG_PLX ?? "petralabx").toLowerCase();
  if (owner !== plxOrg) return false;
  return !process.env.GITHUB_APP_INSTALLATION_ID_PLX?.trim();
}

// Per-installation cache (EN-008: legacy user account + PLX org).
const cachedByInstallation = new Map<string, InstallationToken>();

/** Reset cached installation tokens. Tests only. */
export function __resetInstallationTokenCache(): void {
  cachedByInstallation.clear();
}

/**
 * Exchange the App JWT for an installation access token, explicitly narrowed to
 * read-only Contents + Metadata (defence in depth even if the App's granted
 * permissions are broader). Never logs the token.
 */
export async function requestInstallationToken(
  creds: GithubAppCredentials,
  opts: TokenOpts = {}
): Promise<InstallationToken> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const jwt = mintAppJwt(creds, opts.nowMs ?? Date.now());
  const res = await fetchImpl(
    `${GH_API}/app/installations/${encodeURIComponent(creds.installationId)}/access_tokens`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${jwt}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "content-type": "application/json",
      },
      body: JSON.stringify({ permissions: { contents: "read", metadata: "read" } }),
    }
  );
  if (!res.ok) {
    let detail = "";
    try {
      detail = ((await res.json()) as { message?: string }).message ?? "";
    } catch {
      // body not JSON — keep the status-only message
    }
    throw new Error(
      `GitHub App installation token request failed (HTTP ${res.status})${detail ? `: ${detail}` : ""}`
    );
  }
  const body = (await res.json()) as { token: string; expires_at: string };
  return { token: body.token, expiresAt: Date.parse(body.expires_at) };
}

/**
 * Return a valid installation token, minting (and caching) a fresh one when the
 * cache is empty or within REFRESH_SKEW_MS of expiry. Throws if the App is not
 * configured or the mint fails — callers use `resolveGithubToken` instead.
 */
export async function getInstallationToken(opts: TokenOpts = {}): Promise<string> {
  const creds = githubAppCredentials(opts.repoOwner);
  const now = opts.nowMs ?? Date.now();
  const cached = cachedByInstallation.get(creds.installationId);
  if (cached && cached.expiresAt - REFRESH_SKEW_MS > now) {
    return cached.token;
  }
  const fresh = await requestInstallationToken(creds, opts);
  cachedByInstallation.set(creds.installationId, fresh);
  return fresh.token;
}

/**
 * Static PAT fallback after App mint is skipped/fails.
 * petralabx owners prefer the org fine-grained PAT (covers every org repo,
 * including plx-customer-portal). Other owners keep legacy GITHUB_TOKEN so a
 * petralabx-only token cannot mask taylorvalton access.
 */
function resolveStaticPat(repoOwner?: string | null): string | null {
  const owner = (repoOwner ?? "").trim().toLowerCase();
  const plxOrg = (process.env.REPO_ORG_PLX ?? "petralabx").toLowerCase();
  const petra =
    process.env.PETRALABX_GITHUB_TOKEN?.trim() ||
    process.env.PETRALABX_GITHUB?.trim() ||
    "";
  const legacy = process.env.GITHUB_TOKEN?.trim() || "";
  if (owner === plxOrg) return petra || legacy || null;
  if (owner) return legacy || null;
  // No owner hint: prefer petralabx PAT (PLX control-plane default), else legacy.
  return petra || legacy || null;
}

/**
 * The one shared GitHub auth resolver every server-side GitHub read goes through.
 * Prefers a short-lived App installation token; falls back to the static
 * PETRALABX_GITHUB_TOKEN (petralabx) / GITHUB_TOKEN (legacy) so the surface
 * keeps working before the App is provisioned or if a token mint transiently
 * fails; returns null when neither is configured, so callers emit an honest
 * degraded result instead of throwing.
 */
export async function resolveGithubToken(opts: TokenOpts = {}): Promise<string | null> {
  if (githubAppConfigured() && !plxOrgNeedsPatFallback(opts.repoOwner)) {
    try {
      return await getInstallationToken(opts);
    } catch (err) {
      // Never mask the failure silently, but stay up: fall back to the PAT/null.
      console.warn(
        "[github-app] installation token mint failed; falling back to static PAT: %s",
        err instanceof Error ? err.message : "unknown error"
      );
    }
  }
  return resolveStaticPat(opts.repoOwner);
}
