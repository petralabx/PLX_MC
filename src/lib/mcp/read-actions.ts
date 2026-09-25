// MCP agent read tools (wave 4): mc_get_task, mc_list_checkouts,
// mc_search_knowledge, mc_verify_pr. Shared by the cursor REST routes and the
// HTTP MCP transport. Every tool authorizes task.read only — read tools never
// require a write grant — and applies the restricted-project ACL the same way
// mc_get_context does. None of them writes: mc_verify_pr computes the gate
// verdict with verifyPr({ record: false }).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ApiError } from "@/lib/api/route";
import { searchBrainAsk, searchStatusMessage } from "@/lib/brain-ask";
import { loadPrVerifyInput } from "@/lib/compliance/github-pr";
import * as complianceRepo from "@/lib/compliance/repo";
import { verifyPr } from "@/lib/compliance/service";
import { filterTasksByAcl, indexById } from "@/lib/permissions/project-acl";
import { aclPrincipalFromMcp, requireMcpActor } from "@/lib/routing/mutations/actors";
import { snapshot } from "@/lib/sync";
import { actionGetContext } from "./actions";
import type { McpIdentity } from "./auth";
import { GITHUB_SLUG_RE } from "./checkout-repo";
import { mcpJsonResult, taskLink } from "./envelope";

export const GET_TASK_EVENT_LIMIT = 25;
export const GET_TASK_CHECKOUT_LIMIT = 50;
// The agent's own reads land in mc_events (mcp.tool.invoked); keep them out of
// a task's history so they cannot crowd out checkouts, gates and completions.
const TASK_HISTORY_EXCLUDED_KINDS = ["mcp.tool.invoked"];

export const LIST_CHECKOUTS_DEFAULT_LIMIT = 50;
export const LIST_CHECKOUTS_MAX_LIMIT = 200;
export const SEARCH_KNOWLEDGE_DEFAULT_LIMIT = 8;
export const SEARCH_KNOWLEDGE_MAX_LIMIT = 25;

function clampLimit(value: number | undefined, fallback: number, max: number): number {
  return Number.isFinite(value) ? Math.min(Math.max(Math.floor(value as number), 1), max) : fallback;
}

function requireGithubSlug(value: string): string {
  const slug = value.trim();
  if (!GITHUB_SLUG_RE.test(slug)) {
    throw new ApiError("invalid_repo", "repo must be a full GitHub slug (e.g. petralabx/PLX_MC).", 400);
  }
  return slug;
}

function toCheckoutView(row: complianceRepo.DispatchListRow, now = Date.now()) {
  return {
    checkoutId: row.id,
    taskId: row.taskId,
    repo: row.repo,
    runtime: row.runtime,
    accountableHuman: row.accountableHuman,
    actorKind: row.actorKind,
    issuedAt: row.issuedAt,
    expiresAt: row.expiresAt,
    revoked: row.revoked,
    active: !row.revoked && new Date(row.expiresAt).getTime() > now,
  };
}

// ─── mc_get_task ─────────────────────────────────────────────────────────────

export async function actionGetTask(identity: McpIdentity, id: string) {
  const taskId = id.trim();
  requireMcpActor(identity, "task.read", { type: "task", id: taskId });
  // Same task + ACL scoping as mc_get_context depth:"full" for one task id.
  const context = await actionGetContext({ depth: "full", taskIds: [taskId] }, identity);
  const task = ("tasks" in context ? context.tasks : undefined)?.find((t) => t.id === taskId);
  if (!task) throw new ApiError("not_found", `unknown task ${taskId}`, 404);
  const [events, checkouts] = await Promise.all([
    complianceRepo.eventsForTask(taskId, {
      limit: GET_TASK_EVENT_LIMIT,
      excludeKinds: TASK_HISTORY_EXCLUDED_KINDS,
    }),
    complianceRepo.listDispatches({ taskId, limit: GET_TASK_CHECKOUT_LIMIT }),
  ]);
  return {
    taskId,
    task,
    accountableOwner: task.accountableOwner,
    evidence: task.evidence ?? null,
    checkouts: checkouts.map((row) => toCheckoutView(row)),
    events,
    link: taskLink(taskId),
  };
}

// ─── mc_list_checkouts ───────────────────────────────────────────────────────

export type ListCheckoutsInput = {
  repo?: string;
  taskId?: string;
  active?: boolean;
  limit?: number;
};

export async function actionListCheckouts(identity: McpIdentity, input: ListCheckoutsInput = {}) {
  requireMcpActor(identity, "task.read");
  const repo = input.repo?.trim() ? requireGithubSlug(input.repo) : undefined;
  const taskId = input.taskId?.trim() || undefined;
  const limit = clampLimit(input.limit, LIST_CHECKOUTS_DEFAULT_LIMIT, LIST_CHECKOUTS_MAX_LIMIT);
  const filter = {
    ...(repo ? { repo } : {}),
    ...(taskId ? { taskId } : {}),
    ...(input.active !== undefined ? { active: input.active } : {}),
    limit,
  };
  const [rows, snap] = await Promise.all([
    complianceRepo.listDispatches({ repo, taskId, active: input.active, limit }),
    snapshot(),
  ]);
  // Drop checkouts whose task sits in a restricted project this principal
  // cannot see (same side-channel rule as GET /api/state).
  const visible = new Set(
    filterTasksByAcl(
      snap.tasks,
      indexById(snap.buckets ?? []),
      indexById(snap.projects ?? []),
      aclPrincipalFromMcp(identity)
    ).map((t) => t.id)
  );
  const hidden = new Set(snap.tasks.filter((t) => !visible.has(t.id)).map((t) => t.id));
  const checkouts = rows.filter((row) => !hidden.has(row.taskId)).map((row) => toCheckoutView(row));
  return { checkouts, count: checkouts.length, filter };
}

// ─── mc_search_knowledge ─────────────────────────────────────────────────────

export async function actionSearchKnowledge(
  identity: McpIdentity,
  input: { q: string; limit?: number }
) {
  requireMcpActor(identity, "task.read");
  const q = (input.q ?? "").trim();
  if (!q) throw new ApiError("invalid_query", "q is required.", 400);
  const limit = clampLimit(input.limit, SEARCH_KNOWLEDGE_DEFAULT_LIMIT, SEARCH_KNOWLEDGE_MAX_LIMIT);
  const result = await searchBrainAsk(q, limit);
  return { ...result, message: searchStatusMessage(result) };
}

// ─── mc_verify_pr ────────────────────────────────────────────────────────────

export async function actionVerifyPr(identity: McpIdentity, input: { repo: string; pr: number }) {
  requireMcpActor(identity, "task.read");
  const repo = requireGithubSlug(input.repo);
  if (!Number.isInteger(input.pr) || input.pr <= 0) {
    throw new ApiError("invalid_request", "pr must be a positive PR number.", 400);
  }
  const { input: verifyInput, truncated } = await loadPrVerifyInput(repo, input.pr);
  const result = await verifyPr(verifyInput, { record: false });
  return {
    repo: verifyInput.repoFullName ?? repo,
    pr: input.pr,
    headSha: verifyInput.headSha,
    checkoutIds: verifyInput.checkoutIds ?? [],
    changedPathCount: verifyInput.changedPaths.length,
    changedPathsTruncated: truncated,
    ...result,
    recorded: false,
  };
}

// ─── HTTP MCP registration ───────────────────────────────────────────────────

export function registerAgentReadTools(server: McpServer, identity: McpIdentity): void {
  server.tool(
    "mc_get_task",
    "Read one MC task: the task (as mc_get_context depth:full), its accountable owner and evidence, its checkouts (dsp_* dispatches), and its recent mc_events history (newest first; excludes mcp.tool.invoked audit rows). Read-only; restricted-project tasks return not_found.",
    { id: z.string().min(1).describe("TASK-* id") },
    async ({ id }) => mcpJsonResult({ data: await actionGetTask(identity, id) })
  );

  server.tool(
    "mc_list_checkouts",
    "List checkout credentials (dsp_* dispatches), newest first. Filters: repo (full owner/name slug, exact match), taskId, active (true = unrevoked and unexpired; false = revoked or expired). Read-only.",
    {
      repo: z.string().min(1).optional().describe("Full GitHub slug, e.g. petralabx/PLX_MC"),
      taskId: z.string().min(1).optional(),
      active: z.boolean().optional(),
      limit: z.number().int().min(1).max(LIST_CHECKOUTS_MAX_LIMIT).optional(),
    },
    async (args) => {
      const { filter, ...data } = await actionListCheckouts(identity, args);
      return mcpJsonResult({ data, meta: { filter } });
    }
  );

  server.tool(
    "mc_search_knowledge",
    "Search the company brain (Ask the Brain / VMC knowledge). Each hit carries provenance: id, source, namespace, score. status is ok | not_configured | upstream_unreachable | upstream_error; zero hits with ok is a real empty result. Read-only.",
    {
      q: z.string().describe("Search text"),
      limit: z.number().int().min(1).max(SEARCH_KNOWLEDGE_MAX_LIMIT).optional(),
    },
    async (args) => mcpJsonResult({ data: await actionSearchKnowledge(identity, args) })
  );

  server.tool(
    "mc_verify_pr",
    "Compute the compliance-gate verdict for a PR (same verifier as /api/compliance/verify) from its MC-Checkout stamps, labels and changed files on GitHub. Read-only: nothing is recorded (recorded:false). The GitHub `compliance` check stays the merge authority.",
    {
      repo: z.string().min(1).describe("Full GitHub slug, e.g. petralabx/PLX_MC"),
      pr: z.number().int().positive().describe("PR number"),
    },
    async (args) => mcpJsonResult({ data: await actionVerifyPr(identity, args) })
  );
}
