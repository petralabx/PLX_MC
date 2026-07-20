// Authorized routing mutations: confirm-existing, attach-checkout, create-task.
// One withTransaction boundary owns lock → allocate/insert → decision → link →
// event → proposal resolution. Fuzzy trust cannot mutate.

import { ApiError } from "@/lib/api/route";
import { withTransaction, type TxQuery } from "@/lib/db";
import {
  formatRepoNotAllowedMessage,
  normalizeRepoInputs,
} from "@/lib/mc-data/repos";
import type { Task } from "@/lib/mc-data";
import { ROUTING_POLICY_VERSION } from "@/lib/routing/persistence";
import {
  allocateNextTaskId,
  appendWorkLink,
  consumeRoutingSession,
  insertCreationIntent,
  lockProposalForUpdate,
  recordDecision,
  resolveProposal,
} from "@/lib/routing/repo";
import type {
  AuthorizationTrust,
  RoutingDecisionKind,
  WorkLinkType,
} from "@/lib/routing/types";
import { ensureSeeded, ensureReposSeeded, ensureBucketsSeeded } from "@/lib/sync/engine";
import type { FieldAttribution } from "@/lib/sync/mapping";
import * as syncRepo from "@/lib/sync/repo";
import type { AuthorizedActor } from "./mutations/actors";
import { requireAuthorizedActor } from "./mutations/actors";
import {
  assertConfirmEnabled,
  assertMutableTrust,
  assertNoOpenConflictsOrErrors,
  assertRoutingFreshness,
  creationIntentHash,
  mintId,
} from "./mutations/preconditions";

export interface ConfirmExistingInput {
  proposalId: string;
  taskId: string;
  revisionId?: string | null;
  linkType?: WorkLinkType;
  headSha?: string | null;
  mergeSha?: string | null;
  /** When present, fuzzy/none are rejected. Omit for explicit human override. */
  authorizationTrust?: AuthorizationTrust;
  overrideReason?: string | null;
  evidence?: Record<string, unknown>;
}

export interface AttachCheckoutInput {
  proposalId: string;
  taskId: string;
  checkoutId: string;
  revisionId?: string | null;
  headSha?: string | null;
  authorizationTrust?: AuthorizationTrust;
  evidence?: Record<string, unknown>;
}

export interface CreateRoutedTaskInput {
  proposalId: string;
  bucketId: string;
  title: string;
  description?: string;
  repos?: string[];
  /** Required — accountable human owner (Entra oid or durable id). */
  accountableOwnerId: string;
  revisionId?: string | null;
  headSha?: string | null;
  mergeSha?: string | null;
  authorizationTrust?: AuthorizationTrust;
  labels?: string[];
  priority?: Task["priority"];
  evidence?: Record<string, unknown>;
}

export interface RoutingMutationResult {
  taskId: string;
  proposalId: string;
  decisionKind: RoutingDecisionKind;
  linkType: WorkLinkType;
  created: boolean;
  replayed: boolean;
}

async function loadTaskOrThrow(taskId: string): Promise<Task> {
  const row = await syncRepo.getEntity("task", taskId);
  if (!row) throw new ApiError("not_found", `unknown task ${taskId}`, 404);
  return row.data as unknown as Task;
}

async function requireExistingBucket(bucketId: string): Promise<{
  id: string;
  project: string | null;
}> {
  await ensureBucketsSeeded();
  const buckets = await syncRepo.getBuckets();
  const bucket = buckets.find((b) => b.id === bucketId);
  if (!bucket) {
    throw new ApiError("invalid_bucket", `Bucket ${bucketId} does not exist.`, 422);
  }
  return { id: bucket.id, project: bucket.project ?? null };
}

function assertRepoEligible(task: Task, repoId: string): void {
  const repos = task.repos ?? [];
  if (repos.length > 0 && !repos.includes(repoId)) {
    throw new ApiError(
      "repository_mismatch",
      `Task ${task.id} is not eligible for repository ${repoId}.`,
      403
    );
  }
}

function assertNotSilentVerifiedReopen(task: Task): void {
  if (task.stage === "verified") {
    throw new ApiError(
      "verified_locked",
      `Task ${task.id} is Verified — linking requires explicit reopen authority (task.reopen), not silent reopen.`,
      409
    );
  }
}

async function insertMcEvent(
  q: TxQuery,
  input: {
    kind: string;
    actor: string;
    repo: string;
    taskId: string;
    payload: Record<string, unknown>;
  }
): Promise<void> {
  await q(
    `INSERT INTO mc_events (kind, actor, repo, task_id, payload)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [input.kind, input.actor, input.repo, input.taskId, JSON.stringify(input.payload)]
  );
}

async function insertTaskRow(
  q: TxQuery,
  task: Task,
  attribution: Record<string, FieldAttribution>
): Promise<void> {
  const rows = await q<{ id: string }>(
    `INSERT INTO entities (
       entity_type, id, data, sync_state, sync_ts, dirty_fields, field_attribution
     ) VALUES ('task', $1, $2::jsonb, 'pending', now(), '[]'::jsonb, $3::jsonb)
     ON CONFLICT (entity_type, id) DO NOTHING
     RETURNING id`,
    [task.id, JSON.stringify(task), JSON.stringify(attribution)]
  );
  if (!rows[0]) {
    throw new ApiError("conflict", `Task ${task.id} already exists.`, 409);
  }
}

/**
 * Confirm an existing Task for a routing proposal — idempotent related/delivery link.
 */
export async function confirmExistingTask(
  authorized: AuthorizedActor,
  input: ConfirmExistingInput
): Promise<RoutingMutationResult> {
  assertConfirmEnabled();
  assertMutableTrust(input.authorizationTrust);
  await assertRoutingFreshness();
  await assertNoOpenConflictsOrErrors();
  await ensureSeeded();

  requireAuthorizedActor(authorized, "routing.resolve", {
    type: "routing",
    id: input.proposalId,
  });
  requireAuthorizedActor(authorized, "task.link", {
    type: "task",
    id: input.taskId,
  });

  const task = await loadTaskOrThrow(input.taskId);
  assertNotSilentVerifiedReopen(task);

  const linkType: WorkLinkType = input.linkType ?? "related";
  const decisionKind: RoutingDecisionKind =
    input.overrideReason ? "override" : "accept_existing";

  return withTransaction(async (q) => {
    const proposal = await lockProposalForUpdate(input.proposalId, q);
    if (!proposal) {
      throw new ApiError("not_found", `unknown proposal ${input.proposalId}`, 404);
    }
    if (proposal.state === "resolved" && proposal.selectedTaskId === input.taskId) {
      return {
        taskId: input.taskId,
        proposalId: proposal.id,
        decisionKind,
        linkType,
        created: false,
        replayed: true,
      };
    }
    if (proposal.state === "resolved" || proposal.state === "rejected") {
      throw new ApiError(
        "proposal_terminal",
        `Proposal ${proposal.id} is already ${proposal.state}.`,
        409
      );
    }

    assertRepoEligible(task, proposal.repoId);

    const decisionId = mintId("rd");
    const linkId = mintId("rwl");

    await recordDecision(
      {
        id: decisionId,
        proposalId: proposal.id,
        revisionId: input.revisionId ?? null,
        decisionKind,
        taskId: input.taskId,
        bucketId: task.bucket,
        projectId: (await requireExistingBucket(task.bucket)).project,
        actorId: authorized.actorId,
        actorKind: authorized.actorKind,
        overrideReason: input.overrideReason ?? null,
        rejectionReason: null,
        policyVersion: ROUTING_POLICY_VERSION,
      },
      q
    );

    await appendWorkLink(
      {
        id: linkId,
        proposalId: proposal.id,
        taskId: input.taskId,
        linkType,
        repoId: proposal.repoId,
        changeId: proposal.changeId,
        headSha: input.headSha ?? null,
        mergeSha: input.mergeSha ?? null,
        evidence: {
          ...(input.evidence ?? {}),
          authorizationTrust: input.authorizationTrust ?? "persisted_decision",
        },
        createdBy: authorized.actorId,
      },
      q
    );

    await insertMcEvent(q, {
      kind: "routing.confirm",
      actor: authorized.auditLabel,
      repo: proposal.repoId,
      taskId: input.taskId,
      payload: {
        proposalId: proposal.id,
        decisionId,
        linkId,
        decisionKind,
        linkType,
      },
    });

    const projectId = (await requireExistingBucket(task.bucket)).project;
    await resolveProposal(
      {
        proposalId: proposal.id,
        state: "resolved",
        selectedTaskId: input.taskId,
        selectedBucketId: task.bucket,
        derivedProjectId: projectId,
      },
      q
    );

    if (proposal.sessionId) {
      await consumeRoutingSession(proposal.sessionId, proposal.id, q);
    }

    return {
      taskId: input.taskId,
      proposalId: proposal.id,
      decisionKind,
      linkType,
      created: false,
      replayed: false,
    };
  });
}

/**
 * Attach a credentialed checkout to a proposal + Task (typed related link).
 */
export async function attachCheckoutLink(
  authorized: AuthorizedActor,
  input: AttachCheckoutInput
): Promise<RoutingMutationResult> {
  assertConfirmEnabled();
  assertMutableTrust(input.authorizationTrust ?? "credentialed_checkout");
  await assertRoutingFreshness();
  await assertNoOpenConflictsOrErrors();
  await ensureSeeded();

  requireAuthorizedActor(authorized, "routing.resolve", {
    type: "routing",
    id: input.proposalId,
  });
  requireAuthorizedActor(authorized, "task.link", {
    type: "task",
    id: input.taskId,
  });
  requireAuthorizedActor(authorized, "task.checkout", {
    type: "task",
    id: input.taskId,
  });

  if (!input.checkoutId.startsWith("dsp_")) {
    throw new ApiError("invalid_checkout", "checkoutId must be a dsp_* credential.", 422);
  }

  const task = await loadTaskOrThrow(input.taskId);
  assertNotSilentVerifiedReopen(task);

  return withTransaction(async (q) => {
    const proposal = await lockProposalForUpdate(input.proposalId, q);
    if (!proposal) {
      throw new ApiError("not_found", `unknown proposal ${input.proposalId}`, 404);
    }
    if (proposal.state === "resolved" && proposal.selectedTaskId === input.taskId) {
      return {
        taskId: input.taskId,
        proposalId: proposal.id,
        decisionKind: "accept_existing" as const,
        linkType: "related" as const,
        created: false,
        replayed: true,
      };
    }
    if (proposal.state === "resolved" || proposal.state === "rejected") {
      throw new ApiError(
        "proposal_terminal",
        `Proposal ${proposal.id} is already ${proposal.state}.`,
        409
      );
    }

    assertRepoEligible(task, proposal.repoId);
    const projectId = (await requireExistingBucket(task.bucket)).project;
    const decisionId = mintId("rd");
    const linkId = mintId("rwl");

    await recordDecision(
      {
        id: decisionId,
        proposalId: proposal.id,
        revisionId: input.revisionId ?? null,
        decisionKind: "accept_existing",
        taskId: input.taskId,
        bucketId: task.bucket,
        projectId,
        actorId: authorized.actorId,
        actorKind: authorized.actorKind,
        overrideReason: null,
        rejectionReason: null,
        policyVersion: ROUTING_POLICY_VERSION,
      },
      q
    );

    await appendWorkLink(
      {
        id: linkId,
        proposalId: proposal.id,
        taskId: input.taskId,
        linkType: "related",
        repoId: proposal.repoId,
        changeId: proposal.changeId,
        headSha: input.headSha ?? null,
        mergeSha: null,
        evidence: {
          ...(input.evidence ?? {}),
          checkoutId: input.checkoutId,
          authorizationTrust: "credentialed_checkout",
        },
        createdBy: authorized.actorId,
      },
      q
    );

    await insertMcEvent(q, {
      kind: "routing.attach",
      actor: authorized.auditLabel,
      repo: proposal.repoId,
      taskId: input.taskId,
      payload: {
        proposalId: proposal.id,
        checkoutId: input.checkoutId,
        decisionId,
        linkId,
      },
    });

    await resolveProposal(
      {
        proposalId: proposal.id,
        state: "resolved",
        selectedTaskId: input.taskId,
        selectedBucketId: task.bucket,
        derivedProjectId: projectId,
      },
      q
    );

    if (proposal.sessionId) {
      await consumeRoutingSession(proposal.sessionId, proposal.id, q);
    }

    return {
      taskId: input.taskId,
      proposalId: proposal.id,
      decisionKind: "accept_existing",
      linkType: "related",
      created: false,
      replayed: false,
    };
  });
}

/**
 * Confirmed Task creation — sequence allocate + Task + intent + decision +
 * link + event + proposal resolve in one transaction.
 */
export async function createConfirmedTask(
  authorized: AuthorizedActor,
  input: CreateRoutedTaskInput
): Promise<RoutingMutationResult> {
  assertConfirmEnabled();
  assertMutableTrust(input.authorizationTrust);
  await assertRoutingFreshness();
  await assertNoOpenConflictsOrErrors();
  await ensureSeeded();
  await ensureReposSeeded();

  if (!input.accountableOwnerId?.trim()) {
    throw new ApiError(
      "accountable_owner_required",
      "Confirmed Task creation requires an accountable owner.",
      422
    );
  }

  requireAuthorizedActor(authorized, "routing.resolve", {
    type: "routing",
    id: input.proposalId,
  });
  // Humans use task.create; services may only create via routing.resolve
  // (MCP lacks task.create by design). Re-check human create capability.
  if (authorized.actorKind === "human") {
    requireAuthorizedActor(authorized, "task.create", {
      type: "bucket",
      id: input.bucketId,
    });
  }

  const bucket = await requireExistingBucket(input.bucketId);
  const registry = await syncRepo.getRepos();
  const registryMap = Object.fromEntries(registry.map((r) => [r.id, r]));
  const { ids: repos, rejected } = normalizeRepoInputs(input.repos ?? [], registryMap);
  if (rejected.length > 0) {
    throw new ApiError("repo_not_allowed", formatRepoNotAllowedMessage(rejected), 422);
  }

  const intentHash = creationIntentHash({
    bucketId: input.bucketId,
    title: input.title,
    repos,
    accountableOwnerId: input.accountableOwnerId,
    projectId: bucket.project,
  });

  const nowAttr: FieldAttribution = {
    source: authorized.actorKind,
    at: new Date().toISOString(),
    actorId: authorized.actorId,
  };

  return withTransaction(async (q) => {
    const proposal = await lockProposalForUpdate(input.proposalId, q);
    if (!proposal) {
      throw new ApiError("not_found", `unknown proposal ${input.proposalId}`, 404);
    }
    if (proposal.state === "resolved" && proposal.selectedTaskId) {
      return {
        taskId: proposal.selectedTaskId,
        proposalId: proposal.id,
        decisionKind: "create_task" as const,
        linkType: "related" as const,
        created: false,
        replayed: true,
      };
    }
    if (proposal.state === "resolved" || proposal.state === "rejected") {
      throw new ApiError(
        "proposal_terminal",
        `Proposal ${proposal.id} is already ${proposal.state}.`,
        409
      );
    }

    // Idempotent creation intent — check first so retries never burn sequence ids.
    const priorIntent = await q<{ id: string; task_id: string }>(
      `SELECT id, task_id FROM routing_creation_intents
        WHERE proposal_id = $1 AND creation_intent_hash = $2
        LIMIT 1`,
      [proposal.id, intentHash]
    );

    let taskId: string;
    let created = false;
    let replayed = false;

    if (priorIntent[0]) {
      taskId = String(priorIntent[0].task_id);
      replayed = true;
    } else {
      taskId = await allocateNextTaskId(q);
      await insertCreationIntent(
        {
          id: mintId("rci"),
          proposalId: proposal.id,
          creationIntentHash: intentHash,
          taskId,
        },
        q
      );

      const existing = await q<{ id: string }>(
        `SELECT id FROM entities WHERE entity_type = 'task' AND id = $1 LIMIT 1`,
        [taskId]
      );
      if (!existing[0]) {
        const task: Task = {
          id: taskId,
          title: input.title.trim(),
          description: (input.description ?? "").trim(),
          bucket: input.bucketId,
          stage: "backlog",
          priority: input.priority ?? "medium",
          assignee: null,
          coassignees: [],
          reporter: authorized.auditLabel,
          accountableOwner: input.accountableOwnerId,
          reqs: [],
          repos,
          targetEnv: "staging",
          estimate: "M",
          labels: input.labels ?? [],
          prs: [],
          due: "—",
          sync: {
            state: "pending",
            ts: syncRepo.stamp(),
            sp: `ToDos · ${taskId}`,
          },
          subtasks: [],
          activity: [
            {
              age: "now",
              who: authorized.auditLabel,
              kind: "move",
              what: "created the task via routing confirm",
            },
          ],
          userCreated: true,
        };
        await insertTaskRow(q, task, {
          title: nowAttr,
          bucket: nowAttr,
          accountableOwner: nowAttr,
        });
        created = true;
      }
    }

    const decisionId = mintId("rd");
    const linkId = mintId("rwl");

    requireAuthorizedActor(authorized, "task.link", { type: "task", id: taskId });

    await recordDecision(
      {
        id: decisionId,
        proposalId: proposal.id,
        revisionId: input.revisionId ?? null,
        decisionKind: "create_task",
        taskId,
        bucketId: input.bucketId,
        projectId: bucket.project,
        actorId: authorized.actorId,
        actorKind: authorized.actorKind,
        overrideReason: null,
        rejectionReason: null,
        policyVersion: ROUTING_POLICY_VERSION,
      },
      q
    );

    await appendWorkLink(
      {
        id: linkId,
        proposalId: proposal.id,
        taskId,
        linkType: "related",
        repoId: proposal.repoId,
        changeId: proposal.changeId,
        headSha: input.headSha ?? null,
        mergeSha: input.mergeSha ?? null,
        evidence: {
          ...(input.evidence ?? {}),
          creationIntentHash: intentHash,
          authorizationTrust: input.authorizationTrust ?? "persisted_decision",
        },
        createdBy: authorized.actorId,
      },
      q
    );

    await insertMcEvent(q, {
      kind: "routing.create_task",
      actor: authorized.auditLabel,
      repo: proposal.repoId,
      taskId,
      payload: {
        proposalId: proposal.id,
        bucketId: input.bucketId,
        projectId: bucket.project,
        creationIntentHash: intentHash,
        decisionId,
        linkId,
        created,
        replayed,
      },
    });

    await resolveProposal(
      {
        proposalId: proposal.id,
        state: "resolved",
        selectedTaskId: taskId,
        selectedBucketId: input.bucketId,
        derivedProjectId: bucket.project,
      },
      q
    );

    if (proposal.sessionId) {
      await consumeRoutingSession(proposal.sessionId, proposal.id, q);
    }

    return {
      taskId,
      proposalId: proposal.id,
      decisionKind: "create_task",
      linkType: "related",
      created,
      replayed,
    };
  });
}
