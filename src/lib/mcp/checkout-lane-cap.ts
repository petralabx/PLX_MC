// D15 (TASK-3863): mc_checkout_task refuses a checkout for a new portal PR when
// the branch's lane already holds its cap of open PRs, so the portal CI gate can
// move to report-only (vars.LANE_CAP_MODE=report). Lanes, caps and what counts
// follow the portal's own gate, scripts/lib/lane-pr-cap.mjs on staging: drafts and
// the excluded author never count, and a branch that already has an open PR always
// passes. MC cannot see the merge queue, so a queued PR counts until it merges,
// like the portal's own fallback. Whatever MC cannot read fails open with a warning.
import { resolveGithubToken } from "@/lib/github-app";

const GH_API = "https://api.github.com";
export const LANE_CAP_REPO = "petralabx/plx-customer-portal";
const CAP_SOURCE_URL = `${GH_API}/repos/${LANE_CAP_REPO}/contents/scripts/lib/lane-pr-cap.mjs?ref=staging`;
const LANE_CAP_TIMEZONE = "America/Toronto";
const CAP_SOURCE_TTL_MS = 5 * 60_000;
const OPEN_PULLS_TTL_MS = 30_000;
const MAX_PULL_PAGES = 5;
// A slow GitHub must not hold up the checkout: past this, the check fails open.
const FETCH_TIMEOUT_MS = 5_000;

export type LaneCapMode = "enforce" | "warn" | "off";

/** Kill switch: PLX_MC_LANE_CAP_CHECKOUT=warn reports without refusing; off skips the check. */
export function laneCapCheckoutMode(): LaneCapMode {
  const mode = (process.env.PLX_MC_LANE_CAP_CHECKOUT ?? "").trim().toLowerCase();
  return mode === "warn" || mode === "off" ? mode : "enforce";
}

export type Lane = "claude" | "task" | "cip" | "feature-map";

/** The portal's laneOfHead: the lane a head branch counts against, or null. */
export function laneOfBranch(branch: string): Lane | null {
  const h = branch.trim();
  if (h.startsWith("claude/")) return "claude";
  if (h.startsWith("task/")) return "task";
  if (h.startsWith("cip/")) return "cip";
  if (h.startsWith("cursor/map-") || h.startsWith("cursor/verify-portal-") || h === "harness/feature-map-rolling") {
    return "feature-map";
  }
  return null;
}

export interface LaneCapSource {
  baseCap: number;
  raises: Record<string, { cap: number; throughTorontoDate: string }>;
  excludedAuthor: string;
}

/**
 * Reads LANE_CAP, TEMP_LANE_CAP_RAISES and EXCLUDED_AUTHOR from the portal's
 * lane-pr-cap.mjs. Returns null when the file no longer has that shape.
 */
export function parseLaneCapSource(text: string): LaneCapSource | null {
  const base = /export const LANE_CAP = (\d+);/.exec(text);
  const excluded = /export const EXCLUDED_AUTHOR = "([^"]+)";/.exec(text);
  if (!base || !excluded) return null;
  const raises: LaneCapSource["raises"] = {};
  const block = /export const TEMP_LANE_CAP_RAISES = Object\.freeze\(\{([\s\S]*?)\n\}\);/.exec(text);
  if (block) {
    const entry = /(?:"([a-z][a-z-]*)"|([a-z][a-z-]*)):\s*Object\.freeze\(\{\s*cap:\s*(\d+),\s*throughTorontoDate:\s*"(\d{4}-\d{2}-\d{2})"/g;
    for (const m of block[1].matchAll(entry)) {
      raises[m[1] ?? m[2]] = { cap: Number(m[3]), throughTorontoDate: m[4] };
    }
    // An entry this parser cannot read must not be skipped silently.
    if ((block[1].match(/\bcap:/g) ?? []).length !== Object.keys(raises).length) return null;
  } else if (text.includes("TEMP_LANE_CAP_RAISES =")) {
    return null;
  }
  return { baseCap: Number(base[1]), raises, excludedAuthor: excluded[1] };
}

/** YYYY-MM-DD in America/Toronto, or null for an invalid date. */
export function torontoDate(now: Date): string | null {
  if (Number.isNaN(now.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: LANE_CAP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** A raise applies while the Toronto date is on or before its last day. */
export function laneCapFor(lane: Lane, now: Date, source: LaneCapSource): number {
  const raise = source.raises[lane];
  const today = torontoDate(now);
  return raise && today && today <= raise.throughTorontoDate ? raise.cap : source.baseCap;
}

export interface OpenPull {
  number: number;
  headRef: string;
  author: string;
  draft: boolean;
}

type LaneCount = { lane: Lane; cap: number; openCount: number; openPrs: number[] };

export type LaneCapResult =
  | { status: "unverified"; reason: string }
  | { status: "uncharted"; branch: string }
  | { status: "existing_pr"; lane: Lane; pr: number }
  | ({ status: "proceed" } & LaneCount)
  | ({ status: "blocked" } & LaneCount);

/** Whether a new PR on `branch` would push its lane past the cap. */
export function evaluateLaneCap(input: {
  branch: string;
  pulls: readonly OpenPull[];
  source: LaneCapSource;
  now: Date;
}): LaneCapResult {
  const branch = input.branch.trim();
  const lane = laneOfBranch(branch);
  if (!lane) return { status: "uncharted", branch };
  const own = input.pulls.find((p) => p.headRef === branch);
  if (own) return { status: "existing_pr", lane, pr: own.number };
  const excluded = input.source.excludedAuthor.toLowerCase();
  const open = input.pulls
    .filter((p) => !p.draft && p.author.toLowerCase() !== excluded && laneOfBranch(p.headRef) === lane)
    .map((p) => p.number)
    .sort((a, b) => a - b);
  const count: LaneCount = { lane, cap: laneCapFor(lane, input.now, input.source), openCount: open.length, openPrs: open };
  return open.length >= count.cap ? { status: "blocked", ...count } : { status: "proceed", ...count };
}

export function laneCapRefusal(result: Extract<LaneCapResult, { status: "blocked" }>): string {
  const prs = result.openPrs.map((n) => `#${n}`).join(", ");
  return (
    `Lane ${result.lane} is full: ${result.openCount} open PRs against its cap of ${result.cap} (${prs}). ` +
    "Wait until one merges or closes, or ask Vince to raise the cap in the portal's scripts/lib/lane-pr-cap.mjs. " +
    "Draft PRs do not count. A branch that already has an open PR always passes."
  );
}

export interface LaneCapDeps {
  fetchImpl?: typeof fetch;
  resolveToken?: (opts: { repoOwner?: string | null }) => Promise<string | null>;
  now?: () => Date;
}

let sourceCache: { at: number; value: LaneCapSource } | null = null;
let pullsCache: { at: number; value: OpenPull[] } | null = null;

export function resetLaneCapCacheForTests(): void {
  sourceCache = null;
  pullsCache = null;
}

class LaneCapReadError extends Error {}

function headers(token: string, accept: string): HeadersInit {
  return { authorization: `Bearer ${token}`, accept, "x-github-api-version": "2022-11-28" };
}

async function readSource(token: string, fetchImpl: typeof fetch, nowMs: number): Promise<LaneCapSource> {
  if (sourceCache && nowMs - sourceCache.at < CAP_SOURCE_TTL_MS) return sourceCache.value;
  const res = await fetchImpl(CAP_SOURCE_URL, {
    headers: headers(token, "application/vnd.github.raw"),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new LaneCapReadError(`cap_source_http_${res.status}`);
  const source = parseLaneCapSource(await res.text());
  if (!source) throw new LaneCapReadError("cap_source_unparsed");
  sourceCache = { at: nowMs, value: source };
  return source;
}

async function readOpenPulls(token: string, fetchImpl: typeof fetch, nowMs: number): Promise<OpenPull[]> {
  if (pullsCache && nowMs - pullsCache.at < OPEN_PULLS_TTL_MS) return pullsCache.value;
  const pulls: OpenPull[] = [];
  for (let page = 1; page <= MAX_PULL_PAGES; page++) {
    const res = await fetchImpl(`${GH_API}/repos/${LANE_CAP_REPO}/pulls?state=open&per_page=100&page=${page}`, {
      headers: headers(token, "application/vnd.github+json"),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new LaneCapReadError(`pulls_http_${res.status}`);
    const body: unknown = await res.json();
    if (!Array.isArray(body)) throw new LaneCapReadError("pulls_malformed");
    for (const row of body as Array<Record<string, unknown>>) {
      const head = row.head as { ref?: unknown } | undefined;
      const user = row.user as { login?: unknown } | undefined;
      if (typeof row.number !== "number" || typeof head?.ref !== "string") continue;
      pulls.push({
        number: row.number,
        headRef: head.ref,
        author: typeof user?.login === "string" ? user.login : "",
        draft: row.draft === true,
      });
    }
    if (body.length < 100) break;
  }
  pullsCache = { at: nowMs, value: pulls };
  return pulls;
}

/**
 * The lane-cap check for one checkout, or null when it does not apply (another
 * repo, or the kill switch is off). Never throws: what it cannot read is "unverified".
 */
export async function checkoutLaneCap(
  input: { repo: string; branch?: string | null },
  deps: LaneCapDeps = {}
): Promise<LaneCapResult | null> {
  if (input.repo.trim().toLowerCase() !== LANE_CAP_REPO || laneCapCheckoutMode() === "off") return null;
  const branch = input.branch?.trim();
  if (!branch) return { status: "unverified", reason: "no_branch" };
  if (!laneOfBranch(branch)) return { status: "uncharted", branch };
  const now = (deps.now ?? (() => new Date()))();
  try {
    const token = await (deps.resolveToken ?? resolveGithubToken)({ repoOwner: "petralabx" });
    if (!token) throw new LaneCapReadError("token_unconfigured");
    const fetchImpl = deps.fetchImpl ?? fetch;
    const [source, pulls] = await Promise.all([
      readSource(token, fetchImpl, now.getTime()),
      readOpenPulls(token, fetchImpl, now.getTime()),
    ]);
    return evaluateLaneCap({ branch, pulls, source, now });
  } catch (err) {
    const reason = err instanceof LaneCapReadError ? err.message : "github_unreachable";
    console.warn("[mcp] lane cap unverified; checkout proceeds", { repo: LANE_CAP_REPO, branch, reason });
    return { status: "unverified", reason };
  }
}
