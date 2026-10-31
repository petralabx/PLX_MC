// GitHub App authentication: mint short-lived installation access tokens for
// read-only repo Contents + Metadata + Pull requests reads. Preferred over a
// long-lived classic PAT, the token is scoped to only the installed repos
// and expires within the hour, so a leak has a bounded blast radius.
//
// Server-side only. RS256 signing uses node:crypto (no extra dependency). The
// App private key + ids come from the shared secrets accessor; nothing here is
// ever logged. `resolveGithubToken()` is the one accessor every server-side
// GitHub read goes through: App token when configured, else null
// (callers then emit an honest degraded result). No PAT fallback.

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
  /**
   * Cancels the token exchange. Once it fires, the call rejects with
   * `signal.reason` (an AbortError by default): nothing is cached and
   * `resolveGithubToken` rejects instead of degrading.
   */
  signal?: AbortSignal;
}

/** petralabx reads need `GITHUB_APP_INSTALLATION_ID_PLX`; without it they degrade to null. */
function plxOrgMissingInstallation(repoOwner?: string | null): boolean {
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
 * read-only Contents + Metadata + Pull requests (defence in depth even if the
 * App's granted permissions are broader). Pull requests enables PR listing for
 * github-backfill / mc_verify_pr on private repos. Never logs the token.
 * An already-aborted `opts.signal` rejects before any request is made.
 */
export async function requestInstallationToken(
  creds: GithubAppCredentials,
  opts: TokenOpts = {}
): Promise<InstallationToken> {
  opts.signal?.throwIfAborted();
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
      body: JSON.stringify({ permissions: { contents: "read", metadata: "read", pull_requests: "read" } }),
      signal: opts.signal,
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
 * The one shared GitHub auth resolver every server-side GitHub read goes through.
 * App-only (TASK-4361): returns a short-lived GitHub App installation token, or
 * null when the App is not configured for the owner or the mint fails, so callers
 * emit an honest degraded result instead of throwing. There is no static PAT
 * fallback any more: PETRALABX_GITHUB_TOKEN, PETRALABX_GITHUB and GITHUB_TOKEN
 * are ignored (the taylorvalton PAT is being retired). Once `opts.signal`
 * aborts, the call rejects with `signal.reason`, because the caller's deadline
 * has already passed.
 */
export async function resolveGithubToken(opts: TokenOpts = {}): Promise<string | null> {
  if (!githubAppConfigured()) return null;
  if (plxOrgMissingInstallation(opts.repoOwner)) {
    console.warn("[github-app] GITHUB_APP_INSTALLATION_ID_PLX is unset; petralabx GitHub reads are degraded");
    return null;
  }
  try {
    return await getInstallationToken(opts);
  } catch (err) {
    opts.signal?.throwIfAborted();
    // Never mask the failure silently, but stay up: degrade to null.
    console.warn(
      "[github-app] installation token mint failed; GitHub reads degraded: %s",
      err instanceof Error ? err.message : "unknown error"
    );
    return null;
  }
}
