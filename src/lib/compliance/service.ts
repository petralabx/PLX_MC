// EN-007 P1b — the compliance server service. Orchestrates the dispatch ledger,
// the pure verifier (verify.ts), and the event log (repo.ts); the
// /api/compliance/* routes are thin wrappers over these. DB access is via ./repo
// (mocked in tests/compliance-server.test.ts). Bucket PRD is resolved from the
// persisted buckets table (bucket-prd.ts).

import { randomBytes } from "node:crypto";
import { ApiError } from "@/lib/api/route";
import { permissionsEnforcementEnabled } from "@/lib/auth";
import { creatorApprovalPending, humanEmailFor, resolveHumanAccountableOwner, resolveRepoInput, type Task } from "@/lib/mc-data";
import { publicMcBaseUrl } from "@/lib/mcp/envelope";
import {
  GITHUB_ACTIONS_ROUTING_SERVICE_PRINCIPAL_ID,
  type PermissionActor,
} from "@/lib/permissions";
import {
  authorizeStaged,
  recordUnresolvedActorDenial,
  resolveStagedServicePrincipal,
} from "@/lib/permissions/enforcement";
import { normalizeRoutingEvidence } from "@/lib/routing/evidence";
import {
  runShadowRouting,
  type RoutingBucketView,
  type RoutingTaskView,
} from "@/lib/routing/engine";
import { ROUTING_POLICY_VERSION } from "@/lib/routing/persistence";
import {
  metadataEnabled,
  resolveRepoCohortRuntimeState,
  type RolloutMode,
} from "@/lib/routing/rollout";
import {
  upsertProposalRevision,
  upsertRoutingProposal,
  upsertRoutingSession,
} from "@/lib/routing/repo";
import type { RoutingProposalState } from "@/lib/routing/types";
import { canAccessTask } from "@/lib/permissions/project-acl";
import { isBucketInRestrictedProject, loadProjectAclMaps } from "@/lib/permissions/project-acl-guard";
import { evidenceStoreEnabled } from "@/lib/secrets";
import { patchTask, snapshot } from "@/lib/sync";
import { getEntity, getRegisterInboundCompletions, getRepos } from "@/lib/sync/repo";
import trackedReposRegistry from "../../../config/tracked-repos-registry.json";
import { approvalPathClasses, pathApprovalMode } from "./approval-paths";
import { approvalDeciderAllowlist, checkApproval } from "./approval-signature";
import { bucketPrdForTask } from "./bucket-prd";
import { assertCreatorApprovedForCheckout } from "./creator-approval";
import { ownEvidenceSite } from "./evidence-artifacts";
import type { EventsQuery } from "./events";
import {
  boundPr,
  chainVerdict,
  FULL_SHA_RE,
  isLauncherPrincipal,
  LAUNCH_ID_RE,
  leaseChainEnforced,
  namesLaunchLane,
  webhookExtendsChain,
} from "./lease-chain";
import { agentSignals, commitTrailers, shortSha } from "./commit-signals";
import { githubHeadDescendsFrom, loadPrCommits, loadPrReviewLinks, loadPrState, type PrCommit, type PrState } from "./github-pr";
import { projectPullRequest, projectionEnabled, samePr } from "./projection";
import * as repo from "./repo";
import { applyReviewLinks, reviewLinksReport, touchedModules, type ReviewLinksReport } from "./review-links";
import { classifyRiskTier } from "./risk";
import {
  PR_TASK_LINK_EVENT,
  routingProposalsEnabled,
  type ActorKind,
  type RiskTier,
  type VerifyResult,
} from "./types";
import { verifyCompliance } from "./verify";
import { resolvePrTask, type PrEvent, type PrTaskResolution } from "./webhook";

// Decision 14, amended TASK-2011 (Vince, 2026-09-27): the 8h TTL applies
// unless the live open PR still carries the stamp. Merge/close releases it.
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
// Gate/event repo names are display keys; binding requires owner/name on both
// sides. The flag selects the full-identity field, never a bare-name fallback.
function fullRepoBindingEnabled(): boolean {
  return (
    process.env.PLX_MC_COMPLIANCE_FULL_REPO_BINDING_ENABLED ?? "1"
  ).trim() !== "0";
}

export function dispatchRepoMatches(
  dispatchRepo: string,
  repoName: string,
  repoFullName?: string
): boolean {
  const callerRepo = fullRepoBindingEnabled() ? repoFullName ?? repoName : repoName;
  const fullSlug = /^[^/\s]+\/[^/\s]+$/;
  return (
    fullSlug.test(dispatchRepo) && fullSlug.test(callerRepo) &&
    dispatchRepo.toLowerCase() === callerRepo.toLowerCase()
  );
}

type CheckoutBlockReason =
  | "unknown_checkout"
  | "revoked"
  | "released"
  | "repo_mismatch"
  | "expired"
  | "pr_not_open"
  | "stamp_not_in_pr"
  | "task_closed"
  | "task_deleted"
  | "unstamped_agent_commits";

// The gate log is what a blocked author reads. Name the cause and the next step.
const CHECKOUT_BLOCK_TEXT: Record<CheckoutBlockReason, string> = {
  unknown_checkout: "unknown checkout — re-checkout the task",
  revoked: "checkout revoked — re-checkout the task",
  released: "checkout released — re-checkout the task",
  repo_mismatch: "checkout requires matching full owner/name identities; bare names are rejected",
  expired: "checkout expired — re-checkout",
  pr_not_open: "pull request is not open",
  stamp_not_in_pr: "checkout stamp is not in the pull request body",
  task_closed: "task is already verified",
  task_deleted: "task deleted — re-register",
  unstamped_agent_commits:
    "agent commits but no MC-Checkout stamp in the pull request body — check out the task and add its MC-Checkout line to the PR body",
};

function checkoutBlockReason(reason: CheckoutBlockReason): string {
  return CHECKOUT_BLOCK_TEXT[reason];
}

type DispatchResolution = { dispatch: repo.DispatchRow; reason?: never } | {
  dispatch: null;
  reason: CheckoutBlockReason;
};

async function resolveDispatch(
  checkoutId: string,
  repoName: string,
  repoFullName?: string
): Promise<DispatchResolution> {
  const d = await repo.getDispatch(checkoutId);
  if (!d) return { dispatch: null, reason: "unknown_checkout" };
  if (d.revoked) return { dispatch: null, reason: "revoked" };
  if (d.releasedAt) return { dispatch: null, reason: "released" };
  if (!dispatchRepoMatches(d.repo, repoName, repoFullName)) return { dispatch: null, reason: "repo_mismatch" };
  if (!(new Date(d.expiresAt).getTime() > Date.now())) return { dispatch: null, reason: "expired" };
  return { dispatch: d };
}

type PrIdentity = Pick<VerifyPrInput, "repo" | "repoFullName" | "prNumber">;

async function resolveDispatchForOpenPr(
  checkoutId: string,
  input: PrIdentity,
  prState: PrState
): Promise<DispatchResolution> {
  // Re-read after the GitHub request so revocation/release during it still wins.
  const d = await repo.getDispatch(checkoutId);
  if (!d) return { dispatch: null, reason: "unknown_checkout" };
  if (d.revoked) return { dispatch: null, reason: "revoked" };
  if (d.releasedAt) return { dispatch: null, reason: "released" };
  if (!dispatchRepoMatches(d.repo, input.repo, input.repoFullName)) return { dispatch: null, reason: "repo_mismatch" };
  if (!prState.open) return { dispatch: null, reason: "pr_not_open" };
  if (!prState.checkoutIds.includes(checkoutId)) return { dispatch: null, reason: "stamp_not_in_pr" };
  const task = await loadTask(d.taskId);
  if (!task) return { dispatch: null, reason: "task_deleted" };
  if (task.stage === "verified") return { dispatch: null, reason: "task_closed" };
  return { dispatch: d };
}

/**
 * The open PR that keeps an expired checkout valid, or null. Same proof as
 * resolveDispatchForOpenPr: the live PR is open and its body carries the
 * stamp. Candidates come from the task's PR events in the checkout's repo.
 * GitHub errors propagate, so a caller can fail closed. exceptPr skips the PR
 * being merged or closed, so it is never read.
 */
export async function openPrHoldingCheckout(
  d: Pick<repo.DispatchRow, "id" | "taskId" | "repo">,
  exceptPr?: number
): Promise<number | null> {
  for (const prNumber of await repo.openPrCandidatesForTask(d.taskId, d.repo)) {
    if (prNumber === exceptPr) continue;
    const state = await loadPrState(d.repo, prNumber);
    if (state.open && state.checkoutIds.includes(d.id)) return prNumber;
  }
  return null;
}

// A PR that references a cancelled task is not blocked, but it must not read as
// delivery: the projection skips promotion and the check says so (TASK-2529).
function cancelledTaskWarning(task: Task): string {
  const c = task.cancellation;
  const why = c ? ` (${c.reason}${c.replacedBy ? ` → ${c.replacedBy}` : ""})` : "";
  return `warning: ${task.id} is cancelled${why} — this PR will not promote it; reopen the task or retarget the PR`;
}

// One lazy GitHub read per PR, and only if a checkout failed solely on expiry.
function prDispatchResolver(input: PrIdentity) {
  let state: Promise<PrState> | undefined;
  return async (checkoutId: string): Promise<DispatchResolution> => {
    const resolved = await resolveDispatch(checkoutId, input.repo, input.repoFullName);
    if (resolved.reason !== "expired") return resolved;
    const d = await repo.getDispatch(checkoutId);
    const fullName = input.repoFullName?.includes("/") ? input.repoFullName : d?.repo ?? input.repo;
    state ??= loadPrState(fullName, input.prNumber);
    return resolveDispatchForOpenPr(checkoutId, input, await state);
  };
}

// One gate verdict event per (repo, pr, head, subject, verdict) — shared by the
// gate writer and the merge-attribution reader so the two keys cannot drift.
function gateDedupKey(repoName: string, prNumber: number, headSha: string, subjectId: string | null, verdict: string): string {
  return `gate:${repoName}:${prNumber}:${headSha}:${subjectId ?? "none"}:${verdict}`;
}

// TASK-3813: the PR whose merge or close released this checkout of this repo,
// when that is another PR; null for a revoked or manual release, another repo,
// or the PR under check. Read-only.
async function releasingOtherPr(d: repo.DispatchRow, input: PrIdentity): Promise<number | null> {
  if (d.revoked || (d.releasedReason !== "merged" && d.releasedReason !== "closed")) return null;
  if (!dispatchRepoMatches(d.repo, input.repo, input.repoFullName)) return null;
  const releasedBy = await repo.releasingPrForDispatch(d.id);
  return releasedBy !== null && releasedBy !== input.prNumber ? releasedBy : null;
}

// Frontier P16: the merge queue re-runs the gate on the head that already
// passed, so merge_group never reads GitHub. It applies resolveDispatch as is;
// on expiry, or on a release by another PR's merge or close (TASK-3813), it
// accepts the stamp when the gate passed this exact head for its task (the
// resolveDispatchForMerge rule), and blocks as expired or released otherwise.
function queueDispatchResolver(input: Pick<VerifyPrInput, "repo" | "repoFullName" | "prNumber" | "headSha">) {
  return async (checkoutId: string): Promise<DispatchResolution> => {
    const resolved = await resolveDispatch(checkoutId, input.repo, input.repoFullName);
    if (resolved.reason !== "expired" && resolved.reason !== "released") return resolved;
    // Re-read so a revoke or release after resolveDispatch still wins.
    const d = await repo.getDispatch(checkoutId);
    if (!d) return { dispatch: null, reason: "unknown_checkout" };
    if (d.revoked) return { dispatch: null, reason: "revoked" };
    if (d.releasedAt && (await releasingOtherPr(d, input)) === null) return { dispatch: null, reason: "released" };
    const passedTaskId = await repo.eventTaskIdByDedupKey(
      gateDedupKey(input.repo, input.prNumber, input.headSha, d.taskId, "pass")
    );
    if (passedTaskId === d.taskId) return { dispatch: d };
    return { dispatch: null, reason: d.releasedAt ? "released" : "expired" };
  };
}

// Merge attribution, not gating: a PR that passed and merged after expiry is still that
// task's work. Accept an expired credential only when it is unrevoked, bound to
// this repo, and the gate passed this exact head for its task.
async function resolveDispatchForMerge(
  checkoutId: string,
  evt: PrEvent
): Promise<repo.DispatchRow | null> {
  const d = await repo.getDispatch(checkoutId);
  if (!d || d.revoked || !dispatchRepoMatches(d.repo, evt.repo, evt.repoFullName)) return null;
  if (new Date(d.expiresAt).getTime() > Date.now()) return d;
  const passedTaskId = await repo.eventTaskIdByDedupKey(
    gateDedupKey(evt.repo, evt.prNumber, evt.headSha, d.taskId, "pass")
  );
  return passedTaskId === d.taskId ? d : null;
}

// ─── Checkout (the handshake, decision 3) ────────────────────────────────────

/** Which HTTP door invoked the shared checkout() core (audit provenance). */
export type CheckoutDoor = "mcp" | "compliance";

export interface CheckoutInput {
  taskId: string;
  runtime: string;
  accountableHuman: string;
  repo: string;
  /** Durable permission actor — never taken from a caller-supplied body field. */
  actor?: PermissionActor;
  /** Door that called this core — recorded on the checkout audit event. */
  door?: CheckoutDoor;
  /**
   * The caller's `<runtime>/<lane>` (TASK-3336), recorded on the checkout event.
   * The gate holds each commit's Agent trailer to it. Omitted = not recorded.
   */
  agent?: string;
  /**
   * TASK-3409: hand back the caller's own live checkout of this task and repo
   * (same runtime and operator) instead of minting a second one.
   */
  reuse?: boolean;
  /**
   * TASK-3409: why the caller takes over a task another holder has a live
   * checkout of. Logged on the checkout.concurrent event; required only while
   * PLX_MC_CHECKOUT_TAKEOVER_ENFORCE=1.
   */
  forceReason?: string;
  /** TASK-3410: the full commit SHA the work starts from; the root of the checkout's SHA chain. */
  baseSha?: string;
  /**
   * TASK-3410: the launcher's launch record id. Only a principal listed in
   * PLX_MC_LAUNCHER_PRINCIPALS may attach one; it puts the checkout under the
   * lease-chain rules.
   */
  launchId?: string;
}

export interface CheckoutResult {
  checkoutId: string;
  /** The person commits name in On-Behalf-Of (TASK-3483). */
  accountablePerson: string;
  /** True when `reuse` returned an existing live checkout (TASK-3409). */
  reused?: boolean;
  /** Other holders' live checkouts of the same task (TASK-3409), redacted. */
  concurrent?: { checkoutRef: string; runtime: string; accountableHuman: string }[];
}

/** Refuse a second holder without forceReason (TASK-3409). Off by default: warn first. */
function checkoutTakeoverEnforced(): boolean {
  return (process.env.PLX_MC_CHECKOUT_TAKEOVER_ENFORCE ?? "").trim() === "1";
}

const redactCheckout = (id: string): string => `dsp_…${id.slice(-4)}`;
const holderKey = (d: { runtime: string; accountableHuman: string }): string =>
  `${d.runtime.trim().toLowerCase()}|${d.accountableHuman.trim().toLowerCase()}`;

export async function checkout(input: CheckoutInput): Promise<CheckoutResult> {
  if (input.actor) {
    const decision = authorizeStaged({
      site: "compliance.checkout",
      capability: "task.checkout",
      resource: { type: "task", id: input.taskId },
      context: { repositoryId: input.repo },
      appliedActor: input.actor,
    });
    if (!decision.allowed) {
      throw new ApiError(
        "forbidden",
        `task.checkout denied (${decision.reasonCode}).`,
        403
      );
    }
  } else if (permissionsEnforcementEnabled()) {
    recordUnresolvedActorDenial({
      site: "compliance.checkout",
      capability: "task.checkout",
      actorKind: "service",
      actorId: input.runtime || "missing-actor",
      resource: { type: "task", id: input.taskId },
    });
    throw new ApiError(
      "forbidden",
      "task.checkout requires a durable authorized actor.",
      403
    );
  }

  const baseSha = input.baseSha?.trim().toLowerCase() || null;
  if (baseSha && !FULL_SHA_RE.test(baseSha)) {
    throw new ApiError("invalid_request", "baseSha must be a full 40-character commit SHA.", 400);
  }
  const launchId = input.launchId?.trim() || null;
  if (launchId) {
    if (!LAUNCH_ID_RE.test(launchId)) {
      throw new ApiError("invalid_request", "launchId must be 1-128 characters of A-Z, a-z, 0-9, '.', '_', ':' or '-'.", 400);
    }
    if (!isLauncherPrincipal(input.actor?.id)) {
      throw new ApiError("not_a_launcher", "Only a launcher principal (PLX_MC_LAUNCHER_PRINCIPALS) may attach a launch record.", 403);
    }
  }

  const taskRow = await getEntity("task", input.taskId);
  const task = taskRow?.data as Task | undefined;
  if (task?.stage === "cancelled") {
    throw new ApiError(
      "task_cancelled",
      `Task ${input.taskId} is cancelled${task.cancellation ? ` (${task.cancellation.reason}${task.cancellation.replacedBy ? ` → ${task.cancellation.replacedBy}` : ""})` : ""}; it cannot be checked out. Reopen it first, or check out the replacement task.`,
      409
    );
  }
  // TASK-3530: a gated creator's task waits for creator approval. This covers
  // both checkout doors and every launch, which always takes a checkout.
  if (task) {
    await assertCreatorApprovedForCheckout(task, {
      actor: input.runtime,
      actorId: input.actor?.id ?? null,
      repo: input.repo,
      door: input.door ?? null,
    });
  }
  const backfilledOwner =
    task && !task.accountableOwner ? resolveHumanAccountableOwner(input.accountableHuman) : null;
  if (backfilledOwner) {
    await patchTask(
      input.taskId,
      { accountableOwner: backfilledOwner },
      input.accountableHuman,
      {
        attribution: {
          source: "service",
          actorId: input.actor?.id ?? input.runtime,
        },
      }
    );
  }

  const owner = backfilledOwner ?? task?.accountableOwner ?? null;
  const accountablePerson = checkoutAccountablePeople(input.accountableHuman, owner)[0];
  const live = await repo.liveDispatchesForTask(input.taskId, input.repo);
  const mine = holderKey(input);
  // A launch always mints its own lease (TASK-3410): reuse could hand back one without the launch record.
  if (input.reuse && !launchId && input.actor?.id) {
    let own: repo.DispatchRow | undefined;
    for (const d of live) {
      if (holderKey(d) !== mine || d.approvalGateId || d.launcherId !== input.actor.id) continue;
      const recordedAgent = await repo.getDispatchCheckoutAgent(d.id);
      if ((recordedAgent ?? null) !== (input.agent ?? null)) continue;
      own = d;
      break;
    }
    if (own) {
      await repo.appendEvent({
        kind: "checkout.reused",
        actor: input.runtime,
        repo: input.repo,
        taskId: input.taskId,
        payload: { checkoutId: own.id, permissionActorId: input.actor?.id ?? null, door: input.door ?? null },
      });
      return { checkoutId: own.id, accountablePerson, reused: true };
    }
  }
  // Another holder differs in runtime, operator, principal or recorded agent (the reuse check's identity).
  const others: repo.DispatchRow[] = [];
  for (const d of live) {
    if (
      holderKey(d) !== mine ||
      (d.launcherId ?? null) !== (input.actor?.id ?? null) ||
      ((await repo.getDispatchCheckoutAgent(d.id)) ?? null) !== (input.agent ?? null)
    ) {
      others.push(d);
    }
  }
  const forceReason = input.forceReason?.trim() || null;
  if (others.length > 0 && checkoutTakeoverEnforced() && !forceReason) {
    throw new ApiError(
      "checkout_held",
      `Task ${input.taskId} already has a live checkout in ${input.repo} held by ${others
        .map((d) => d.runtime)
        .join(", ")}. Pass forceReason to take it over, or reuse your own.`,
      409
    );
  }
  const concurrent = others.map((d) => ({
    checkoutRef: redactCheckout(d.id),
    runtime: d.runtime,
    accountableHuman: d.accountableHuman,
  }));

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
    launcherId: input.actor?.id ?? null,
    baseSha,
    launchId,
  });
  await repo.appendEvent({
    kind: "checkout",
    actor: input.runtime,
    repo: input.repo,
    taskId: input.taskId,
    payload: {
      checkoutId,
      accountableHuman: input.accountableHuman,
      actorKind: "agent",
      permissionActorId: input.actor?.id ?? null,
      door: input.door ?? null,
      agent: input.agent ?? null,
      baseSha,
      launchId,
    },
  });
  if (concurrent.length > 0) {
    await repo.appendEvent({
      kind: "checkout.concurrent",
      actor: input.runtime,
      repo: input.repo,
      taskId: input.taskId,
      payload: {
        checkoutId,
        heldBy: concurrent,
        forceReason,
        enforced: checkoutTakeoverEnforced(),
      },
    });
    return { checkoutId, accountablePerson, concurrent };
  }
  return { checkoutId, accountablePerson };
}

/**
 * Who a checkout acts for (TASK-3483, Vince 2026-10-20). A checkout records the
 * operator its MCP key was admitted under. When that operator is a person, it
 * is the only accountable person. When it is a shared service alias (cos@…),
 * the task's human accountable owner is the accountable person, and the alias
 * itself stays accepted so commits written to the old record do not start
 * failing. First entry = the person agents should name in On-Behalf-Of.
 */
export function checkoutAccountablePeople(
  recorded: string,
  taskOwner: string | null | undefined
): string[] {
  const operator = recorded.trim().toLowerCase();
  const person = humanEmailFor(operator);
  if (person) return [person];
  const owner = humanEmailFor(taskOwner);
  return owner && owner !== operator ? [owner, operator] : [operator];
}

// ─── Lease chain heads (TASK-3410) ───────────────────────────────────────────

export interface RecordCheckoutHeadInput {
  checkoutId: string;
  headSha: string;
  beforeSha?: string | null;
  prNumber?: number | null;
  /** The authenticated principal; must be the one that took the checkout. */
  principalId: string;
}

/**
 * The owning launcher records a head it pushed, so a history it rewrote on
 * purpose (rebase, force-push) stays on the checkout's chain. Only the principal
 * that took the checkout may record, and only while the checkout is unreleased.
 */
export async function recordCheckoutHead(input: RecordCheckoutHeadInput) {
  const d = await repo.getDispatch(input.checkoutId);
  if (!d) throw new ApiError("not_found", "unknown checkout.", 404);
  if (!d.launcherId || d.launcherId !== input.principalId) {
    throw new ApiError("not_checkout_launcher", "Only the principal that took this checkout may record its heads.", 403);
  }
  if (d.revoked || d.releasedAt) {
    throw new ApiError("checkout_inactive", "The checkout is revoked or released; re-checkout the task.", 409);
  }
  const headSha = input.headSha.trim().toLowerCase();
  const beforeSha = input.beforeSha?.trim().toLowerCase() || null;
  if (!FULL_SHA_RE.test(headSha) || (beforeSha && !FULL_SHA_RE.test(beforeSha))) {
    throw new ApiError("invalid_request", "headSha and beforeSha must be full 40-character commit SHAs.", 400);
  }
  const heads = await repo.dispatchHeads(d.id);
  const bound = boundPr(heads);
  if (input.prNumber && bound !== null && bound !== input.prNumber) {
    throw new ApiError("chain_bound", `This checkout's SHA chain is bound to PR #${bound}.`, 409);
  }
  const recorded = await repo.recordDispatchHead({
    dispatchId: d.id,
    headSha,
    beforeSha,
    pr: input.prNumber ?? null,
    source: "launcher",
    recordedBy: input.principalId,
  });
  if (!recorded && input.prNumber) {
    const boundTo = await repo.bindDispatchHeadPr({ dispatchId: d.id, headSha, pr: input.prNumber, recordedBy: input.principalId });
    if (boundTo !== null && boundTo !== input.prNumber) {
      throw new ApiError("chain_bound", `This head is bound to PR #${boundTo}.`, 409);
    }
    return { dispatch: d, recorded, chain: await repo.dispatchHeads(d.id) };
  }
  return { dispatch: d, recorded, chain: recorded ? await repo.dispatchHeads(d.id) : heads };
}

// ─── Complete (the done marker, mirrors VMC complete_task) ───────────────────

export interface CompleteInput {
  checkoutId: string;
  summary: string;
  commitSha?: string;
  prUrl?: string;
  outcome?: "completed" | "blocked" | "failed";
  actor?: PermissionActor;
}

/**
 * A checkout blocked on an approval gate cannot complete until a human approves it.
 * Rule for a rejected gate: the checkout stays blocked (it cannot complete); the agent
 * either raises a new gate on the same checkout (which re-points the block) or releases it.
 * A gate that cannot be found fails closed.
 */
async function assertCheckoutApprovalCleared(taskId: string, gateId: string): Promise<void> {
  const task = await loadTask(taskId);
  const gate = task?.approvalGates?.find((g) => g.id === gateId);
  if (gate?.status === "approved") return;
  const state = gate?.status ?? "missing";
  throw new ApiError(
    state === "rejected" ? "approval_rejected" : "approval_pending",
    `Checkout is blocked on approval gate ${gateId} (${state}); it cannot complete until a human approves the gate.`,
    409
  );
}

export async function complete(input: CompleteInput): Promise<{ ok: true }> {
  // Validate the credential strictly — a bogus/expired/revoked id must not append
  // an orphan task.completed to the canonical log (review S4).
  const d = await repo.getDispatch(input.checkoutId);
  if (!d || d.revoked || d.releasedAt || new Date(d.expiresAt).getTime() <= Date.now()) {
    throw new ApiError("invalid_checkout", "Unknown, revoked, released, or expired checkout.", 409);
  }

  if (input.actor) {
    const decision = authorizeStaged({
      site: "compliance.complete",
      capability: "task.complete",
      resource: { type: "task", id: d.taskId },
      context: { repositoryId: d.repo },
      appliedActor: input.actor,
    });
    if (!decision.allowed) {
      throw new ApiError(
        "forbidden",
        `task.complete denied (${decision.reasonCode}).`,
        403
      );
    }
  } else if (permissionsEnforcementEnabled()) {
    recordUnresolvedActorDenial({
      site: "compliance.complete",
      capability: "task.complete",
      actorKind: "service",
      actorId: d.runtime || "missing-actor",
      resource: { type: "task", id: d.taskId },
    });
    throw new ApiError(
      "forbidden",
      "task.complete requires a durable authorized actor.",
      403
    );
  }

  if (d.approvalGateId) await assertCheckoutApprovalCleared(d.taskId, d.approvalGateId);

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
      ...(input.outcome ? { outcome: input.outcome } : {}),
      permissionActorId: input.actor?.id ?? null,
    },
  });
  return { ok: true };
}

// ─── Verify (the gate, decisions 2, 9, 12) ───────────────────────────────────

export interface VerifyPrInput {
  repo: string;
  /** Full owner/repo when available; preferred for checkout binding. */
  repoFullName?: string;
  prNumber: number;
  headSha: string;
  changedPaths: string[];
  labels?: string[];
  checkoutId?: string | null; // single checkout (back-compat)
  checkoutIds?: string[] | null; // multi-task: one MC-Checkout per task on the PR
  /** Gate trigger (frontier P16). Missing means pull_request. */
  event?: "pull_request" | "merge_group";
}

// Per-task verdict for a multi-task PR (one entry per checked-out task).
export interface VerifyPrTaskResult {
  checkoutId: string;
  taskId: string | null;
  verdict: "pass" | "block";
  reasons: string[];
  /** TASK-3409: the checkout's state at this head. */
  checkout?: {
    live: boolean;
    expiresAt: string | null;
    releasedReason: string | null;
    /** Why the checkout does not resolve for this PR; null when it does. */
    blockReason: string | null;
  };
  /** TASK-3409: the task's approval gates, newest last (signed records arrive with TASK-3408). */
  approvals?: { gateId: string; status: string; decidedBy: string | null; decidedAt: string | null }[];
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
    dedupKey: gateDedupKey(input.repo, input.prNumber, input.headSha, subjectId, result.verdict),
  });
}

export interface VerifyPrOptions {
  /**
   * false = compute the verdict only (mc_verify_pr): no check-ledger row and no
   * gate.* event. The gate route always records. Default true.
   */
  record?: boolean;
}

// Review links (TASK-3168): read the PR body only when the PR touches a mapped
// module. The merge queue never reads GitHub (P16); the pull_request run checked
// this head. An unreadable body is advisory, so it never holds the gate.
async function reviewLinksForPr(input: VerifyPrInput): Promise<ReviewLinksReport | null> {
  if (input.event === "merge_group") return null;
  const repoFullName = input.repoFullName ?? input.repo;
  if (touchedModules(repoFullName, input.changedPaths).length === 0) return null;
  try {
    return reviewLinksReport(repoFullName, input.changedPaths, await loadPrReviewLinks(repoFullName, input.prNumber));
  } catch (err) {
    console.warn("[compliance] review links: PR body unreadable: %s", err instanceof Error ? err.message : "unknown error");
    return reviewLinksReport(repoFullName, input.changedPaths, null);
  }
}

// The runtime a Hub MCP checkout records when the caller sends no X-MC-Runtime
// header (src/lib/mcp/auth.ts). It does not say which agent took the checkout.
const DEFAULT_CHECKOUT_RUNTIME = "cursor";
const LISTED_COMMITS = 5;

interface AgentCommit {
  commit: PrCommit;
  signals: string[];
}

type CommitTrailerRow = ReturnType<typeof commitTrailers> & { sha: string };

// TASK-3336: the commits, not the PR author, say whether agent work is in a PR.
// The merge queue never reads GitHub (P16); the pull_request run checked this
// head. A GitHub error propagates, so the gate holds instead of passing.
async function prCommitsForVerify(input: VerifyPrInput): Promise<PrCommit[]> {
  if (input.event === "merge_group") return [];
  return loadPrCommits(input.repoFullName ?? input.repo, input.prNumber);
}

function agentCommitsOf(commits: PrCommit[]): AgentCommit[] {
  return commits.flatMap((commit) => {
    const signals = agentSignals(commit);
    return signals.length > 0 ? [{ commit, signals }] : [];
  });
}

function unstampedAgentCommitsReason(agentCommits: AgentCommit[]): string {
  const listed = agentCommits
    .slice(0, LISTED_COMMITS)
    .map(({ commit, signals }) => `${shortSha(commit.sha)} (${signals.join(", ")})`);
  const more = agentCommits.length > LISTED_COMMITS ? ` and ${agentCommits.length - LISTED_COMMITS} more` : "";
  return `${checkoutBlockReason("unstamped_agent_commits")}: ${listed.join("; ")}${more}`;
}

// Agent and On-Behalf-Of on the commits stamped with this checkout must match
// its record. The Agent check is strict when the checkout recorded its agent or
// a non-default runtime; a legacy default-runtime checkout only warns.
async function checkoutTrailerCheck(
  d: repo.DispatchRow,
  rows: CommitTrailerRow[],
  task: Pick<Task, "accountableOwner"> | null
): Promise<{ reasons: string[]; notes: string[] }> {
  const reasons: string[] = [];
  const notes: string[] = [];
  if (rows.length === 0) return { reasons, notes };
  const recorded = await repo.getDispatchCheckoutAgent(d.id);
  const runtime = d.runtime.trim().toLowerCase();
  const accountable = checkoutAccountablePeople(d.accountableHuman, task?.accountableOwner);
  for (const t of rows) {
    if (t.onBehalfOf && !accountable.includes(t.onBehalfOf.trim().toLowerCase())) {
      reasons.push(
        `commit ${t.sha}: On-Behalf-Of ${t.onBehalfOf} does not match the checkout's accountable person (${accountable.join(" or ")})`
      );
    }
    if (!t.agent) continue;
    const agent = t.agent.trim().toLowerCase();
    const agentRuntime = agent.split("/")[0];
    if (recorded) {
      if (agent !== recorded.trim().toLowerCase()) {
        reasons.push(`commit ${t.sha}: Agent ${t.agent} does not match the checkout's agent ${recorded}`);
      }
    } else if (runtime !== DEFAULT_CHECKOUT_RUNTIME) {
      if (agentRuntime !== runtime) {
        reasons.push(`commit ${t.sha}: Agent ${t.agent} does not match the checkout's runtime ${d.runtime}`);
      }
    } else if (agentRuntime !== DEFAULT_CHECKOUT_RUNTIME) {
      notes.push(
        `warning: commit ${t.sha}: Agent ${t.agent} not checked — the checkout records only the default runtime "${DEFAULT_CHECKOUT_RUNTIME}"; pass agent to mc_checkout_task`
      );
    }
  }
  return { reasons, notes };
}

// TASK-3410: the lease chain. A commit whose Agent trailer names a launcher lane
// needs a checkout with a launch record, and a launcher checkout's PR head must
// be on its recorded SHA chain. Both warn until PLX_MC_LEASE_CHAIN_ENFORCE=1. The
// merge queue re-runs the head the pull_request run checked, so it skips this.
async function leaseChainCheck(
  d: repo.DispatchRow,
  rows: CommitTrailerRow[],
  input: VerifyPrInput,
  record: boolean
): Promise<{ reasons: string[]; notes: string[] }> {
  const found: string[] = [];
  if (!d.launchId) {
    for (const t of rows) {
      if (namesLaunchLane(t.agent)) {
        found.push(`commit ${t.sha}: Agent ${t.agent} names a launcher lane, but its checkout has no launch record`);
      }
    }
  } else if (input.event !== "merge_group") {
    const heads = await repo.dispatchHeads(d.id);
    // Prove ancestry for the requested immutable head itself, the webhook's proof: a
    // delayed run or replay of an old head must not borrow the PR's current commits.
    // A failed compare proves nothing.
    const candidates =
      !FULL_SHA_RE.test(input.headSha) || heads.some((h) => h.headSha === input.headSha)
        ? []
        : heads.length ? heads.map((h) => h.headSha).reverse() : d.baseSha ? [d.baseSha] : [];
    let ancestor: string | null = null;
    for (const sha of candidates) {
      if (await githubHeadDescendsFrom(d.repo, sha, input.headSha).catch(() => false)) {
        ancestor = sha;
        break;
      }
    }
    const verdict = chainVerdict(d, heads, input, ancestor);
    if (!verdict.ok) found.push(verdict.reason);
    else if (record) {
      if (verdict.record && FULL_SHA_RE.test(input.headSha)) {
        await repo.recordDispatchHead({
          dispatchId: d.id,
          headSha: input.headSha,
          beforeSha: null,
          pr: input.prNumber,
          source: "gate",
          recordedBy: "compliance-gate",
        });
      }
      // Recheck the whole checkout under its row lock even for an existing head.
      // A different head may have bound to another PR after our initial read.
      const bound = await repo.bindDispatchHeadPr({ dispatchId: d.id, headSha: input.headSha, pr: input.prNumber, recordedBy: "compliance-gate" });
      if (bound === null) {
        found.push(`checkout dsp_…${d.id.slice(-4)}'s SHA chain could not bind the requested head`);
      } else if (bound !== input.prNumber) {
        found.push(`checkout dsp_…${d.id.slice(-4)}'s SHA chain is bound to PR #${bound}, not #${input.prNumber}`);
      }
    }
  }
  return leaseChainEnforced()
    ? { reasons: found, notes: [] }
    : { reasons: [], notes: found.map((r) => `warning: ${r} (PLX_MC_LEASE_CHAIN_ENFORCE is off)`) };
}

// TASK-3813: a checkout another PR's merge or close released (the PR below a
// stacked one) still covers this PR's commits that already carry its trailer: a
// re-checkout cannot match them, and history is not rewritten. Read-only: the
// release stands. Never for a PR with no such commit, nor where releasingOtherPr
// says no. The merge queue reads no commits; queueDispatchResolver handles it.
async function releasedStampForCommits(
  checkoutId: string,
  input: PrIdentity,
  stamped: CommitTrailerRow[]
): Promise<{ dispatch: repo.DispatchRow; note: string } | null> {
  if (stamped.length === 0) return null;
  const d = await repo.getDispatch(checkoutId);
  const releasedBy = d ? await releasingOtherPr(d, input) : null;
  if (!d || releasedBy === null) return null;
  const how = d.releasedReason === "merged" ? "merge" : "close";
  const shas = stamped.map((t) => t.sha).join(", ");
  return {
    dispatch: d,
    note: `checkout dsp_…${checkoutId.slice(-4)} released by #${releasedBy} ${how}; accepted for commits already stamped with it: ${shas}`,
  };
}

/** Opt-in policy label (TASK-3408): this task merges only under a signed merge approval of the exact head. */
export const MERGE_APPROVAL_LABEL = "approval:merge-required";

const mergeWant = (input: VerifyPrInput) => ({
  kind: "merge" as const,
  repo: input.repoFullName ?? input.repo,
  pr: input.prNumber,
  headSha: input.headSha,
});

/**
 * TASK-3916: a person approves a PR's head, not a task. A signed approval of the
 * exact head on any task the PR stamps covers every task on it, so a PR with many
 * tasks needs one approval, not one per task. The scope pins repo, PR and head.
 */
async function anyTaskApprovesHead(checkoutIds: string[], input: VerifyPrInput): Promise<boolean> {
  const want = mergeWant(input);
  for (const cid of checkoutIds) {
    const d = await repo.getDispatch(cid);
    const task = d ? await loadTask(d.taskId) : null;
    if (task && (task.approvalGates ?? []).some((g) => checkApproval(task.id, g, want).ok)) return true;
  }
  return false;
}

/**
 * A signed merge approval of the exact head is required when the task carries
 * MERGE_APPROVAL_LABEL, or when the PR touches money, migrations or workflows
 * (TASK-3901). The path rule only warns while pathApprovalMode() says warn.
 */
async function mergeApprovalCheck(
  task: Task | null,
  input: VerifyPrInput,
  headApprovedOnPr: () => Promise<boolean>
): Promise<{ reasons: string[]; notes: string[] }> {
  const none = { reasons: [], notes: [] };
  if (!task) return none;
  const labelled = (task.labels ?? []).includes(MERGE_APPROVAL_LABEL);
  const classes = approvalPathClasses(input.changedPaths);
  const path = classes.length > 0 ? pathApprovalMode() : { mode: "off" as const, why: null };
  if (!labelled && path.mode === "off") return none;
  const want = mergeWant(input);
  const repoSlug = want.repo;
  const gates = task.approvalGates ?? [];
  if (gates.some((g) => checkApproval(task.id, g, want).ok)) return none;
  if (await headApprovedOnPr()) return none;
  const last = gates.findLast((g) => g.scope?.kind === "merge");
  const why = last ? (checkApproval(task.id, last, want) as { reason: string }).reason : "no_merge_approval";
  const covers = `no signed merge approval covers ${repoSlug}#${input.prNumber} at ${input.headSha.slice(0, 7)} (${why})`;
  if (labelled) return { reasons: [`${MERGE_APPROVAL_LABEL}: ${covers}`], notes: [] };
  const deciders = approvalDeciderAllowlist();
  const reason =
    `${classes.join(", ")} change: ${covers}. Raise one with mc_request_approval (merge scope, this head); ` +
    `${deciders.length ? deciders.join(", ") : "a person"} can approve it in MC`;
  return path.mode === "enforce"
    ? { reasons: [reason], notes: [] }
    : { reasons: [], notes: [`warning: ${reason} (not enforced: ${path.why ?? "PLX_MC_PATH_APPROVAL=warn"})`] };
}

export async function verifyPr(
  input: VerifyPrInput,
  options: VerifyPrOptions = {}
): Promise<VerifyPrResult> {
  const record = options.record ?? true;
  const tier = classifyRiskTier(input.changedPaths, input.labels ?? []);

  // Actor + task(s) come from the checkout credential(s), never git metadata
  // (decision 9). Prefer the multi-task list; fall back to the single id
  // (back-compat). Dedup. No checkouts → an operator PR (recorded, ungated).
  const ids = Array.from(
    new Set(
      (input.checkoutIds?.length ? input.checkoutIds : input.checkoutId ? [input.checkoutId] : []).filter(Boolean)
    )
  ) as string[];

  const prCommits = await prCommitsForVerify(input);
  const agentCommits = agentCommitsOf(prCommits);

  // Operator PR: one verdict, recorded ungated (decision 5) — unless its commits
  // carry agent signals, whoever opened it (TASK-3336).
  if (ids.length === 0) {
    const result: VerifyResult = agentCommits.length
      ? { verdict: "block", reasons: [unstampedAgentCommitsReason(agentCommits)] }
      : verifyCompliance({ task: null, actor: "operator", tier, bucketPrd: "unknown" });
    if (record) await recordVerdict(input, tier, "operator", null, "operator", result, null);
    return { ...result, tier, actorKind: "operator", taskId: null, tasks: [] };
  }

  // Agent PR: verify EVERY checked-out task. The PR passes only if ALL pass — one
  // incomplete task blocks the whole PR (one logical theme, N related tasks). Each
  // task's verdict is its own recorded check + event.
  const tasks: VerifyPrTaskResult[] = [];
  const resolveForPr = input.event === "merge_group" ? queueDispatchResolver(input) : prDispatchResolver(input);
  const reviewLinks = await reviewLinksForPr(input);
  // Every agent commit carries the trailer block and names a stamp in the body.
  // Shape problems and unknown stamps hold every task on the PR.
  const trailerRows: CommitTrailerRow[] = agentCommits.map(({ commit }) => ({
    sha: shortSha(commit.sha),
    ...commitTrailers(commit.message),
  }));
  const prCommitReasons = trailerRows.flatMap((t) => [
    ...t.problems.map((p) => `commit ${t.sha}: ${p}`),
    ...(t.checkoutId && !ids.includes(t.checkoutId)
      ? [`commit ${t.sha}: MC-Checkout trailer ${t.checkoutId} does not match a stamp in the PR body`]
      : []),
  ]);
  // TASK-3916: looked up once, and only when a task's own gates do not cover the head.
  let headApproval: Promise<boolean> | null = null;
  const headApprovedOnPr = () => (headApproval ??= anyTaskApprovesHead(ids, input));
  for (const cid of ids) {
    const resolution = await resolveForPr(cid);
    const stamped = trailerRows.filter((t) => t.checkoutId === cid);
    const reuse = resolution.reason === "released" ? await releasedStampForCommits(cid, input, stamped) : null;
    const blockReason = reuse ? undefined : resolution.reason;
    const d = resolution.dispatch ?? reuse?.dispatch ?? null;
    const taskId = d?.taskId ?? null;
    const actorIdentity = d?.runtime ?? "agent";
    const task = await loadTask(taskId);
    const bucketPrd = await bucketPrdForTask(task);
    // A task that cannot upload evidence never blocks on it: Trading Lab has its
    // own site, and a restricted project's evidence must not go to the shared library.
    const canUploadEvidence =
      !!task &&
      evidenceStoreEnabled() &&
      !ownEvidenceSite(d?.repo ?? "") &&
      !(await isBucketInRestrictedProject(task.bucket));
    const result: VerifyResult = blockReason
      ? { verdict: "block", reasons: [checkoutBlockReason(blockReason)] }
      : !task
        ? { verdict: "block", reasons: [checkoutBlockReason("task_deleted")] }
        : task.stage === "verified"
          ? { verdict: "block", reasons: [checkoutBlockReason("task_closed")] }
          : task.stage === "cancelled"
            ? { verdict: "pass", reasons: [cancelledTaskWarning(task)] }
            : verifyCompliance({
                task,
                actor: "agent",
                tier,
                bucketPrd,
                evidenceStoreEnabled: canUploadEvidence,
              });
    const trailerCheck = d ? await checkoutTrailerCheck(d, stamped, task) : { reasons: [], notes: [] };
    // A released checkout's SHA chain is never extended or bound (reuse is read-only).
    const chainCheck = d
      ? await leaseChainCheck(d, stamped, input, record && !reuse)
      : { reasons: [], notes: [] };
    // Diagnostics only: a released or revoked checkout of this repo still shows why and when.
    const shown = d ?? (await repo.getDispatch(cid).then((x) => (x && dispatchRepoMatches(x.repo, input.repo, input.repoFullName) ? x : null)));
    const approvalCheck = await mergeApprovalCheck(task, input, headApprovedOnPr);
    const commitReasons = [
      ...prCommitReasons,
      ...trailerCheck.reasons,
      ...chainCheck.reasons,
      ...approvalCheck.reasons,
    ];
    const notes = [...(reuse ? [reuse.note] : []), ...trailerCheck.notes, ...chainCheck.notes, ...approvalCheck.notes];
    const withCommits: VerifyResult = commitReasons.length
      ? { verdict: "block", reasons: [...commitReasons, ...result.reasons, ...notes] }
      : { ...result, reasons: [...result.reasons, ...notes] };
    const checked = applyReviewLinks(withCommits, reviewLinks);
    if (record) await recordVerdict(input, tier, "agent", taskId, actorIdentity, checked, taskId ?? cid);
    tasks.push({
      checkoutId: cid,
      taskId,
      verdict: checked.verdict,
      reasons: checked.reasons,
      checkout: {
        live: !!d && !resolution.reason && !d.releasedAt,
        expiresAt: shown?.expiresAt ?? null,
        releasedReason: shown?.releasedReason ?? null,
        blockReason: blockReason ?? null,
      },
      approvals: (task?.approvalGates ?? []).map((g) => ({
        gateId: g.id,
        status: g.status,
        decidedBy: g.decidedBy ?? null,
        decidedAt: g.decidedAt ?? null,
      })),
    });
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

// ready_for_review: the projection shows the PR as open (TASK-3743). It logs as
// pr.ready_for_review, which no timeline lists, so "PR #N opened" shows once.
const HANDLED_ACTIONS = new Set(["opened", "reopened", "synchronize", "ready_for_review", "closed"]);
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
  /** Audit-only PR state; never merge evidence or authorization input. */
  merged?: boolean;
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
  state: RoutingProposalState;
  deepLink: string | null;
  sessionId: string | null;
  candidates: Array<{ taskId: string; matchScore: number; reasons: string[] }>;
  bodyContentHash: string;
  policyVersion: string;
  configuredMode: RolloutMode;
  effectiveMode: RolloutMode;
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
  const staged = await resolveStagedServicePrincipal(
    GITHUB_ACTIONS_ROUTING_SERVICE_PRINCIPAL_ID
  );
  if (!staged.actor) {
    recordUnresolvedActorDenial({
      site: "compliance.routing-propose",
      capability: "routing.propose",
      actorKind: "service",
      actorId: GITHUB_ACTIONS_ROUTING_SERVICE_PRINCIPAL_ID,
      resource: { type: "routing", id: repositoryId },
    });
    throw new ApiError(
      "forbidden",
      "Durable sp_github_actions_routing service principal is missing.",
      403
    );
  }
  const decision = authorizeStaged({
    site: "compliance.routing-propose",
    capability: "routing.propose",
    resource: { type: "routing", id: repositoryId },
    context: { repositoryId },
    appliedActor: staged.actor,
    shadowActor: staged.shadowActor,
    shadowMissing: staged.shadowMissing,
  });
  if (!decision.allowed) {
    throw new ApiError(
      "forbidden",
      `routing.propose denied (${decision.reasonCode}).`,
      403
    );
  }
  return staged.actor;
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
  if (!metadataEnabled()) {
    throw new ApiError(
      "routing_metadata_disabled",
      "Routing metadata ingestion is disabled (PLX_MC_ROUTING_METADATA_ENABLED=0).",
      503
    );
  }
  const cohortRuntime = resolveRepoCohortRuntimeState(repoId);
  if (!cohortRuntime) {
    throw new ApiError(
      "routing_cohort_disabled",
      "Routing metadata is unavailable for an unknown or disabled repository cohort.",
      503
    );
  }
  const { configuredMode, effectiveMode } = cohortRuntime.state;

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
  let sessionId: string | null = sessionFromMarker;

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
      // An unchecked foreign/expired/rebound marker cannot be attached to the
      // proposal. Scoring may proceed without session correlation.
      sessionId = null;
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
  revisionCandidates = revision.candidates;
  candidates = revisionCandidates.map((candidate) => ({
    taskId: candidate.taskId,
    matchScore: candidate.matchScore,
    reasons: candidate.reasons,
  }));
  const persistedBodyContentHash =
    revision.evidenceMeta.bodyContentHash ?? markers.bodyContentHash;

  const privateDeepLink = proposalDeepLink(proposal.id);
  const persistedState = proposal.state;
  await repo.appendEvent({
    kind: "routing.proposal.upserted",
    actor: GITHUB_ACTIONS_ROUTING_SERVICE_PRINCIPAL_ID,
    repo: repoId,
    pr: changeId,
    payload: {
      proposalId: proposal.id,
      revisionId: revision.id,
      state: persistedState,
      headSha: input.headSha,
      bodyContentHash: persistedBodyContentHash,
      deepLink: privateDeepLink,
      configuredMode,
      effectiveMode,
      runId: input.runId ?? null,
      eventSource: input.eventSource ?? "oidc.propose",
      action: input.action,
      merged: input.merged === true,
    },
    dedupKey: `routing.proposal:${proposal.id}:${input.headSha}:${input.action}`,
  });

  const suggestionsVisible = effectiveMode !== "shadow";
  return {
    proposalId: proposal.id,
    revisionId: revision.id,
    state: persistedState,
    deepLink: suggestionsVisible ? privateDeepLink : null,
    sessionId,
    candidates: suggestionsVisible ? candidates : [],
    bodyContentHash: persistedBodyContentHash,
    policyVersion: revision.policyVersion,
    configuredMode,
    effectiveMode,
  };
}

// Kill switch for the title/branch link alone; stamped projection is unaffected.
function prTaskLinkEnabled(): boolean {
  return process.env.COMPLIANCE_PR_TASK_LINK_ENABLED !== "0";
}

// As in routing's assertRepoEligible, a task with no repos takes any repo.
// Otherwise the PR's owner/name must resolve to one of its registry ids.
async function taskTakesRepo(task: Task, evt: PrEvent): Promise<boolean> {
  if (!task.repos?.length) return true;
  const registry = Object.fromEntries((await getRepos()).map((r) => [r.id, r]));
  const resolved = resolveRepoInput(evt.repoFullName || evt.repo, registry);
  return resolved.ok && task.repos.includes(resolved.id);
}

type PrTaskLinkOutcome =
  | "resolved"
  | "ambiguous"
  | "revert"
  | "fork"
  | "unknown_task"
  | "restricted"
  | "repo_mismatch"
  | "task_closed"
  | "creator_approval_pending";

// Ingestion has no project-authorized identity for the PR's author (unlike
// mc_checkout_task or mc_link_merged_pr), so it links only a task that a caller
// with no project membership could see (canAccessTask): not a restricted
// project, nor a bucket naming a missing project. As the ACL does for projects,
// an unparented task (empty bucket) stays shared while a non-empty bucket id
// with no row is a dangling parent and fails closed.
async function taskOpenToAll(task: Task): Promise<boolean> {
  const { projectsById, bucketsById } = await loadProjectAclMaps();
  if (task.bucket && !bucketsById.has(task.bucket)) return false;
  return canAccessTask(task, bucketsById, projectsById, { tokens: [] });
}

async function prTaskLinkOutcome(
  ref: Exclude<PrTaskResolution, { kind: "none" } | { kind: "checkout" }>,
  evt: PrEvent
): Promise<PrTaskLinkOutcome> {
  if (ref.kind !== "resolved") return ref.kind;
  const task = await loadTask(ref.taskIds[0]);
  if (!task) return "unknown_task";
  if (!(await taskOpenToAll(task))) return "restricted";
  if (!(await taskTakesRepo(task, evt))) return "repo_mismatch";
  // A cancelled task takes no link. A delivered one keeps its merge record: a
  // later PR that only names it does not re-promote it. A PR the task already
  // holds (a replay, or linked work still open) is projected as usual.
  const holdsPr = (task.prs ?? []).some((p) => samePr(p, { repo: evt.repo, num: evt.prNumber }));
  if (task.stage === "cancelled" || ((task.stage === "merged" || task.stage === "verified") && !holdsPr)) return "task_closed";
  // TASK-3530: no checkout reaches such a task, and its merge is skipped before
  // the row is rewritten, so a linked open row would stay open for good.
  if (creatorApprovalPending(task)) return "creator_approval_pending";
  return "resolved";
}

// TASK-4004: an unstamped PR links to the task its title or branch names
// (resolvePrTask); the projection then moves that task to Merged on merge.
// Any other outcome links nothing. Each outcome is one pr.task_link event per
// PR. Gates, approvals and the PR's own events are untouched.
async function prTaskLinks(evt: PrEvent, checkoutIds: string[], actor: string): Promise<string[]> {
  const ref = resolvePrTask(evt, checkoutIds);
  if (ref.kind === "none" || ref.kind === "checkout") return [];
  const outcome = await prTaskLinkOutcome(ref, evt);
  // taskId stays null unless the PR linked. filterEventsByProjectAcl scopes the
  // event by every task in payload.taskIds, so a non-member of a restricted
  // project never sees what MC decided about that project's task.
  await repo.appendEvent({
    kind: PR_TASK_LINK_EVENT,
    actor,
    repo: evt.repo,
    taskId: outcome === "resolved" ? ref.taskIds[0] : null,
    pr: String(evt.prNumber),
    payload: { outcome, source: ref.source, taskIds: ref.taskIds, title: evt.title, branch: evt.branch },
    dedupKey: `${PR_TASK_LINK_EVENT}:${evt.repo}:${evt.prNumber}:${outcome}:${ref.source}:${ref.taskIds.join(",")}`,
  });
  return outcome === "resolved" ? ref.taskIds : [];
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
  if (evt.action === "reopened") {
    for (const cid of ids) {
      const d = await repo.getDispatch(cid);
      if (d && !d.revoked && d.releasedAt && dispatchRepoMatches(d.repo, evt.repo, evt.repoFullName)) {
        await repo.unreleaseDispatches([cid], { repo: d.repo });
      }
    }
  }
  const resolveForPr = prDispatchResolver(evt);
  let taskIds: string[] = [];
  if (ids.length > 0) {
    actorKind = "agent";
    for (const cid of ids) {
      const d =
        evt.action === "closed" && evt.merged
          ? await resolveDispatchForMerge(cid, evt)
          : evt.action === "closed"
            ? (await resolveDispatch(cid, evt.repo, evt.repoFullName)).dispatch
            : (await resolveForPr(cid)).dispatch;
      if (d?.taskId) taskIds.push(d.taskId);
      if (actorIdentity === (evt.author || "operator") && d?.runtime) actorIdentity = d.runtime;
    }
    taskIds = Array.from(new Set(taskIds));
    taskId = taskIds[0] ?? null;
  }

  if (!HANDLED_ACTIONS.has(evt.action)) {
    return { action: evt.action, actorKind, taskId, recorded: false };
  }
  // An unmerged close links nothing new (the projection only updates held rows).
  const linkable = projectionEnabled() && prTaskLinkEnabled() && !(evt.action === "closed" && !evt.merged);
  const linkedTaskIds = linkable ? await prTaskLinks(evt, ids, actorIdentity) : [];
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
        linkedTaskIds,
      });
    }
    // Attribute/project the merge before release. Release is not revocation:
    // resolveDispatchForMerge must still attribute a replay of the same head.
    // TASK-3813: a checkout another open PR still stamps (a stacked PR) stays
    // live. A GitHub error throws, so ingestOrQueue replays the release later.
    const reason = evt.merged ? "merged" : "closed";
    for (const cid of new Set(ids)) {
      const d = await repo.getDispatch(cid);
      if (!d || d.revoked || d.releasedAt || !dispatchRepoMatches(d.repo, evt.repo, evt.repoFullName)) continue;
      const openPr = await openPrHoldingCheckout(d, evt.prNumber);
      if (openPr !== null) {
        await repo.appendEvent({
          kind: "checkout.release_refused", actor: d.runtime, repo: d.repo, taskId: d.taskId, pr: String(openPr),
          payload: { checkoutId: cid, reason, code: "open_pr_holds_checkout", closedPr: evt.prNumber },
          dedupKey: `checkout.release_refused:${idBase}:${cid}`,
        });
        continue;
      }
      await repo.releaseDispatches([cid], { repo: d.repo, pr: evt.prNumber, reason });
    }
    return { action: evt.action, actorKind, taskId, recorded: true, proposalId, deepLink };
  }

  // TASK-3409: a push to (or reopen of) an open PR that carries a stamp keeps
  // that checkout alive, so in-flight work never lapses mid-review.
  const renewable: repo.DispatchRow[] = [];
  let renewRepo: string | null = null;
  for (const cid of new Set(ids)) {
    const d = await repo.getDispatch(cid);
    if (!d || d.revoked || d.releasedAt || !dispatchRepoMatches(d.repo, evt.repo, evt.repoFullName)) continue;
    renewable.push(d);
    renewRepo = d.repo;
  }
  if (renewRepo) {
    await repo.renewDispatches(renewable.map((d) => d.id), { repo: renewRepo, pr: evt.prNumber, ttlMinutes: CHECKOUT_TTL_MIN });
  }
  // TASK-3410: the push extends each stamped checkout's SHA chain when it is a
  // fast-forward from a chain head (or attaches the first head to an empty chain).
  for (const d of renewable) {
    const heads = await repo.dispatchHeads(d.id);
    if (boundPr(heads) !== null && boundPr(heads) !== evt.prNumber) continue;
    // A head recorded before its PR existed binds to this PR (the gate holds other PRs off it).
    if (heads.some((h) => h.headSha === evt.headSha && h.pr === null)) {
      await repo.bindDispatchHeadPr({ dispatchId: d.id, headSha: evt.headSha, pr: evt.prNumber, recordedBy: "github-webhook" });
    }
    if (evt.forced || heads.some((h) => h.headSha === evt.headSha)) continue;
    const candidates = heads.length ? heads.map((h) => h.headSha).reverse() : d.baseSha ? [d.baseSha] : [];
    let ancestor: string | null = null;
    for (const sha of candidates) {
      const descends = githubHeadDescendsFrom(d.repo, sha, evt.headSha);
      // Only launcher checkouts are held to the chain; an ordinary checkout's failed compare must not queue the event.
      if (await (d.launchId ? descends : descends.catch(() => false))) {
        ancestor = sha;
        break;
      }
    }
    if (webhookExtendsChain(d, heads, evt, ancestor)) {
      await repo.recordDispatchHead({
        dispatchId: d.id,
        headSha: evt.headSha,
        beforeSha: evt.beforeSha ?? null,
        pr: evt.prNumber,
        source: "webhook",
        recordedBy: "github-webhook",
      });
    }
  }

  const kind =
    evt.action === "synchronize" ? "pr.synchronized" : evt.action === "ready_for_review" ? "pr.ready_for_review" : "pr.opened";
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
      linkedTaskIds,
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
// Replay re-resolves expired credentials against the live open PR attachment;
// unavailable GitHub remains fail-closed and leaves the work queued.
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
