// Build a VerifyPrInput for one PR straight from GitHub (mc_verify_pr). Reads
// the same inputs the compliance-gate workflow sends to /api/compliance/verify:
// head SHA, labels, every MC-Checkout stamp in the body (parsed by the webhook
// parser, so stamp rules stay in one place), and the changed paths. Auth goes
// through resolveGithubToken (src/lib/github-app); the PR body is used in
// memory for stamps and the Review links section only, and never returned.

import { ApiError } from "@/lib/api/route";
import { resolveGithubToken } from "@/lib/github-app";
import { parseReviewLinks, type ReviewLinksSection } from "./review-links";
import type { VerifyPrInput } from "./service";
import { parsePullRequestEvent } from "./webhook";

const GH_API = "https://api.github.com";
const GH_TIMEOUT_MS = 15_000;
// The gate's verify call has a 20 s budget; an unread body only adds a note.
const REVIEW_LINKS_TIMEOUT_MS = 5_000;
const FILES_PER_PAGE = 100;
// GitHub's PR files listing stops at 3000 entries (30 pages of 100).
const MAX_FILE_PAGES = 30;

export interface PrState {
  open: boolean;
  checkoutIds: string[];
}

/** Live attachment proof for expired checkouts; never reads the files listing. */
export async function loadPrState(repoFullName: string, prNumber: number): Promise<PrState> {
  const [owner, name] = repoFullName.split("/");
  if (!owner || !name) throw new ApiError("github_unavailable", "A full repository slug is required to read PR state.", 503);
  const token = await resolveGithubToken({ repoOwner: owner });
  if (!token) throw new ApiError("github_unavailable", "No GitHub auth configured - the PR cannot be read.", 503);
  const pr = (await githubGet(
    `${GH_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls/${prNumber}`,
    token
  )) as { state?: string; number?: number; base?: { repo?: unknown } };
  const evt = parsePullRequestEvent({ action: "verify", pull_request: pr, repository: pr?.base?.repo });
  if (!evt || pr.number !== prNumber || !["open", "closed"].includes(pr.state ?? "")) {
    throw new ApiError("github_error", "GitHub returned an unrecognized pull request payload.", 502);
  }
  return { open: pr.state === "open", checkoutIds: evt.checkoutIds };
}

/**
 * The PR body's Review links section (TASK-3168), parsed in memory. Never returns the body.
 * One deadline covers the whole lookup: the App token exchange, then the PR read.
 */
export async function loadPrReviewLinks(repoFullName: string, prNumber: number): Promise<ReviewLinksSection> {
  const [owner, name] = repoFullName.split("/");
  if (!owner || !name) throw new ApiError("github_unavailable", "A full repository slug is required to read the PR body.", 503);
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), REVIEW_LINKS_TIMEOUT_MS);
  try {
    const token = await beforeDeadline(resolveGithubToken({ repoOwner: owner, signal: deadline.signal }), deadline.signal);
    if (!token) throw new ApiError("github_unavailable", "No GitHub auth configured - the PR cannot be read.", 503);
    const pr = (await githubGet(
      `${GH_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls/${prNumber}`,
      token,
      deadline.signal
    )) as { number?: number; body?: unknown };
    if (pr?.number !== prNumber) {
      throw new ApiError("github_error", "GitHub returned an unrecognized pull request payload.", 502);
    }
    return parseReviewLinks(typeof pr.body === "string" ? pr.body : "");
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Settle with `work`, or reject with github_unreachable once `signal` aborts. The
 * token exchange is cancelled by the same signal; this is the backstop for a token
 * lookup that ignores it, and gives the abort the same error code as the PR read.
 */
function beforeDeadline<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new ApiError("github_unreachable", "GitHub auth did not resolve in time.", 502));
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

export interface LoadedPrVerifyInput {
  input: VerifyPrInput;
  /** True when GitHub's 3000-file listing cap was hit — the tier may be understated. */
  truncated: boolean;
}

async function githubGet(url: string, token: string, signal?: AbortSignal): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
      },
      cache: "no-store",
      signal: signal ?? AbortSignal.timeout(GH_TIMEOUT_MS),
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

// GitHub's PR commits listing stops at 250 entries (3 pages of 100).
const MAX_COMMIT_PAGES = 3;

export interface PrCommit {
  sha: string;
  message: string;
  authorName: string;
  authorEmail: string;
  authorLogin: string;
  committerName: string;
  committerEmail: string;
  committerLogin: string;
}

/** The PR's head commits (TASK-3336 agent signals). Messages are used in memory only. */
export async function loadPrCommits(repoFullName: string, prNumber: number): Promise<PrCommit[]> {
  const [owner, name] = repoFullName.split("/");
  if (!owner || !name) throw new ApiError("github_unavailable", "A full repository slug is required to read PR commits.", 503);
  const token = await resolveGithubToken({ repoOwner: owner });
  if (!token) throw new ApiError("github_unavailable", "No GitHub auth configured - the PR commits cannot be read.", 503);
  const url = `${GH_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls/${prNumber}/commits`;
  type GhCommit = {
    sha?: string;
    commit?: { message?: string; author?: { name?: string; email?: string }; committer?: { name?: string; email?: string } };
    author?: { login?: string } | null;
    committer?: { login?: string } | null;
  };
  const commits: PrCommit[] = [];
  for (let page = 1; page <= MAX_COMMIT_PAGES; page++) {
    const list = (await githubGet(`${url}?per_page=${FILES_PER_PAGE}&page=${page}`, token)) as GhCommit[];
    if (!Array.isArray(list)) throw new ApiError("github_error", "GitHub returned an unrecognized commits payload.", 502);
    for (const c of list) {
      commits.push({
        sha: c.sha ?? "",
        message: c.commit?.message ?? "",
        authorName: c.commit?.author?.name ?? "",
        authorEmail: c.commit?.author?.email ?? "",
        authorLogin: c.author?.login ?? "",
        committerName: c.commit?.committer?.name ?? "",
        committerEmail: c.commit?.committer?.email ?? "",
        committerLogin: c.committer?.login ?? "",
      });
    }
    if (list.length < FILES_PER_PAGE) break;
  }
  return commits;
}

export interface MergedPrFacts {
  merged: boolean;
  state: "open" | "closed";
  headSha: string;
  mergeSha: string;
  title: string;
  /** Base repository full name (owner/name) as GitHub reports it. */
  repoFullName: string;
}

/** Merge facts for one PR, read from GitHub only (mc_link_merged_pr). Never returns the body. */
export async function loadMergedPrFacts(repoFullName: string, prNumber: number): Promise<MergedPrFacts> {
  const [owner, name] = repoFullName.split("/");
  if (!owner || !name) throw new ApiError("github_unavailable", "A full repository slug is required to read PR state.", 503);
  const token = await resolveGithubToken({ repoOwner: owner });
  if (!token) throw new ApiError("github_unavailable", "No GitHub auth configured - the PR cannot be read.", 503);
  const pr = (await githubGet(
    `${GH_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls/${prNumber}`,
    token
  )) as {
    state?: string;
    number?: number;
    merged?: boolean;
    title?: string;
    head?: { sha?: string };
    merge_commit_sha?: string | null;
    base?: { repo?: { full_name?: string } };
  };
  if (pr?.number !== prNumber || !["open", "closed"].includes(pr.state ?? "")) {
    throw new ApiError("github_error", "GitHub returned an unrecognized pull request payload.", 502);
  }
  return {
    merged: pr.merged === true,
    state: pr.state as "open" | "closed",
    headSha: pr.head?.sha ?? "",
    mergeSha: pr.merge_commit_sha ?? "",
    title: pr.title ?? "",
    repoFullName: pr.base?.repo?.full_name ?? repoFullName,
  };
}

/** Prove immutable SHA ancestry without relying on a webhook's `before`. */
export async function githubHeadDescendsFrom(repoFullName: string, baseSha: string, headSha: string): Promise<boolean> {
  const [owner, name] = repoFullName.split("/");
  const token = await resolveGithubToken({ repoOwner: owner });
  if (!token) throw new ApiError("github_unavailable", "GitHub auth is unavailable for ancestry verification.", 503);
  const comparison = await githubGet(
    `${GH_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/compare/${encodeURIComponent(baseSha)}...${encodeURIComponent(headSha)}?per_page=1`,
    token
  ) as { status?: string };
  return comparison.status === "ahead" || comparison.status === "identical";
}
