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
// reconciliation replays (review S3) — one row per (repo, pr, headSha, task).
// taskId is part of the key so a multi-task PR records one check per task.
function checkId(repoName: string, prNumber: number, headSha: string, taskId?: string | null): string {
  return `chk_${repoName}_${prNumber}_${headSha}${taskId ? `_${taskId}` : ""}`.replace(/[^A-Za-z0-9_.-]/g, "_");
}

// Resolve a checkout credential strictly — unrevoked, unexpired, AND repo-bound —
// returning the dispatch it points at, or null. A present checkoutId always means
// an agent run; an invalid one yields null so the gate blocks the agent PR (never
// a silent downgrade to operator). Hardening: security review CRITICAL #1/#5/#6.
// The gate sends `repo` as the bare GitHub name (github.event.repository.name,
// e.g. "PLX_MC"), but a checkout may be minted with the full "owner/name" slug
// (what .cursor/mcp.json + the team-registration runbook show as MC_REPO). Match
// on the bare repo name so either form resolves — without this, a slug-minted
// stamp resolves taskId=null and a valid agent PR is wrongly blocked.
function bareRepo(r: string): string {
  return r.includes("/") ? r.slice(r.lastIndexOf("/") + 1) : r;
}

async function resolveDispatch(checkoutId: string, repoName: string): Promise<repo.DispatchRow | null> {
  const d = await repo.getDispatch(checkoutId);
  const repoMatches = !!d && bareRepo(d.repo) === bareRepo(repoName);
  const valid = !!d && !d.revoked && new Date(d.expiresAt).getTime() > Date.now() && repoMatches;
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
  checkoutId?: string | null; // single checkout (back-compat)
  checkoutIds?: string[] | null; // multi-task: one MC-Checkout per task on the PR
}

// Per-task verdict for a multi-task PR (one entry per checked-out task).
export interface VerifyPrTaskResult {
  checkoutId: string;
  taskId: string | null;
  verdict: "pass" | "block";
  reasons: string[];
}

export interface VerifyPrResult extends VerifyResult {
  tier: RiskTier;
  actorKind: ActorKind;
  taskId: string | null; // first resolved task (back-compat)
  tasks: VerifyPrTaskResult[]; // per-task verdicts; empty for an operator PR
}

async function loadTask(taskId: string | null): Promise<Task | null> {
  if (!taskId) return null;
  const row = await getEntity("task", taskId);
  return row ? (row.data as unknown as Task) : null;
}

// Record a single task's verdict: one check row + one gate event, keyed by task
// so a multi-task PR never collides (one check + one event per task).
async function recordVerdict(
  input: VerifyPrInput,
  tier: RiskTier,
  actorKind: ActorKind,
  taskId: string | null,
  actorIdentity: string,
  result: VerifyResult,
  // Stable per-record key: the resolved taskId, else the checkout id (so several
  // INVALID checkouts on one PR — all taskId null — don't collide on a single
  // "none" row), else null for an operator PR.
  subjectId: string | null
): Promise<void> {
  await repo.recordCheck({
    id: checkId(input.repo, input.prNumber, input.headSha, subjectId),
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
    // Idempotent per (repo, pr, sha, subject, verdict): a replay dedups; a
    // re-verify that flips a verdict still records (review S3). subjectId keeps
    // each task — and each invalid checkout — of a multi-task PR distinct.
    dedupKey: `gate:${input.repo}:${input.prNumber}:${input.headSha}:${subjectId ?? "none"}:${result.verdict}`,
  });
}

export async function verifyPr(input: VerifyPrInput): Promise<VerifyPrResult> {
  const tier = classifyRiskTier(input.changedPaths, input.labels ?? []);

  // Actor + task(s) come from the checkout credential(s), never git metadata
  // (decision 9). Prefer the multi-task list; fall back to the single id
  // (back-compat). Dedup. No checkouts → an operator PR (recorded, ungated).
  const ids = Array.from(
    new Set(
      (input.checkoutIds?.length ? input.checkoutIds : input.checkoutId ? [input.checkoutId] : []).filter(Boolean)
    )
  ) as string[];

  // Operator PR: one verdict, recorded ungated (decision 5). PRD presence is
  // "unknown" (no server bucket store yet, EN-005/006) → advisory (review S1).
  if (ids.length === 0) {
    const result = verifyCompliance({ task: null, actor: "operator", tier, bucketPrd: "unknown" });
    await recordVerdict(input, tier, "operator", null, "operator", result, null);
    return { ...result, tier, actorKind: "operator", taskId: null, tasks: [] };
  }

  // Agent PR: verify EVERY checked-out task. The PR passes only if ALL pass — one
  // incomplete task blocks the whole PR (one logical theme, N related tasks). Each
  // task's verdict is its own recorded check + event.
  const tasks: VerifyPrTaskResult[] = [];
  for (const cid of ids) {
    const d = await resolveDispatch(cid, input.repo);
    const taskId = d?.taskId ?? null;
    const actorIdentity = d?.runtime ?? "agent";
    const task = await loadTask(taskId);
    const result = verifyCompliance({ task, actor: "agent", tier, bucketPrd: "unknown" });
    await recordVerdict(input, tier, "agent", taskId, actorIdentity, result, taskId ?? cid);
    tasks.push({ checkoutId: cid, taskId, verdict: result.verdict, reasons: result.reasons });
  }

  // Pass only if EVERY task passes. When blocked, surface only the blocking
  // tasks' reasons (exactly what to fix); when passing, surface the pass reasons.
  // Each reason is prefixed with its task id so a multi-task PR is unambiguous.
  const blocked = tasks.filter((t) => t.verdict === "block");
  const verdict: "pass" | "block" = blocked.length === 0 ? "pass" : "block";
  const reasons = (blocked.length ? blocked : tasks).flatMap((t) =>
    t.reasons.map((r) => `${t.taskId ?? `checkout ${t.checkoutId}`}: ${r}`)
  );
  return { verdict, reasons, tier, actorKind: "agent", taskId: tasks[0]?.taskId ?? null, tasks };
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
  // Resolve EVERY stamped checkout (multi-task PRs complete N tasks) so the record
  // attributes them all, not just the first. Prefer the full list; fall back to
  // the single id (back-compat). The primary taskId stays the first resolved one.
  const ids = evt.checkoutIds?.length ? evt.checkoutIds : evt.checkoutId ? [evt.checkoutId] : [];
  let taskIds: string[] = [];
  if (ids.length > 0) {
    actorKind = "agent";
    for (const cid of ids) {
      const d = await resolveDispatch(cid, evt.repo);
      if (d?.taskId) taskIds.push(d.taskId);
      if (actorIdentity === (evt.author || "operator") && d?.runtime) actorIdentity = d.runtime;
    }
    taskIds = Array.from(new Set(taskIds));
    taskId = taskIds[0] ?? null;
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
        payload: { actorKind, sha: evt.headSha, branch: evt.branch, title: evt.title, taskIds },
        dedupKey: `pr.merged:${evt.repo}:${evt.prNumber}:${evt.headSha}`,
      });
      // One promotion seam PER task — a multi-task PR promotes every task it
      // completed, not just the first (keyed per task so replays dedup). An
      // operator merge (no tasks) emits a single sparse seam, as before.
      const promote = taskIds.length > 0 ? taskIds : [null];
      for (const tid of promote) {
        await repo.appendEvent({
          kind: "task.promotion.requested", actor: actorIdentity, repo: evt.repo, taskId: tid, pr: String(evt.prNumber),
          payload: { actorKind, sha: evt.headSha },
          dedupKey: `task.promotion.requested:${evt.repo}:${evt.prNumber}:${evt.headSha}:${tid ?? "none"}`,
        });
      }
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
    payload: { actorKind, branch: evt.branch, title: evt.title, author: evt.author, headSha: evt.headSha, sparse, taskIds },
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
