// EN-007 P1b — the compliance server service. Orchestrates the dispatch ledger,
// the pure verifier (verify.ts), and the event log (repo.ts); the
// /api/compliance/* routes are thin wrappers over these. DB access is via ./repo
// (mocked in tests/compliance-server.test.ts). Bucket PRD is resolved from the
// persisted buckets table (bucket-prd.ts).

import { randomBytes } from "node:crypto";
import { ApiError } from "@/lib/api/route";
import { permissionsEnforcementEnabled } from "@/lib/auth";
import type { Task } from "@/lib/mc-data";
import { publicMcBaseUrl } from "@/lib/mcp/envelope";
import {
  authorize,
  findServicePrincipalById,
  GITHUB_ACTIONS_ROUTING_SERVICE_PRINCIPAL_ID,
  type PermissionActor,
} from "@/lib/permissions";
import { normalizeRoutingEvidence } from "@/lib/routing/evidence";
import {
  runShadowRouting,
  type RoutingBucketView,
  type RoutingTaskView,
} from "@/lib/routing/engine";
import { ROUTING_POLICY_VERSION } from "@/lib/routing/persistence";
import {
  upsertProposalRevision,
  upsertRoutingProposal,
  upsertRoutingSession,
} from "@/lib/routing/repo";
import { snapshot } from "@/lib/sync";
import { getEntity, getRegisterInboundCompletions } from "@/lib/sync/repo";
import trackedReposRegistry from "../../../config/tracked-repos-registry.json";
import { bucketPrdForTask } from "./bucket-prd";
import type { EventsQuery } from "./events";
import { projectPullRequest, projectionEnabled } from "./projection";
import * as repo from "./repo";
import { classifyRiskTier } from "./risk";
import {
  routingProposalsEnabled,
  type ActorKind,
  type RiskTier,
  type VerifyResult,
} from "./types";
import { verifyCompliance } from "./verify";
import type { PrEvent } from "./webhook";

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

  // Operator PR: one verdict, recorded ungated (decision 5).
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
    const bucketPrd = await bucketPrdForTask(task);
    const result = verifyCompliance({ task, actor: "agent", tier, bucketPrd });
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
  proposalId?: string | null;
  deepLink?: string | null;
}

const HANDLED_ACTIONS = new Set(["opened", "reopened", "synchronize", "closed"]);
const IDLE_TTL_MS = 24 * 60 * 60 * 1000;
const ABSOLUTE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface ProposeRoutingInput {
  /** Full owner/repo. */
  repository: string;
  repositoryId: string | number;
  prNumber: number;
  action: string;
  headSha: string;
  mergeSha?: string | null;
  baseBranch?: string;
  sourceBranch?: string;
  title?: string;
  /** In-memory only — never persisted. */
  body?: string;
  labels?: string[];
  changedPaths?: string[];
  author?: string;
  actorKind?: ActorKind;
  /** Durable GitHub Actions run id for replay binding (optional). */
  runId?: string | null;
  eventSource?: "oidc.propose" | "hmac.webhook";
}

export interface ProposeRoutingResult {
  proposalId: string;
  revisionId: string;
  state: "action_required" | "resolved" | "degraded";
  deepLink: string;
  sessionId: string | null;
  candidates: Array<{ taskId: string; matchScore: number; reasons: string[] }>;
  bodyContentHash: string;
  policyVersion: string;
}

function proposalDeepLink(proposalId: string): string {
  return `${publicMcBaseUrl()}/routing?proposal=${encodeURIComponent(proposalId)}`;
}

function stableProposalId(repoId: string, changeId: string): string {
  const safe = `${repoId}:${changeId}`.replace(/[^A-Za-z0-9._:-]/g, "_");
  return `rpp_${safe}`;
}

function mintRevisionId(): string {
  return `rpr_${randomBytes(10).toString("hex")}`;
}

function toTaskViews(tasks: Awaited<ReturnType<typeof snapshot>>["tasks"]): RoutingTaskView[] {
  return tasks.map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    bucket: t.bucket,
    stage: t.stage,
    repos: t.repos ?? [],
    labels: t.labels ?? [],
    prs: t.prs,
    due: t.due,
  }));
}

function toBucketViews(
  buckets: Awaited<ReturnType<typeof snapshot>>["buckets"]
): RoutingBucketView[] {
  return buckets.map((b) => ({
    id: b.id,
    repos: b.repos ?? [],
    project: b.project ?? null,
  }));
}

/**
 * Resolve + authorize the durable GitHub Actions routing service principal for
 * routing.propose. Callers must have already authenticated (OIDC or optional HMAC).
 */
export async function requireGithubActionsProposeAuthorized(
  repositoryId: string
): Promise<PermissionActor> {
  let status: "active" | "revoked" = "active";
  if (permissionsEnforcementEnabled()) {
    const persisted = await findServicePrincipalById(
      GITHUB_ACTIONS_ROUTING_SERVICE_PRINCIPAL_ID
    );
    if (!persisted) {
      throw new ApiError(
        "forbidden",
        "Durable sp_github_actions_routing service principal is missing.",
        403
      );
    }
    status = persisted.status;
  }
  const actor: PermissionActor = {
    kind: "service",
    id: GITHUB_ACTIONS_ROUTING_SERVICE_PRINCIPAL_ID,
    status,
  };
  const decision = authorize({
    actor,
    capability: "routing.propose",
    resource: { type: "routing", id: repositoryId },
    context: { repositoryId },
  });
  if (!decision.allowed) {
    throw new ApiError(
      "forbidden",
      `routing.propose denied (${decision.reasonCode}).`,
      403
    );
  }
  return actor;
}

/**
 * Authoritative proposal upsert for PR opened/reopened/synchronize/closed.
 * Processes PR body only in memory (markers + hash). Replay-safe on
 * (proposalId, headSha) revisions. Never persists raw body text.
 */
export async function proposeRoutingFromPr(
  input: ProposeRoutingInput
): Promise<ProposeRoutingResult> {
  if (!routingProposalsEnabled()) {
    throw new ApiError(
      "routing_proposals_disabled",
      "Routing proposals are disabled (PLX_MC_ROUTING_PROPOSALS_ENABLED=0); sparse Task creation stays retired.",
      503
    );
  }

  const repoId = input.repository.trim();
  const changeId = String(input.prNumber);
  await requireGithubActionsProposeAuthorized(repoId);

  const body = typeof input.body === "string" ? input.body : "";
  const normalized = normalizeRoutingEvidence({
    repoId: String(input.repositoryId),
    repoFullName: repoId,
    changeId,
    headSha: input.headSha,
    baseBranch: input.baseBranch ?? "main",
    sourceBranch: input.sourceBranch,
    branch: input.sourceBranch,
    title: input.title,
    body,
    changedPaths: input.changedPaths,
    labels: input.labels,
    actorId: GITHUB_ACTIONS_ROUTING_SERVICE_PRINCIPAL_ID,
    actorKind: "service",
    eventSource: input.eventSource ?? "oidc.propose",
    eventAction: input.action,
    eventAt: new Date().toISOString(),
  });

  // Body stays local — only hash/markers go to persistence.
  const markers = normalized.markers;
  const sessionFromMarker = markers.routingSessionIds[0] ?? null;
  let sessionId = sessionFromMarker;

  if (sessionId?.startsWith("rtx_")) {
    const now = Date.now();
    try {
      await upsertRoutingSession({
        id: sessionId,
        repoId,
        actorId: GITHUB_ACTIONS_ROUTING_SERVICE_PRINCIPAL_ID,
        actorKind: "service",
        baseBranch: normalized.evidence.baseBranch ?? "main",
        sourceBranch:
          normalized.evidence.sourceBranch ?? normalized.evidence.branch ?? "HEAD",
        headSha: input.headSha,
        status: "active",
        absoluteExpiresAt: new Date(now + ABSOLUTE_TTL_MS).toISOString(),
        idleExpiresAt: new Date(now + IDLE_TTL_MS).toISOString(),
      });
    } catch {
      // Session reconcile is best-effort; proposal still proceeds.
      sessionId = sessionFromMarker;
    }
  }

  let candidates: ProposeRoutingResult["candidates"] = [];
  let revisionCandidates: import("@/lib/routing/types").RoutingCandidateRecord[] = [];
  let derivedProjectId: string | null = null;
  let failureReason: import("@/lib/routing/types").RoutingFailureReason = null;
  let state: ProposeRoutingResult["state"] = "action_required";

  try {
    const snap = await snapshot();
    const trackedRepos = (
      (trackedReposRegistry as { repos?: Array<Record<string, unknown>> }).repos ?? []
    ).map((entry) => ({
      repo: String(entry.repo ?? ""),
      status: typeof entry.status === "string" ? entry.status : undefined,
      default_bucket:
        typeof entry.default_bucket === "string" ? entry.default_bucket : undefined,
      tier: typeof entry.tier === "string" ? entry.tier : undefined,
    }));
    const operationalRepos = Object.fromEntries(
      snap.repos.map((r) => [r.id, { id: r.id, name: r.name }])
    );
    const shadow = await runShadowRouting({
      evidence: normalized.evidence,
      markers,
      branchTaskIds: normalized.branchTaskIds,
      tasks: toTaskViews(snap.tasks),
      buckets: toBucketViews(snap.buckets),
      trackedRepos,
      operationalRepos,
      loadRegisterTimestamps: () => getRegisterInboundCompletions(),
    });
    revisionCandidates = shadow.candidates.slice(0, 3);
    candidates = revisionCandidates.map((c) => ({
      taskId: c.taskId,
      matchScore: c.matchScore,
      reasons: c.reasons,
    }));
    derivedProjectId = shadow.derivedProjectId;
    failureReason = shadow.failureReason;
    if (!shadow.ok && shadow.failureReason) {
      state = "degraded";
    }
  } catch {
    state = "degraded";
    failureReason = "unknown";
  }

  // Agent hard-gate is unchanged: credentialed checkouts still project Tasks.
  // Operator proposals stay non-blocking action_required.
  if (input.actorKind === "agent") {
    state = state === "degraded" ? "degraded" : "action_required";
  }

  const proposalId = stableProposalId(repoId, changeId);
  const proposal = await upsertRoutingProposal({
    id: proposalId,
    repoId,
    changeId,
    sessionId,
    state,
    title: normalized.evidence.title ?? null,
    bodyContentHash: markers.bodyContentHash,
    markers: markers.markers,
    derivedProjectId,
    failureReason,
  });

  const revision = await upsertProposalRevision({
    id: mintRevisionId(),
    proposalId: proposal.id,
    headSha: input.headSha,
    policyVersion: ROUTING_POLICY_VERSION,
    evidenceMeta: {
      ...normalized.evidence,
    },
    candidates: revisionCandidates,
  });

  const deepLink = proposalDeepLink(proposal.id);
  await repo.appendEvent({
    kind: "routing.proposal.upserted",
    actor: GITHUB_ACTIONS_ROUTING_SERVICE_PRINCIPAL_ID,
    repo: repoId,
    pr: changeId,
    payload: {
      proposalId: proposal.id,
      revisionId: revision.id,
      state,
      headSha: input.headSha,
      bodyContentHash: markers.bodyContentHash,
      deepLink,
      runId: input.runId ?? null,
      eventSource: input.eventSource ?? "oidc.propose",
      action: input.action,
    },
    dedupKey: `routing.proposal:${proposal.id}:${input.headSha}:${input.action}`,
  });

  return {
    proposalId: proposal.id,
    revisionId: revision.id,
    state,
    deepLink,
    sessionId,
    candidates,
    bodyContentHash: markers.bodyContentHash,
    policyVersion: ROUTING_POLICY_VERSION,
  };
}

// Maintain the system-of-record from the PR lifecycle. Appends typed events to
// mc_events, then projects task state via projectPullRequest (P1).
// Operator PRs without checkout no longer create sparse Tasks — optional
// HMAC compatibility may call proposeRoutingFromPr when separately configured.

export async function ingestPullRequest(evt: PrEvent): Promise<IngestResult> {
  let actorKind: ActorKind = "operator";
  let taskId: string | null = null;
  let actorIdentity = evt.author || "operator";
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

  if (!HANDLED_ACTIONS.has(evt.action)) {
    return { action: evt.action, actorKind, taskId, recorded: false };
  }
  const idBase = `${evt.repo}:${evt.prNumber}:${evt.headSha}:${evt.action}`;
  const needsProposal = actorKind === "operator" && taskIds.length === 0;
  let proposalId: string | null = null;
  let deepLink: string | null = null;

  // Optional HMAC → same proposal service (compatibility; not a phase-one prerequisite).
  const hmacPropose =
    (process.env.PLX_MC_ROUTING_HMAC_PROPOSE ?? "0").trim() === "1" &&
    needsProposal &&
    routingProposalsEnabled();

  if (evt.action === "closed") {
    if (evt.merged) {
      await repo.appendEvent({
        kind: "pr.merged", actor: actorIdentity, repo: evt.repo, taskId, pr: String(evt.prNumber),
        payload: { actorKind, sha: evt.headSha, branch: evt.branch, title: evt.title, taskIds },
        dedupKey: `pr.merged:${evt.repo}:${evt.prNumber}:${evt.headSha}`,
      });
      const promote = taskIds.length > 0 ? taskIds : [null];
      for (const tid of promote) {
        await repo.appendEvent({
          kind: "task.promotion.requested", actor: actorIdentity, repo: evt.repo, taskId: tid, pr: String(evt.prNumber),
          payload: { actorKind, sha: evt.headSha },
          dedupKey: `task.promotion.requested:${evt.repo}:${evt.prNumber}:${evt.headSha}:${tid ?? "none"}`,
        });
      }
    } else {
      await repo.appendEvent({
        kind: "pr.closed", actor: actorIdentity, repo: evt.repo, taskId, pr: String(evt.prNumber),
        payload: { actorKind, sha: evt.headSha, branch: evt.branch, title: evt.title },
        dedupKey: `pr.closed:${idBase}`,
      });
    }
    if (hmacPropose) {
      try {
        const proposed = await proposeRoutingFromPr({
          repository: evt.repoFullName || evt.repo,
          repositoryId: evt.repositoryId ?? evt.repo,
          prNumber: evt.prNumber,
          action: evt.action,
          headSha: evt.headSha,
          mergeSha: evt.mergeSha,
          baseBranch: evt.baseBranch,
          sourceBranch: evt.branch,
          title: evt.title,
          body: evt.body ?? "",
          labels: evt.labels,
          changedPaths: evt.changedPaths ?? [],
          author: evt.author,
          actorKind,
          eventSource: "hmac.webhook",
        });
        proposalId = proposed.proposalId;
        deepLink = proposed.deepLink;
      } catch (err) {
        console.error("[compliance] optional HMAC propose failed:", err);
      }
    } else if (needsProposal) {
      await repo.appendEvent({
        kind: "routing.proposal.triage",
        actor: actorIdentity,
        repo: evt.repo,
        pr: String(evt.prNumber),
        payload: {
          reason: "operator_pr_unrouted",
          note: "Sparse Task creation retired; use OIDC /api/routing/propose or enable PLX_MC_ROUTING_HMAC_PROPOSE=1",
        },
        dedupKey: `routing.triage:${evt.repo}:${evt.prNumber}:${evt.headSha}:${evt.action}`,
      });
    }
    if (projectionEnabled()) {
      await projectPullRequest(evt, {
        actorKind,
        actorIdentity,
        taskIds,
        sparse: needsProposal,
      });
    }
    return { action: evt.action, actorKind, taskId, recorded: true, proposalId, deepLink };
  }

  const kind = evt.action === "synchronize" ? "pr.synchronized" : "pr.opened";
  await repo.appendEvent({
    kind,
    actor: actorIdentity,
    repo: evt.repo,
    taskId,
    pr: String(evt.prNumber),
    payload: {
      actorKind,
      branch: evt.branch,
      title: evt.title,
      author: evt.author,
      headSha: evt.headSha,
      // sparse flag retained as "unrouted operator" signal — no Task is created.
      sparse: needsProposal,
      actionRequired: needsProposal,
      taskIds,
    },
    dedupKey: `${kind}:${idBase}`,
  });

  if (hmacPropose) {
    try {
      const proposed = await proposeRoutingFromPr({
        repository: evt.repoFullName || evt.repo,
        repositoryId: evt.repositoryId ?? evt.repo,
        prNumber: evt.prNumber,
        action: evt.action,
        headSha: evt.headSha,
        mergeSha: evt.mergeSha,
        baseBranch: evt.baseBranch,
        sourceBranch: evt.branch,
        title: evt.title,
        body: evt.body ?? "",
        labels: evt.labels,
        changedPaths: evt.changedPaths ?? [],
        author: evt.author,
        actorKind,
        eventSource: "hmac.webhook",
      });
      proposalId = proposed.proposalId;
      deepLink = proposed.deepLink;
    } catch (err) {
      console.error("[compliance] optional HMAC propose failed:", err);
    }
  } else if (needsProposal) {
    await repo.appendEvent({
      kind: "routing.proposal.triage",
      actor: actorIdentity,
      repo: evt.repo,
      pr: String(evt.prNumber),
      payload: {
        reason: "operator_pr_unrouted",
        note: "Sparse Task creation retired; use OIDC /api/routing/propose or enable PLX_MC_ROUTING_HMAC_PROPOSE=1",
      },
      dedupKey: `routing.triage:${evt.repo}:${evt.prNumber}:${evt.headSha}:${evt.action}`,
    });
  }

  if (projectionEnabled()) {
    await projectPullRequest(evt, {
      actorKind,
      actorIdentity,
      taskIds,
      sparse: needsProposal,
    });
  }
  return { action: evt.action, actorKind, taskId, recorded: true, proposalId, deepLink };
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
