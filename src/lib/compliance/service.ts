// EN-007 P1b — the compliance server service. Orchestrates the dispatch ledger,
// the pure verifier (verify.ts), and the event log (repo.ts); the
// /api/compliance/* routes are thin wrappers over these. DB access is via ./repo
// (mocked in tests/compliance-server.test.ts). Buckets have no server-side store
// yet, so the per-bucket PRD requirement is reported "unknown" (advisory) until
// one lands (EN-005/006) — see verifyPr.

import { ApiError } from "@/lib/api/route";
import type { Task } from "@/lib/mc-data";
import { getEntity } from "@/lib/sync/repo";
import { classifyRiskTier } from "./risk";
import { verifyCompliance } from "./verify";
import * as repo from "./repo";
import type { EventsQuery } from "./events";
import type { PrEvent } from "./webhook";
import type { ActorKind, RiskTier, VerifyResult } from "./types";

// Checkout credentials are short-lived (decision 14).
const CHECKOUT_TTL_MIN = 8 * 60;

function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// Deterministic check id so recordCheck's upsert actually dedups across
// reconciliation replays (review S3) — one row per (repo, pr, headSha).
function checkId(repoName: string, prNumber: number, headSha: string): string {
  return `chk_${repoName}_${prNumber}_${headSha}`.replace(/[^A-Za-z0-9_.-]/g, "_");
}

// Resolve a checkout credential strictly — unrevoked, unexpired, AND repo-bound —
// returning the dispatch it points at, or null. A present checkoutId always means
// an agent run; an invalid one yields null so the gate blocks the agent PR (never
// a silent downgrade to operator). Hardening: security review CRITICAL #1/#5/#6.
async function resolveDispatch(checkoutId: string, repoName: string): Promise<repo.DispatchRow | null> {
  const d = await repo.getDispatch(checkoutId);
  const valid = !!d && !d.revoked && new Date(d.expiresAt).getTime() > Date.now() && d.repo === repoName;
  return valid ? d : null;
}

// ─── Checkout (the handshake, decision 3) ────────────────────────────────────

export interface CheckoutInput {
  taskId: string;
  runtime: string;
  accountableHuman: string;
  repo: string;
}

export async function checkout(input: CheckoutInput): Promise<{ checkoutId: string }> {
  const checkoutId = genId("dsp");
  // A checkout ALWAYS mints an agent credential — it is the agent handshake.
  // Operators do not check out (their PRs are recorded ungated). The actor kind
  // is never taken from the client (that would bypass the bundle gate — security
  // review CRITICAL #1).
  await repo.insertDispatch({
    id: checkoutId,
    actorKind: "agent",
    runtime: input.runtime,
    taskId: input.taskId,
    accountableHuman: input.accountableHuman,
    repo: input.repo,
    ttlMinutes: CHECKOUT_TTL_MIN,
  });
  await repo.appendEvent({
    kind: "checkout",
    actor: input.runtime,
    repo: input.repo,
    taskId: input.taskId,
    payload: { checkoutId, accountableHuman: input.accountableHuman, actorKind: "agent" },
  });
  return { checkoutId };
}

// ─── Complete (the done marker, mirrors VMC complete_task) ───────────────────

export interface CompleteInput {
  checkoutId: string;
  summary: string;
  commitSha?: string;
  prUrl?: string;
}

export async function complete(input: CompleteInput): Promise<{ ok: true }> {
  // Validate the credential strictly — a bogus/expired/revoked id must not append
  // an orphan task.completed to the canonical log (review S4).
  const d = await repo.getDispatch(input.checkoutId);
  if (!d || d.revoked || new Date(d.expiresAt).getTime() <= Date.now()) {
    throw new ApiError("invalid_checkout", "Unknown, revoked, or expired checkout.", 409);
  }
  await repo.appendEvent({
    kind: "task.completed",
    actor: d.runtime,
    repo: d.repo,
    taskId: d.taskId,
    payload: {
      actorKind: "agent",
      checkoutId: input.checkoutId,
      summary: input.summary,
      commitSha: input.commitSha ?? null,
      prUrl: input.prUrl ?? null,
    },
  });
  return { ok: true };
}

// ─── Verify (the gate, decisions 2, 9, 12) ───────────────────────────────────

export interface VerifyPrInput {
  repo: string;
  prNumber: number;
  headSha: string;
  changedPaths: string[];
  labels?: string[];
  checkoutId?: string | null;
}

export interface VerifyPrResult extends VerifyResult {
  tier: RiskTier;
  actorKind: ActorKind;
  taskId: string | null;
}

async function loadTask(taskId: string | null): Promise<Task | null> {
  if (!taskId) return null;
  const row = await getEntity("task", taskId);
  return row ? (row.data as unknown as Task) : null;
}

export async function verifyPr(input: VerifyPrInput): Promise<VerifyPrResult> {
  const tier = classifyRiskTier(input.changedPaths, input.labels ?? []);

  // Actor + task come from the checkout credential, never git metadata
  // (decision 9). A present checkoutId means an agent run; an invalid/expired/
  // repo-mismatched one yields no task so the agent PR blocks. The client cannot
  // supply a taskId for attribution (review S7).
  let actorKind: ActorKind = "operator";
  let taskId: string | null = null;
  let actorIdentity = "operator";
  if (input.checkoutId) {
    actorKind = "agent";
    const d = await resolveDispatch(input.checkoutId, input.repo);
    taskId = d?.taskId ?? null;
    actorIdentity = d?.runtime ?? "agent";
  }

  const task = await loadTask(taskId);
  // No server bucket store yet (EN-005/006) → PRD presence is "unknown", so the
  // high-risk PRD requirement is advisory, not a hard block (review S1).
  const result = verifyCompliance({ task, actor: actorKind, tier, bucketPrd: "unknown" });

  await repo.recordCheck({
    id: checkId(input.repo, input.prNumber, input.headSha),
    repo: input.repo,
    prNumber: input.prNumber,
    headSha: input.headSha,
    taskId,
    actorKind,
    verdict: result.verdict,
    reasons: result.reasons,
  });
  await repo.appendEvent({
    kind: result.verdict === "pass" ? "gate.passed" : "gate.blocked",
    actor: actorIdentity,
    repo: input.repo,
    taskId,
    pr: String(input.prNumber),
    payload: { actorKind, tier, headSha: input.headSha, reasons: result.reasons },
    // Idempotent per (repo, pr, sha, verdict): a replay dedups; a genuine
    // re-verify that flips the verdict still records a new event (review S3).
    dedupKey: `gate:${input.repo}:${input.prNumber}:${input.headSha}:${result.verdict}`,
  });

  return { ...result, tier, actorKind, taskId };
}

// ─── git → MC ingestion (decision 8, the auto-maintained record) ─────────────

export interface IngestResult {
  action: string;
  actorKind: ActorKind;
  taskId: string | null;
  recorded: boolean;
}

// Maintain the system-of-record from the PR lifecycle. This records the PR as
// typed events (the event log IS the record, decision 13); it does NOT mutate
// the sync Task entity — that projection is owned by the sync/task layer and is
// emitted here as a `task.promotion.requested` seam (kept out of scope so this
// phase never writes src/lib/sync/**). The verdict gate is the verify route, not
// this path. Actor + task come from the checkout credential, never git metadata.
const HANDLED_ACTIONS = new Set(["opened", "reopened", "synchronize", "closed"]);

export async function ingestPullRequest(evt: PrEvent): Promise<IngestResult> {
  let actorKind: ActorKind = "operator";
  let taskId: string | null = null;
  let actorIdentity = evt.author || "operator";
  if (evt.checkoutId) {
    actorKind = "agent";
    const d = await resolveDispatch(evt.checkoutId, evt.repo);
    taskId = d?.taskId ?? null;
    actorIdentity = d?.runtime ?? "agent";
  }

  // Only record the lifecycle actions we model; ignore the rest (edited, labeled,
  // assigned, ready_for_review, …) so we never append a spurious pr.opened to the
  // record (review B1). dedupKey keys every append on its logical identity so a
  // reconciliation replay is a no-op (review S3).
  if (!HANDLED_ACTIONS.has(evt.action)) {
    return { action: evt.action, actorKind, taskId, recorded: false };
  }
  const idBase = `${evt.repo}:${evt.prNumber}:${evt.headSha}:${evt.action}`;

  if (evt.action === "closed") {
    if (evt.merged) {
      await repo.appendEvent({
        kind: "pr.merged", actor: actorIdentity, repo: evt.repo, taskId, pr: String(evt.prNumber),
        payload: { actorKind, sha: evt.headSha, branch: evt.branch, title: evt.title },
        dedupKey: `pr.merged:${evt.repo}:${evt.prNumber}:${evt.headSha}`,
      });
      await repo.appendEvent({
        kind: "task.promotion.requested", actor: actorIdentity, repo: evt.repo, taskId, pr: String(evt.prNumber),
        payload: { actorKind, sha: evt.headSha },
        dedupKey: `task.promotion.requested:${evt.repo}:${evt.prNumber}:${evt.headSha}`,
      });
    } else {
      // Closed WITHOUT merging is its own kind — NOT pr.opened (review B1).
      await repo.appendEvent({
        kind: "pr.closed", actor: actorIdentity, repo: evt.repo, taskId, pr: String(evt.prNumber),
        payload: { actorKind, sha: evt.headSha, branch: evt.branch, title: evt.title },
        dedupKey: `pr.closed:${idBase}`,
      });
    }
    return { action: evt.action, actorKind, taskId, recorded: true };
  }

  // opened / reopened / synchronize → record the PR. An operator PR with no
  // checkout is still recorded (decision 5), attributed to its author, sparse.
  const kind = evt.action === "synchronize" ? "pr.synchronized" : "pr.opened";
  const sparse = actorKind === "operator" && !taskId;
  await repo.appendEvent({
    kind,
    actor: actorIdentity,
    repo: evt.repo,
    taskId,
    pr: String(evt.prNumber),
    payload: { actorKind, branch: evt.branch, title: evt.title, author: evt.author, headSha: evt.headSha, sparse },
    dedupKey: `${kind}:${idBase}`,
  });
  return { action: evt.action, actorKind, taskId, recorded: true };
}

// ─── Fail-closed reconciliation (decision 10) ────────────────────────────────

export interface QueuedOutcome {
  verdict: "pending";
  reasons: string[];
  queued: true;
}

// Wrap the gate so a transient failure NEVER returns `pass`: it holds (pending)
// and enqueues for replay on recovery. The status check treats non-pass as a
// hold, so the PR cannot merge while MC is degraded.
export async function verifyPrOrQueue(input: VerifyPrInput): Promise<VerifyPrResult | QueuedOutcome> {
  try {
    return await verifyPr(input);
  } catch (err) {
    console.error("[compliance] verify failed — holding + queueing for reconciliation:", err);
    try {
      await repo.enqueueReconcile("verify", input as unknown as Record<string, unknown>);
    } catch (qerr) {
      // best-effort: even if the queue write fails we still hold (never pass).
      console.error("[compliance] reconcile enqueue failed:", qerr);
    }
    return { verdict: "pending", reasons: ["MC unavailable — held for reconciliation (fail-closed)"], queued: true };
  }
}

export async function ingestOrQueue(evt: PrEvent): Promise<IngestResult | { ingested: false; queued: true }> {
  try {
    return await ingestPullRequest(evt);
  } catch (err) {
    console.error("[compliance] ingest failed — queueing for reconciliation:", err);
    try {
      await repo.enqueueReconcile("ingest", evt as unknown as Record<string, unknown>);
    } catch (qerr) {
      console.error("[compliance] reconcile enqueue failed:", qerr);
    }
    return { ingested: false, queued: true };
  }
}

export interface ReconcileSweepResult {
  processed: number;
  resolved: number;
  failed: number;
}

// Replay queued work when MC recovers (driven by POST /api/compliance/reconcile
// or the sync scheduler cadence). Resolved rows drop out of the pending set.
// Note (review N7): if a checkout's TTL lapses while a verify sits queued, the
// replay re-resolves the now-expired credential and blocks — intended fail-closed
// behavior (a stale credential must not pass), not a regression.
export async function reconcileSweep(): Promise<ReconcileSweepResult> {
  const pending = await repo.pendingReconcile();
  let resolved = 0;
  let failed = 0;
  for (const row of pending) {
    try {
      if (row.kind === "verify") {
        await verifyPr(row.payload as unknown as VerifyPrInput);
      } else {
        await ingestPullRequest(row.payload as unknown as PrEvent);
      }
      await repo.resolveReconcile(row.id);
      resolved++;
    } catch (err) {
      await repo.bumpReconcileAttempt(row.id, err instanceof Error ? err.message : String(err));
      failed++;
    }
  }
  return { processed: pending.length, resolved, failed };
}

// ─── Event export (the Second-Brain feed) ────────────────────────────────────

export async function listEvents(q: EventsQuery) {
  return repo.eventsAfter(q.afterSeq, q.limit, q.kind);
}
