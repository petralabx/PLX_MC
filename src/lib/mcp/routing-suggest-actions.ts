// MCP routing suggestion action — audited, authorize(routing.suggest), no
// Task/link/SharePoint mutation. Operator email is audit context only.

import { randomBytes } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ApiError } from "@/lib/api/route";
import { authorizeStaged } from "@/lib/permissions/enforcement";
import { normalizeRoutingEvidence } from "@/lib/routing/evidence";
import {
  runShadowRouting,
  type RoutingBucketView,
  type RoutingTaskView,
  type ShadowRoutingResult,
} from "@/lib/routing/engine";
import { upsertRoutingSession } from "@/lib/routing/repo";
import { resolveAutonomyLevel, type ResolvedAutonomy } from "@/lib/routing/autonomy";
import { loadAgentOutcomes, type AgentOutcomeMetrics } from "@/lib/routing/outcomes";
import { resolveRepoCohortRuntimeState } from "@/lib/routing/rollout";
import type {
  RoutingCandidateRecord,
  RoutingFailureReason,
  RoutingSessionId,
} from "@/lib/routing/types";
import { snapshot } from "@/lib/sync";
import { getRegisterInboundCompletions } from "@/lib/sync/repo";
import trackedReposRegistry from "../../../config/tracked-repos-registry.json";
import type { McpIdentity } from "./auth";
import { publicMcBaseUrl, taskLink } from "./envelope";

const IDLE_TTL_MS = 24 * 60 * 60 * 1000;
const ABSOLUTE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface SuggestWorkInput {
  title?: string;
  branch?: string;
  baseBranch?: string;
  sourceBranch?: string;
  headSha?: string;
  /** In-memory only — used for marker/hash extraction, never persisted. */
  body?: string;
  changedPaths?: string[];
  labels?: string[];
  /** Reuse an existing provisional session when re-suggesting. */
  routingSessionId?: string;
  detailLimit?: number;
}

export interface SuggestWorkCandidate extends RoutingCandidateRecord {
  link: string;
}

export interface SuggestWorkResult {
  routingSessionId: string;
  ok: boolean;
  failureReason: RoutingFailureReason;
  candidates: SuggestWorkCandidate[];
  reasons: string[];
  derivedProjectId: string | null;
  policyVersion: string;
  scoringVersion: string;
  deepLinks: {
    session: string;
    candidates: Record<string, string>;
  };
  mcRoutingMarker: string;
  /** Operator email is audit context only — never used for authorization. */
  operatorContext: string;
  /** Evaluation loop (TASK-634): effective autonomy + the requesting runtime's outcomes. */
  evaluation: {
    autonomy: ResolvedAutonomy;
    runtime: string;
    outcomes: AgentOutcomeMetrics | null;
  };
}

export function routingSuggestEnabled(): boolean {
  return (process.env.PLX_MC_ROUTING_SUGGEST_ENABLED ?? "0").trim() === "1";
}

export function mintRoutingSessionId(): RoutingSessionId {
  return `rtx_${randomBytes(12).toString("hex")}` as RoutingSessionId;
}

function sessionDeepLink(sessionId: string): string {
  return `${publicMcBaseUrl()}/routing?session=${encodeURIComponent(sessionId)}`;
}

function requireSuggestAuthorized(identity: McpIdentity): void {
  // Authorize the durable MCP service principal only. Operator email is
  // admission/audit context on the request identity — never a grant input.
  const decision = authorizeStaged({
    site: "routing.suggest",
    capability: "routing.suggest",
    resource: { type: "routing", id: identity.repo },
    context: { repositoryId: identity.repo },
    auditLabel: identity.operatorEmail,
    appliedActor: identity.actor,
  });
  if (!decision.allowed) {
    throw new ApiError(
      "forbidden",
      `routing.suggest denied (${decision.reasonCode}).`,
      403
    );
  }
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
 * Suggest existing Tasks for work without creating/linking anything.
 * Mints (or refreshes) a provisional `rtx_*` routing session for correlation.
 */
export async function actionSuggestWork(
  identity: McpIdentity,
  input: SuggestWorkInput = {}
): Promise<SuggestWorkResult> {
  if (!routingSuggestEnabled()) {
    throw new ApiError(
      "routing_suggest_disabled",
      "Routing suggestions are disabled (PLX_MC_ROUTING_SUGGEST_ENABLED != 1).",
      503
    );
  }

  requireSuggestAuthorized(identity);
  const cohortRuntime = resolveRepoCohortRuntimeState(identity.repo);
  if (
    !cohortRuntime ||
    (cohortRuntime.state.effectiveMode !== "suggestion" &&
      cohortRuntime.state.effectiveMode !== "confirmation")
  ) {
    throw new ApiError(
      "routing_suggest_unavailable_for_cohort",
      "Routing suggestions are unavailable for this unknown, disabled, or shadow-only repository cohort.",
      503
    );
  }
  // Autonomy dial (TASK-635): an operator dial can lower the cohort's mode.
  const autonomy = resolveAutonomyLevel({
    cohortMode: cohortRuntime.state.effectiveMode,
    repoId: identity.repo,
  });
  if (autonomy.mode === "shadow") {
    throw new ApiError(
      "routing_suggest_unavailable_for_cohort",
      "Routing suggestions are dialed down to shadow for this repository (config/autonomy-dial.json).",
      503
    );
  }

  const normalized = normalizeRoutingEvidence({
    repoFullName: identity.repo,
    title: input.title,
    branch: input.branch ?? input.sourceBranch,
    baseBranch: input.baseBranch ?? "main",
    sourceBranch: input.sourceBranch ?? input.branch ?? "HEAD",
    headSha: input.headSha,
    body: input.body,
    changedPaths: input.changedPaths,
    labels: input.labels,
    actorId: identity.actor.id,
    actorKind: "service",
    eventSource: "mcp.suggest",
    eventAction: "suggest",
    eventAt: new Date().toISOString(),
  });

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

  const shadow: ShadowRoutingResult = await runShadowRouting({
    evidence: normalized.evidence,
    markers: normalized.markers,
    branchTaskIds: normalized.branchTaskIds,
    tasks: toTaskViews(snap.tasks),
    buckets: toBucketViews(snap.buckets),
    trackedRepos,
    operationalRepos,
    loadRegisterTimestamps: () => getRegisterInboundCompletions(),
  });

  const now = Date.now();
  const routingSessionId =
    (input.routingSessionId?.startsWith("rtx_")
      ? input.routingSessionId
      : mintRoutingSessionId()) as RoutingSessionId;

  // Control-plane session only — never creates Tasks or SharePoint rows.
  await upsertRoutingSession({
    id: routingSessionId,
    repoId: identity.repo,
    actorId: identity.actor.id,
    actorKind: "service",
    baseBranch: normalized.evidence.baseBranch ?? "main",
    sourceBranch: normalized.evidence.sourceBranch ?? normalized.evidence.branch ?? "HEAD",
    headSha: normalized.evidence.headSha ?? null,
    status: "active",
    absoluteExpiresAt: new Date(now + ABSOLUTE_TTL_MS).toISOString(),
    idleExpiresAt: new Date(now + IDLE_TTL_MS).toISOString(),
  });

  const limit =
    typeof input.detailLimit === "number" && input.detailLimit > 0
      ? Math.min(input.detailLimit, 10)
      : shadow.candidates.length;
  const sliced = shadow.candidates.slice(0, limit);

  const candidates: SuggestWorkCandidate[] = sliced.map((c) => ({
    ...c,
    link: taskLink(c.taskId),
  }));

  const candidateLinks = Object.fromEntries(
    candidates.map((c) => [c.taskId, c.link])
  );

  return {
    routingSessionId,
    ok: shadow.ok,
    failureReason: shadow.failureReason,
    candidates,
    reasons: shadow.reasons,
    derivedProjectId: shadow.derivedProjectId,
    policyVersion: shadow.policyVersion,
    scoringVersion: shadow.scoringVersion,
    deepLinks: {
      session: sessionDeepLink(routingSessionId),
      candidates: candidateLinks,
    },
    mcRoutingMarker: `MC-Routing: ${routingSessionId}`,
    operatorContext: identity.operatorEmail,
    evaluation: {
      autonomy,
      runtime: identity.runtime,
      outcomes: await loadRuntimeOutcomes(identity.runtime),
    },
  };
}

// Evaluation metrics feed the suggestion envelope (TASK-634) — fail-open so a
// metrics outage never blocks suggestions.
async function loadRuntimeOutcomes(runtime: string): Promise<AgentOutcomeMetrics | null> {
  try {
    const outcomes = await loadAgentOutcomes();
    return outcomes.find((o) => o.runtime === runtime) ?? null;
  } catch (err) {
    console.error(
      "[routing] outcome metrics unavailable for suggest envelope (fail-open): %s",
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
}

function jsonResult(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}

/** HTTP MCP registration for suggestion tools (mutation tools land in P8). */
export function registerRoutingSuggestTools(
  server: McpServer,
  identity: McpIdentity
): void {
  server.tool(
    "mc_suggest_work",
    "Suggest existing MC Tasks for current work. Returns routingSessionId + candidates without creating or linking Tasks.",
    {
      title: z.string().optional(),
      branch: z.string().optional(),
      baseBranch: z.string().optional(),
      sourceBranch: z.string().optional(),
      headSha: z.string().optional(),
      body: z.string().optional(),
      changedPaths: z.array(z.string()).optional(),
      labels: z.array(z.string()).optional(),
      routingSessionId: z.string().optional(),
      detailLimit: z.number().int().min(1).max(10).optional(),
    },
    async (args) => jsonResult(await actionSuggestWork(identity, args))
  );
}
