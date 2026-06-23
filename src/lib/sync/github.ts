// GitHub org validation for self-service repo requests (EN-002 / WS-2). A new
// repo joins the registry/allow-list only after it is confirmed to exist in the
// org — this is the "validate against the GitHub org via API at registration"
// rule. Server-only: auth via resolveGithubToken (src/lib/github-app) — a
// short-lived GitHub App installation token when configured, else the static
// GITHUB_TOKEN. When no auth is configured or the call fails the result is
// `ok: false` with an honest note — the caller marks the request unverified
// rather than fabricating membership.

import { resolveGithubToken } from "@/lib/github-app";
import type { RepoVisibility } from "@/lib/mc-data/types";

export interface RepoValidation {
  ok: boolean;
  visibility?: RepoVisibility;
  def?: string;
  lang?: string;
  note?: string;
}

interface GitHubRepoPayload {
  private?: boolean;
  default_branch?: string;
  language?: string | null;
}

export async function validateRepoInOrg(owner: string, name: string): Promise<RepoValidation> {
  const token = await resolveGithubToken();
  if (!token) {
    return { ok: false, note: "no GitHub auth configured (GitHub App or GITHUB_TOKEN) — repo could not be validated against the org." };
  }
  let res: Response;
  try {
    res = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
      },
    });
  } catch (err) {
    return { ok: false, note: `GitHub validation request failed: ${err instanceof Error ? err.message : "network error"}.` };
  }
  if (res.status === 404) {
    return { ok: false, note: `${owner}/${name} was not found in the org.` };
  }
  if (!res.ok) {
    return { ok: false, note: `GitHub validation failed (HTTP ${res.status}).` };
  }
  const payload = (await res.json()) as GitHubRepoPayload;
  return {
    ok: true,
    visibility: payload.private ? "private" : "public",
    def: payload.default_branch ?? "main",
    lang: payload.language ?? undefined,
  };
}
