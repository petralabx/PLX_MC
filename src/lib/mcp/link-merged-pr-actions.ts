// mc_link_merged_pr (TASK-2559): a steward-only, audited way to attach an
// already-merged PR to the task it delivered, with no checkout and no edit of
// the PR body. Merge facts (state, head SHA, merge SHA) come from GitHub, never
// from the caller. The only stage effect is the normal compliance projection
// (promote to merged); Verified is never set here.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ApiError } from "@/lib/api/route";
import { prLinkKeys } from "@/lib/compliance/backfill";
import { loadMergedPrFacts, type MergedPrFacts } from "@/lib/compliance/github-pr";
import { projectPullRequest } from "@/lib/compliance/projection";
import { appendEvent } from "@/lib/compliance/repo";
import type { PullRequest, Task } from "@/lib/mc-data/types";
import { assertTaskProjectAccess } from "@/lib/permissions/project-acl-guard";
import { aclPrincipalFromMcp, requireMcpActor } from "@/lib/routing/mutations/actors";
import { getEntities, getEntity, getRepos } from "@/lib/sync/repo";
import { patchTask } from "@/lib/sync";
import type { McpIdentity } from "./auth";
import { mcpJsonResult } from "./envelope";
import { assertMcpToolAllowed } from "./tool-allowlist";

export const LINK_MERGED_PR_EVENT = "task.pr.linked";
const BELOW_MERGED = new Set(["backlog", "specced", "approved", "planned", "progress", "qa", "review"]);

export const linkMergedPrSchema = z
  .object({
    taskId: z.string().trim().regex(/^TASK-\d+$/, "taskId must be a TASK-* id"),
    repo: z.string().trim().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, "repo must be owner/name"),
    prNumber: z.number().int().positive(),
    reason: z.string().trim().min(1).max(2_000),
    override: z.boolean().optional().describe("Allow a PR already linked to a different task; needs overrideReason"),
    overrideReason: z.string().trim().min(1).max(2_000).optional(),
  })
  .strict()
  .refine((body) => !body.override || !!body.overrideReason, {
    message: "overrideReason is required when override is true.",
    path: ["overrideReason"],
  });

export type LinkMergedPrInput = z.infer<typeof linkMergedPrSchema>;

export interface LinkMergedPrDeps {
  loadFacts: (repoFullName: string, prNumber: number) => Promise<MergedPrFacts>;
}

const bareName = (slug: string) => slug.slice(slug.lastIndexOf("/") + 1);

export async function actionLinkMergedPr(
  identity: McpIdentity,
  input: unknown,
  deps: LinkMergedPrDeps = { loadFacts: loadMergedPrFacts }
) {
  assertMcpToolAllowed(identity, "mc_link_merged_pr");
  const parsed = linkMergedPrSchema.safeParse(input);
  if (!parsed.success) {
    throw new ApiError(
      "invalid_request",
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
      400
    );
  }
  const body = parsed.data;
  // Capability on the authenticated principal; the operator email is audit only.
  const authorized = requireMcpActor(identity, "task.link_merged_pr", { type: "task", id: body.taskId });

  const row = await getEntity("task", body.taskId);
  if (!row) throw new ApiError("not_found", `unknown task ${body.taskId}`, 404);
  const task = row.data as unknown as Task;
  await assertTaskProjectAccess(task.id, aclPrincipalFromMcp(identity));

  const repoName = bareName(body.repo);
  const sameLink = (p: PullRequest) => bareName(p.repo).toLowerCase() === repoName.toLowerCase() && p.num === body.prNumber;
  if ((task.prs ?? []).some(sameLink)) {
    return { taskId: task.id, repo: body.repo, prNumber: body.prNumber, stage: task.stage, linked: false, unchanged: true };
  }

  const facts = await deps.loadFacts(body.repo, body.prNumber);
  if (facts.repoFullName.toLowerCase() !== body.repo.toLowerCase()) {
    throw new ApiError("repo_mismatch", `PR #${body.prNumber} belongs to ${facts.repoFullName}, not ${body.repo}.`, 422);
  }
  if (!facts.merged) {
    throw new ApiError(
      "pr_not_merged",
      `PR #${body.prNumber} in ${body.repo} is ${facts.state === "open" ? "open" : "closed without merging"}; only merged PRs can be linked.`,
      409
    );
  }
  if (!facts.headSha || !facts.mergeSha) {
    throw new ApiError("github_error", "GitHub did not return head and merge SHAs for the PR.", 502);
  }

  const repos = await getRepos();
  const key = `${repoName.toLowerCase()}#${body.prNumber}`;
  const otherTaskIds = (await getEntities("task"))
    .filter((r) => r.id !== task.id && prLinkKeys([r.data as unknown as Task], repos).has(key))
    .map((r) => r.id);
  if (otherTaskIds.length > 0 && !body.override) {
    throw new ApiError(
      "pr_linked_elsewhere",
      `PR #${body.prNumber} in ${body.repo} is already linked to ${otherTaskIds.join(", ")}. Pass override=true with overrideReason to link it here too.`,
      409
    );
  }

  const actor = `${identity.runtime}:${identity.operatorEmail}`;
  const link: PullRequest = { repo: repoName, num: body.prNumber, status: "merged", title: facts.title };
  if (BELOW_MERGED.has(task.stage)) {
    // The normal merged-PR projection: promote, record prs + merge, audit task.promoted.
    await projectPullRequest(
      {
        action: "closed",
        merged: true,
        repo: repoName,
        repoFullName: body.repo,
        prNumber: body.prNumber,
        headSha: facts.headSha,
        mergeSha: facts.mergeSha,
        branch: "",
        title: facts.title,
        author: "",
        labels: [],
        checkoutId: null,
        checkoutIds: [],
      },
      { actorKind: "agent", actorIdentity: identity.servicePrincipalId, taskIds: [task.id], sparse: false }
    );
  }
  // Already merged/verified keeps its stage; the projection kill switch only skips promotion.
  const after = (await getEntity("task", task.id))?.data as unknown as Task | undefined;
  if (!(after?.prs ?? []).some(sameLink)) {
    await patchTask(
      task.id,
      {
        prs: [...(after?.prs ?? task.prs ?? []), link],
        ...(task.merge ? {} : { merge: { sha: facts.mergeSha, on: new Date().toISOString().slice(0, 10) } }),
        activityLine: {
          who: authorized.auditLabel,
          what: `PR #${body.prNumber} (${body.repo}) linked as delivery evidence (mc_link_merged_pr)`,
          kind: "move",
        },
      },
      authorized.auditLabel
    );
  }

  const stageAfter = ((await getEntity("task", task.id))?.data as unknown as Task | undefined)?.stage ?? task.stage;
  const eventSeq = await appendEvent({
    kind: LINK_MERGED_PR_EVENT,
    actor,
    repo: body.repo,
    taskId: task.id,
    pr: String(body.prNumber),
    payload: {
      servicePrincipalId: identity.servicePrincipalId,
      workerId: identity.workerId,
      reason: body.reason,
      repo: body.repo,
      prNumber: body.prNumber,
      headSha: facts.headSha,
      mergeSha: facts.mergeSha,
      override: body.override === true,
      overrideReason: body.override ? body.overrideReason : null,
      otherTaskIds,
      stageBefore: task.stage,
      stageAfter,
    },
    dedupKey: `${LINK_MERGED_PR_EVENT}:${body.repo.toLowerCase()}:${body.prNumber}:${task.id}`,
  });
  return {
    taskId: task.id,
    repo: body.repo,
    prNumber: body.prNumber,
    headSha: facts.headSha,
    mergeSha: facts.mergeSha,
    stage: stageAfter,
    promoted: stageAfter !== task.stage,
    linked: true,
    unchanged: false,
    override: body.override === true,
    eventSeq,
  };
}

export function registerLinkMergedPrTools(server: McpServer, identity: McpIdentity): void {
  server.registerTool("mc_link_merged_pr", {
    description: "Steward-only: attach an already-merged PR to the task it delivered, with no checkout and no PR-body edit. {taskId, repo (owner/name), prNumber, reason, override?, overrideReason?}. Merged state, head SHA and merge SHA are read from GitHub. Refuses open or closed-unmerged PRs and a PR already linked to another task unless override=true with overrideReason. Records task.prs, audits task.pr.linked, and applies only the normal merged-PR promotion to merged; never sets Verified. Repeating the same link is a no-op. Not available to non-steward principals (403).",
    inputSchema: linkMergedPrSchema,
  }, async (args) => mcpJsonResult({ data: await actionLinkMergedPr(identity, args) }));
}
