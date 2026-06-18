// EN-007 P1b — the compliance server service. Orchestrates the dispatch ledger,
// the pure verifier (verify.ts), and the event log (repo.ts); the
// /api/compliance/* routes are thin wrappers over these. DB access is via ./repo
// (mocked in tests/compliance-server.test.ts). Buckets have no server-side store
// yet, so the per-bucket PRD check reads the BUCKETS fixture — TODO: switch to a
// server bucket store when one lands (EN-005/EN-006).

import { BUCKETS } from "@/lib/mc-data";
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

// Resolve the task a checkout credential is bound to — strictly. The credential
// must be unrevoked, unexpired, AND bound to this repo; otherwise it yields null
// (so the gate blocks the agent PR — an expired/forged/mismatched credential is
// never silently downgraded to an operator pass). Hardening for the security
// review (CRITICAL #1 / #5 / #6): a present checkoutId always means an agent run.
async function resolveTaskFromCheckout(checkoutId: string, repoName: string): Promise<string | null> {
  const d = await repo.getDispatch(checkoutId);
  const valid = !!d && !d.revoked && new Date(d.expiresAt).getTime() > Date.now() && d.repo === repoName;
  return valid ? d!.taskId : null;
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
  const d = await repo.getDispatch(input.checkoutId);
  await repo.appendEvent({
    kind: "task.completed",
    actor: d?.runtime ?? "unknown",
    repo: d?.repo ?? null,
    taskId: d?.taskId ?? null,
    payload: {
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
  taskId?: string | null;
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
  // (decision 9). A present checkoutId means an agent run; a missing/invalid one
  // is resolved strictly (expiry + repo binding) so a bad credential blocks
  // rather than downgrades to an operator pass. No checkoutId ⇒ operator path.
  let actorKind: ActorKind = "operator";
  let taskId = input.taskId ?? null;
  if (input.checkoutId) {
    actorKind = "agent";
    taskId = await resolveTaskFromCheckout(input.checkoutId, input.repo);
  }

  const task = await loadTask(taskId);
  const bucketHasPrd = !!(task && BUCKETS.find((b) => b.id === task.bucket)?.prd);
  const result = verifyCompliance({ task, actor: actorKind, tier, bucketHasPrd });

  await repo.recordCheck({
    id: genId("chk"),
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
    actor: actorKind,
    repo: input.repo,
    taskId,
    pr: String(input.prNumber),
    payload: { tier, headSha: input.headSha, reasons: result.reasons },
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
export async function ingestPullRequest(evt: PrEvent): Promise<IngestResult> {
  let actorKind: ActorKind = "operator";
  let taskId: string | null = null;
  if (evt.checkoutId) {
    actorKind = "agent";
    taskId = await resolveTaskFromCheckout(evt.checkoutId, evt.repo);
  }

  if (evt.action === "closed" && evt.merged) {
    await repo.appendEvent({
      kind: "pr.merged",
      actor: actorKind,
      repo: evt.repo,
      taskId,
      pr: String(evt.prNumber),
      payload: { sha: evt.headSha, branch: evt.branch, title: evt.title },
    });
    await repo.appendEvent({
      kind: "task.promotion.requested",
      actor: actorKind,
      repo: evt.repo,
      taskId,
      pr: String(evt.prNumber),
      payload: { sha: evt.headSha },
    });
    return { action: evt.action, actorKind, taskId, recorded: true };
  }

  // opened / reopened / synchronize → record the PR. An operator PR with no
  // checkout is still recorded (decision 5), attributed to its author and
  // flagged sparse (ungated, no task yet).
  const sparse = actorKind === "operator" && !taskId;
  await repo.appendEvent({
    kind: evt.action === "synchronize" ? "pr.synchronized" : "pr.opened",
    actor: actorKind === "operator" ? evt.author || "operator" : actorKind,
    repo: evt.repo,
    taskId,
    pr: String(evt.prNumber),
    payload: { branch: evt.branch, title: evt.title, author: evt.author, headSha: evt.headSha, actorKind, sparse },
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
  } catch {
    try {
      await repo.enqueueReconcile("verify", input as unknown as Record<string, unknown>);
    } catch {
      // best-effort: even if the queue write fails we still hold (never pass).
    }
    return { verdict: "pending", reasons: ["MC unavailable — held for reconciliation (fail-closed)"], queued: true };
  }
}

export async function ingestOrQueue(evt: PrEvent): Promise<IngestResult | { ingested: false; queued: true }> {
  try {
    return await ingestPullRequest(evt);
  } catch {
    try {
      await repo.enqueueReconcile("ingest", evt as unknown as Record<string, unknown>);
    } catch {
      // best-effort
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
