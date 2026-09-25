// Nightly GitHub backfill — coverage for merged work that never reached MC
// (webhook not enabled org-wide, a stamp missing or unresolvable). For every
// fleet registry repo it lists PRs merged in the last N days through the shared
// GitHub token resolver and reports the ones with no MC task link: no
// `MC-Checkout: dsp_*` stamp that resolves to a task for that repo, and not
// already on any MC task's prs[].
//
// Read-only toward GitHub. The only write is one `github.backfill.report` row
// in mc_events (recordBackfillReport), and the cron that calls this is
// default-off behind PLX_MC_GITHUB_BACKFILL_ENABLED. Fail-open per repo: a
// GitHub failure marks that repo degraded with a distinct reason; it never
// fails the run or fabricates a zero. PR bodies are parsed in memory for stamps
// only (the same parser the webhook uses) — never persisted.

import { resolveGithubToken } from "@/lib/github-app";
import type { PullRequest } from "@/lib/mc-data";
import { getEntities, getRepos } from "@/lib/sync/repo";
import * as repo from "./repo";
import type { DispatchRow } from "./repo";
import { dispatchRepoMatches } from "./service";
import { TRACKED_REPO_SLUGS } from "./tracked-repos";
import { parsePullRequestEvent } from "./webhook";

export const BACKFILL_EVENT_KIND = "github.backfill.report";
const BACKFILL_ACTOR = "github-backfill";
const DEFAULT_DAYS = 7;
const MAX_DAYS = 30;
const DAY_MS = 86_400_000;
// 5 pages × 100 = the newest 500 closed PRs per repo per run; beyond that the
// repo result is flagged truncated rather than silently cut.
const MAX_PAGES = 5;
const PER_PAGE = 100;
// Bound the stored detail; the count stays exact.
const MAX_LISTED = 50;
const GH_API = "https://api.github.com";

export type BackfillDegradedReason =
  | "token_unconfigured"
  | "permission_denied"
  | "not_found"
  | "rate_limit"
  | "network_error";

export interface UnattributedPr {
  number: number;
  title: string;
  url: string;
  author: string;
  mergedAt: string;
  /** no_stamp: no MC-Checkout line; stamp_unresolved: stamp(s) map to no task for this repo. */
  reason: "no_stamp" | "stamp_unresolved";
}

export interface BackfillRepoResult {
  repo: string;
  status: "ok" | "degraded";
  reason: BackfillDegradedReason | null;
  merged: number;
  attributed: number;
  unattributedCount: number;
  /** Newest-first, capped at MAX_LISTED; unattributedCount is exact. */
  unattributed: UnattributedPr[];
  /** True when the page cap was hit before the listing left the window. */
  truncated: boolean;
}

export interface BackfillReport {
  generatedAt: string;
  windowDays: number;
  since: string;
  repos: BackfillRepoResult[];
  totals: { merged: number; unattributed: number; degraded: number };
}

export class GithubPullsError extends Error {
  constructor(
    public reason: BackfillDegradedReason,
    message: string
  ) {
    super(message);
  }
}

export interface GithubPullsClient {
  /** One 1-based page of closed PRs, most recently updated first. Throws GithubPullsError. */
  listClosedPulls(repo: string, page: number): Promise<unknown[]>;
}

export interface BackfillDeps {
  github: GithubPullsClient;
  /** Dispatch ledger lookup for a checkout id (compliance repo.getDispatch). */
  getDispatch: (checkoutId: string) => Promise<DispatchRow | null>;
  /** `bare-name#num` keys of every PR already on an MC task's prs[]. */
  linkedPrKeys: () => Promise<Set<string>>;
  now?: () => Date;
}

/** `?days=` → integer window, default 7, clamped to 1..30. */
export function parseBackfillDays(raw: string | null): number {
  const n = Number(raw ?? DEFAULT_DAYS);
  if (!Number.isFinite(n)) return DEFAULT_DAYS;
  return Math.min(MAX_DAYS, Math.max(1, Math.floor(n)));
}

function bareName(slug: string): string {
  return slug.includes("/") ? slug.slice(slug.lastIndexOf("/") + 1) : slug;
}

function prLinkKey(repoName: string, num: number): string {
  return `${bareName(repoName).trim().toLowerCase()}#${num}`;
}

/**
 * Pure: link keys for every PR on a task's prs[]. prs[].repo is either a bare
 * GitHub name (compliance projection) or an MC registry id (UI links), so ids
 * resolve through the MC repos table to their GitHub name.
 */
export function prLinkKeys(
  tasks: Array<{ prs?: PullRequest[] }>,
  repos: Array<{ id: string; name: string }>
): Set<string> {
  const nameById = new Map(repos.map((r) => [r.id, r.name]));
  const keys = new Set<string>();
  for (const task of tasks) {
    for (const link of task.prs ?? []) {
      keys.add(prLinkKey(nameById.get(link.repo) ?? link.repo, link.num));
    }
  }
  return keys;
}

function httpFailReason(res: Response): BackfillDegradedReason {
  if (res.status === 429) return "rate_limit";
  if (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0") return "rate_limit";
  if (res.status === 401 || res.status === 403) return "permission_denied";
  if (res.status === 404) return "not_found";
  return "network_error";
}

/** GitHub REST pulls client over the shared token resolver. fetch is injectable. */
export function createGithubPullsClient(
  opts: {
    fetchImpl?: typeof fetch;
    resolveToken?: (o: { repoOwner?: string | null }) => Promise<string | null>;
  } = {}
): GithubPullsClient {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const resolveToken = opts.resolveToken ?? resolveGithubToken;
  return {
    async listClosedPulls(slug, page) {
      const [owner, name] = slug.split("/");
      const token = await resolveToken({ repoOwner: owner });
      if (!token) {
        throw new GithubPullsError("token_unconfigured", "No GitHub App or PAT token configured.");
      }
      const url =
        `${GH_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls` +
        `?state=closed&sort=updated&direction=desc&per_page=${PER_PAGE}&page=${page}`;
      let res: Response;
      try {
        res = await fetchImpl(url, {
          headers: {
            authorization: `Bearer ${token}`,
            accept: "application/vnd.github+json",
            "x-github-api-version": "2022-11-28",
          },
        });
      } catch (err) {
        throw new GithubPullsError(
          "network_error",
          `GitHub pulls list failed: ${err instanceof Error ? err.message : "network error"}`
        );
      }
      if (!res.ok) {
        throw new GithubPullsError(httpFailReason(res), `GitHub pulls list failed (HTTP ${res.status})`);
      }
      const body: unknown = await res.json();
      return Array.isArray(body) ? body : [];
    },
  };
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

function timeOf(v: unknown): number {
  return typeof v === "string" ? Date.parse(v) : Number.NaN;
}

async function listMergedSince(
  github: GithubPullsClient,
  slug: string,
  sinceMs: number
): Promise<{ prs: Record<string, unknown>[]; truncated: boolean }> {
  const prs: Record<string, unknown>[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const items = (await github.listClosedPulls(slug, page)).map(asRecord);
    if (items.length === 0) return { prs, truncated: false };
    for (const item of items) {
      if (timeOf(item.merged_at) >= sinceMs) prs.push(item);
    }
    // Sorted by updated desc: once the tail is older than the window, every
    // later page is too (merged_at <= updated_at).
    if (!(timeOf(items[items.length - 1].updated_at) >= sinceMs)) {
      return { prs, truncated: false };
    }
  }
  return { prs, truncated: true };
}

async function stampResolves(
  checkoutIds: string[],
  repoName: string,
  repoFullName: string,
  deps: BackfillDeps
): Promise<boolean> {
  for (const checkoutId of checkoutIds) {
    const d = await deps.getDispatch(checkoutId);
    // Historical attribution: an expired credential still names its task; a
    // revoked one or one bound to another repo does not.
    if (d && !d.revoked && d.taskId && dispatchRepoMatches(d.repo, repoName, repoFullName)) {
      return true;
    }
  }
  return false;
}

async function backfillRepo(
  slug: string,
  sinceMs: number,
  linked: Set<string>,
  deps: BackfillDeps
): Promise<BackfillRepoResult> {
  const base: BackfillRepoResult = {
    repo: slug,
    status: "ok",
    reason: null,
    merged: 0,
    attributed: 0,
    unattributedCount: 0,
    unattributed: [],
    truncated: false,
  };
  let listing: { prs: Record<string, unknown>[]; truncated: boolean };
  try {
    listing = await listMergedSince(deps.github, slug, sinceMs);
  } catch (err) {
    const reason = err instanceof GithubPullsError ? err.reason : "network_error";
    console.warn("[github-backfill] %s degraded: %s", slug, reason);
    return { ...base, status: "degraded", reason };
  }

  const unattributed: UnattributedPr[] = [];
  let attributed = 0;
  for (const raw of listing.prs) {
    // Reuse the webhook parser so stamps are read exactly as ingestion reads them.
    const evt = parsePullRequestEvent({
      action: "closed",
      pull_request: { ...raw, merged: true },
      repository: { full_name: slug, name: bareName(slug) },
    });
    if (!evt) continue;
    if (linked.has(prLinkKey(evt.repo, evt.prNumber))) {
      attributed++;
      continue;
    }
    if (
      evt.checkoutIds.length > 0 &&
      (await stampResolves(evt.checkoutIds, evt.repo, slug, deps))
    ) {
      attributed++;
      continue;
    }
    unattributed.push({
      number: evt.prNumber,
      title: evt.title,
      url: typeof raw.html_url === "string" ? raw.html_url : `https://github.com/${slug}/pull/${evt.prNumber}`,
      author: evt.author,
      mergedAt: String(raw.merged_at),
      reason: evt.checkoutIds.length > 0 ? "stamp_unresolved" : "no_stamp",
    });
  }
  unattributed.sort((a, b) => Date.parse(b.mergedAt) - Date.parse(a.mergedAt) || a.number - b.number);
  return {
    ...base,
    merged: listing.prs.length,
    attributed,
    unattributedCount: unattributed.length,
    unattributed: unattributed.slice(0, MAX_LISTED),
    truncated: listing.truncated,
  };
}

/** Run the backfill over the registry (or `opts.repos`). Repos run sequentially. */
export async function runGithubBackfill(
  deps: BackfillDeps,
  opts: { days?: number; repos?: readonly string[] } = {}
): Promise<BackfillReport> {
  const now = (deps.now ?? (() => new Date()))();
  const windowDays = parseBackfillDays(opts.days === undefined ? null : String(opts.days));
  const sinceMs = now.getTime() - windowDays * DAY_MS;
  const linked = await deps.linkedPrKeys();
  const repos: BackfillRepoResult[] = [];
  for (const slug of opts.repos ?? TRACKED_REPO_SLUGS) {
    repos.push(await backfillRepo(slug, sinceMs, linked, deps));
  }
  return {
    generatedAt: now.toISOString(),
    windowDays,
    since: new Date(sinceMs).toISOString(),
    repos,
    totals: {
      merged: repos.reduce((sum, r) => sum + r.merged, 0),
      unattributed: repos.reduce((sum, r) => sum + r.unattributedCount, 0),
      degraded: repos.filter((r) => r.status === "degraded").length,
    },
  };
}

/** Production wiring: GitHub over the shared token resolver + MC dispatch/task stores. */
export function defaultBackfillDeps(): BackfillDeps {
  return {
    github: createGithubPullsClient(),
    getDispatch: (checkoutId) => repo.getDispatch(checkoutId),
    linkedPrKeys: async () => {
      const [tasks, repos] = await Promise.all([getEntities("task"), getRepos()]);
      return prLinkKeys(
        tasks.map((row) => row.data as unknown as { prs?: PullRequest[] }),
        repos
      );
    },
  };
}

/** Persist one report as an mc_events row (the UI reads the newest one). */
export async function recordBackfillReport(
  report: BackfillReport,
  append: (e: repo.AppendEventInput) => Promise<void> = repo.appendEvent
): Promise<void> {
  await append({
    kind: BACKFILL_EVENT_KIND,
    actor: BACKFILL_ACTOR,
    payload: report as unknown as Record<string, unknown>,
  });
}

/** Newest recorded report, or null when the backfill has never run. */
export async function latestBackfillReport(): Promise<BackfillReport | null> {
  const [row] = await repo.eventsByKinds([BACKFILL_EVENT_KIND], 1);
  return row ? (row.payload as unknown as BackfillReport) : null;
}
