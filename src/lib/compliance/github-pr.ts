// Build a VerifyPrInput for one PR straight from GitHub (mc_verify_pr). Reads
// the same inputs the compliance-gate workflow sends to /api/compliance/verify:
// head SHA, labels, every MC-Checkout stamp in the body (parsed by the webhook
// parser, so stamp rules stay in one place), and the changed paths. Auth goes
// through resolveGithubToken (src/lib/github-app); the PR body is used in
// memory for stamps only and never returned.

import { ApiError } from "@/lib/api/route";
import { resolveGithubToken } from "@/lib/github-app";
import type { VerifyPrInput } from "./service";
import { parsePullRequestEvent } from "./webhook";

const GH_API = "https://api.github.com";
const GH_TIMEOUT_MS = 15_000;
const FILES_PER_PAGE = 100;
// GitHub's PR files listing stops at 3000 entries (30 pages of 100).
const MAX_FILE_PAGES = 30;

export interface LoadedPrVerifyInput {
  input: VerifyPrInput;
  /** True when GitHub's 3000-file listing cap was hit — the tier may be understated. */
  truncated: boolean;
}

async function githubGet(url: string, token: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(GH_TIMEOUT_MS),
    });
  } catch (err) {
    throw new ApiError(
      "github_unreachable",
      `GitHub request failed: ${err instanceof Error ? err.message : "network error"}.`,
      502
    );
  }
  if (res.status === 404) {
    throw new ApiError(
      "not_found",
      "PR not found, or not readable with Mission Control's GitHub credentials.",
      404
    );
  }
  if (!res.ok) {
    throw new ApiError("github_error", `GitHub returned HTTP ${res.status}.`, 502);
  }
  return res.json();
}

export async function loadPrVerifyInput(
  repoFullName: string,
  prNumber: number
): Promise<LoadedPrVerifyInput> {
  const [owner, name] = repoFullName.split("/");
  const token = await resolveGithubToken({ repoOwner: owner });
  if (!token) {
    throw new ApiError(
      "github_unavailable",
      "No GitHub auth configured (GitHub App or PAT) — the PR cannot be read.",
      503
    );
  }
  const prUrl = `${GH_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls/${prNumber}`;
  const pr = (await githubGet(prUrl, token)) as { base?: { repo?: unknown } };
  const evt = parsePullRequestEvent({ action: "verify", pull_request: pr, repository: pr.base?.repo });
  if (!evt) {
    throw new ApiError("github_error", "GitHub returned an unrecognized pull request payload.", 502);
  }

  const changedPaths: string[] = [];
  let truncated = false;
  for (let page = 1; page <= MAX_FILE_PAGES; page++) {
    const files = (await githubGet(
      `${prUrl}/files?per_page=${FILES_PER_PAGE}&page=${page}`,
      token
    )) as { filename?: unknown }[];
    const list = Array.isArray(files) ? files : [];
    for (const file of list) {
      if (typeof file.filename === "string" && file.filename) changedPaths.push(file.filename);
    }
    if (list.length < FILES_PER_PAGE) break;
    if (page === MAX_FILE_PAGES) truncated = true;
  }

  return {
    input: {
      repo: evt.repo,
      repoFullName: evt.repoFullName,
      prNumber,
      headSha: evt.headSha,
      changedPaths,
      labels: evt.labels,
      checkoutIds: evt.checkoutIds,
      checkoutId: evt.checkoutId,
    },
    truncated,
  };
}
