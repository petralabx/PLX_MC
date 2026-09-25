// Cross-repo activity summary for the Activity screen (/?screen=activity): per
// fleet registry repo — last activity, open/unstamped PRs, unattributed merged
// PRs (newest github.backfill.report), gate block rate, and data freshness.
// Computed on demand from the append-only mc_events substrate (no new store,
// no migration). computeRepoActivity is pure; loadRepoActivity wraps the
// compliance repo. Unknown is reported as null — never a fabricated zero.

import { latestBackfillReport, type BackfillReport, type UnattributedPr } from "./backfill";
import { eventsByKinds, type EventRow } from "./repo";
import { TRACKED_REPOS, type TrackedRepo } from "./tracked-repos";

export const ACTIVITY_EVENT_KINDS = [
  "checkout",
  "task.completed",
  "pr.opened",
  "pr.synchronized",
  "pr.merged",
  "pr.closed",
  "gate.passed",
  "gate.blocked",
] as const;

const PR_KINDS = new Set(["pr.opened", "pr.synchronized", "pr.merged", "pr.closed"]);
const OPEN_PR_KINDS = new Set(["pr.opened", "pr.synchronized"]);
const EVENT_SAMPLE_LIMIT = 5000;
const GATE_WINDOW_DAYS = 30;
// Mirrors the loop-ledgers registry freshness (warn 7d / stale 30d).
const FRESH_DAYS = 7;
const STALE_DAYS = 30;
// Nightly cron: a report older than a day and a half means a missed run.
const BACKFILL_STALE_HOURS = 36;
const DAY_MS = 86_400_000;
const MAX_OPEN_ITEMS = 20;

export type ActivityFreshness = "fresh" | "stale" | "dormant" | "none";

export interface OpenPrItem {
  pr: string;
  title: string;
  /** True when ingestion attributed the PR to at least one MC task. */
  stamped: boolean;
  at: string;
}

export interface RepoActivityRow {
  repo: string;
  displayName: string;
  lastActivityAt: string | null;
  freshness: ActivityFreshness;
  /** null when MC has no pr.* events for the repo (webhook not delivering). */
  openPrs: { open: number; unstamped: number; items: OpenPrItem[] } | null;
  /** Gate verdict events in the last gateWindowDays; blockRate null with no verdicts. */
  gate: { passed: number; blocked: number; blockRate: number | null };
  /** From the newest backfill report; null when the repo was not covered. */
  unattributed: {
    count: number;
    status: "ok" | "degraded";
    reason: string | null;
    truncated: boolean;
    items: UnattributedPr[];
  } | null;
}

export interface RepoActivityReport {
  generatedAt: string;
  events: {
    newestAt: string | null;
    oldestSampledAt: string | null;
    sampled: number;
    /** True when the newest-N sample limit was hit (older history not folded). */
    truncated: boolean;
  };
  backfill: { generatedAt: string | null; windowDays: number | null; stale: boolean };
  gateWindowDays: number;
  repos: RepoActivityRow[];
}

// Events carry either the full slug (checkout/complete) or the bare GitHub name
// (gate/pr, from github.event.repository.name); key on the bare name.
function repoKey(repo: string): string {
  return (repo.includes("/") ? repo.slice(repo.lastIndexOf("/") + 1) : repo).trim().toLowerCase();
}

function freshnessOf(lastMs: number | null, nowMs: number): ActivityFreshness {
  if (lastMs === null) return "none";
  const age = nowMs - lastMs;
  if (age <= FRESH_DAYS * DAY_MS) return "fresh";
  if (age <= STALE_DAYS * DAY_MS) return "stale";
  return "dormant";
}

function stampedEvent(ev: EventRow): boolean {
  const taskIds = ev.payload?.taskIds;
  return !!ev.taskId || (Array.isArray(taskIds) && taskIds.length > 0);
}

/** Pure fold: events (any order) + newest backfill report → per-repo rows. */
export function computeRepoActivity(input: {
  events: EventRow[];
  registry: readonly TrackedRepo[];
  backfill: BackfillReport | null;
  now: Date;
  sampleLimit?: number;
}): RepoActivityReport {
  const nowMs = input.now.getTime();
  const gateSinceMs = nowMs - GATE_WINDOW_DAYS * DAY_MS;
  const ordered = [...input.events].sort((a, b) => Number(a.seq) - Number(b.seq));
  const byKey = new Map(input.registry.map((entry) => [repoKey(entry.repo), entry.repo]));

  interface Acc {
    lastMs: number | null;
    passed: number;
    blocked: number;
    latestPr: Map<string, EventRow>;
  }
  const accs = new Map<string, Acc>(
    input.registry.map((entry) => [
      entry.repo,
      { lastMs: null, passed: 0, blocked: 0, latestPr: new Map<string, EventRow>() },
    ])
  );

  let newestMs: number | null = null;
  let oldestMs: number | null = null;
  for (const ev of ordered) {
    const tsMs = Date.parse(ev.ts);
    if (Number.isFinite(tsMs)) {
      newestMs = newestMs === null ? tsMs : Math.max(newestMs, tsMs);
      oldestMs = oldestMs === null ? tsMs : Math.min(oldestMs, tsMs);
    }
    const slug = ev.repo ? byKey.get(repoKey(ev.repo)) : undefined;
    const acc = slug ? accs.get(slug) : undefined;
    if (!acc || !Number.isFinite(tsMs)) continue;
    acc.lastMs = acc.lastMs === null ? tsMs : Math.max(acc.lastMs, tsMs);
    if (tsMs >= gateSinceMs && ev.kind === "gate.passed") acc.passed++;
    if (tsMs >= gateSinceMs && ev.kind === "gate.blocked") acc.blocked++;
    if (PR_KINDS.has(ev.kind) && ev.pr) acc.latestPr.set(ev.pr, ev); // seq order → last wins
  }

  const backfillByRepo = new Map((input.backfill?.repos ?? []).map((r) => [r.repo, r]));

  const repos: RepoActivityRow[] = input.registry.map((entry) => {
    const acc = accs.get(entry.repo)!;
    const open = [...acc.latestPr.values()]
      .filter((ev) => OPEN_PR_KINDS.has(ev.kind))
      .sort((a, b) => Number(b.seq) - Number(a.seq));
    const verdicts = acc.passed + acc.blocked;
    const covered = backfillByRepo.get(entry.repo);
    return {
      repo: entry.repo,
      displayName: entry.displayName,
      lastActivityAt: acc.lastMs === null ? null : new Date(acc.lastMs).toISOString(),
      freshness: freshnessOf(acc.lastMs, nowMs),
      openPrs:
        acc.latestPr.size === 0
          ? null
          : {
              open: open.length,
              unstamped: open.filter((ev) => !stampedEvent(ev)).length,
              items: open.slice(0, MAX_OPEN_ITEMS).map((ev) => ({
                pr: ev.pr ?? "",
                title: typeof ev.payload?.title === "string" ? ev.payload.title : "",
                stamped: stampedEvent(ev),
                at: ev.ts,
              })),
            },
      gate: {
        passed: acc.passed,
        blocked: acc.blocked,
        blockRate: verdicts === 0 ? null : acc.blocked / verdicts,
      },
      unattributed: covered
        ? {
            count: covered.unattributedCount,
            status: covered.status,
            reason: covered.reason,
            truncated: covered.truncated,
            items: covered.unattributed,
          }
        : null,
    };
  });

  const backfillMs = input.backfill ? Date.parse(input.backfill.generatedAt) : Number.NaN;
  return {
    generatedAt: input.now.toISOString(),
    events: {
      newestAt: newestMs === null ? null : new Date(newestMs).toISOString(),
      oldestSampledAt: oldestMs === null ? null : new Date(oldestMs).toISOString(),
      sampled: input.events.length,
      truncated: input.events.length >= (input.sampleLimit ?? EVENT_SAMPLE_LIMIT),
    },
    backfill: {
      generatedAt: input.backfill?.generatedAt ?? null,
      windowDays: input.backfill?.windowDays ?? null,
      stale: !(nowMs - backfillMs <= BACKFILL_STALE_HOURS * 3_600_000),
    },
    gateWindowDays: GATE_WINDOW_DAYS,
    repos,
  };
}

/** Loader: newest activity events + newest backfill report, folded over the registry. */
export async function loadRepoActivity(now: Date = new Date()): Promise<RepoActivityReport> {
  const [events, backfill] = await Promise.all([
    eventsByKinds([...ACTIVITY_EVENT_KINDS], EVENT_SAMPLE_LIMIT),
    latestBackfillReport(),
  ]);
  return computeRepoActivity({ events, registry: TRACKED_REPOS, backfill, now });
}
