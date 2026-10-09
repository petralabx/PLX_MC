// Project lifecycle + metadata for stewards (TASK-2530): mc_update_project and
// mc_list_projects. Writes go through patchProject (the same path as
// PATCH /api/projects/{id}); the audited before/after lands in mc_events as
// project.updated. health stays an independent signal.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ApiError } from "@/lib/api/route";
import { appendEvent } from "@/lib/compliance/repo";
import { AGENTS, HUMANS } from "@/lib/mc-data/data";
import { isProjectClosed } from "@/lib/mc-data/helpers";
import type { Project, StageKey } from "@/lib/mc-data/types";
import { isKnownServicePrincipal } from "@/lib/permissions";
import { assertProjectIdAccess } from "@/lib/permissions/project-acl-guard";
import { filterProjectsByAcl } from "@/lib/permissions/project-acl";
import { aclPrincipalFromMcp, requireMcpActor } from "@/lib/routing/mutations/actors";
import { patchProject, snapshot } from "@/lib/sync";
import { getProjects } from "@/lib/sync/repo";
import type { McpIdentity } from "./auth";
import { mcpJsonResult } from "./envelope";
import { assertMcpToolAllowed } from "./tool-allowlist";

const DONE_STAGES: readonly StageKey[] = ["merged", "verified"];

export const updateProjectSchema = z
  .object({
    projectId: z.string().trim().min(1).max(128),
    status: z.enum(["active", "closed"]).optional().describe("closed hides the project from nav, counts and pickers and blocks new tasks/buckets; active reopens it"),
    owner: z.string().trim().min(1).max(320).optional().describe("Known person id/email, agent id or MCP service principal id"),
    description: z.string().max(32_000).optional(),
    name: z.string().trim().min(1).max(255).optional(),
    note: z.string().trim().max(2_000).optional().describe("Reason, recorded on the project.updated audit event"),
  })
  .strict()
  .refine(
    (body) =>
      body.status !== undefined ||
      body.owner !== undefined ||
      body.description !== undefined ||
      body.name !== undefined,
    { message: "Provide at least one of status, owner, description or name." }
  );

export const listProjectsSchema = z
  .object({
    status: z.enum(["active", "closed", "all"]).optional().describe("Default active"),
    q: z.string().trim().max(200).optional().describe("Case-insensitive match against project id or name"),
  })
  .strict();

/** Canonical owner id for a known person, agent or service principal; null when unknown. */
export function resolveKnownProjectOwner(raw: string): string | null {
  const needle = raw.trim().toLowerCase();
  const human = Object.values(HUMANS).find(
    (h) => h.id.toLowerCase() === needle || (h.email ?? "").toLowerCase() === needle
  );
  if (human) return human.id;
  const agent = Object.values(AGENTS).find((a) => a.id.toLowerCase() === needle);
  if (agent) return agent.id;
  return isKnownServicePrincipal(needle) ? needle : null;
}

function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new ApiError(
      "invalid_request",
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
      400
    );
  }
  return parsed.data;
}

export async function actionUpdateProject(identity: McpIdentity, input: unknown) {
  assertMcpToolAllowed(identity, "mc_update_project");
  const body = parseInput(updateProjectSchema, input);
  // Stewards are the reviewed MCP principals holding project.update; the
  // restricted-project ACL still applies on top.
  const authorized = requireMcpActor(identity, "project.update", {
    type: "project",
    id: body.projectId,
  });
  await assertProjectIdAccess(body.projectId, aclPrincipalFromMcp(identity));
  const existing = (await getProjects()).find((p) => p.id === body.projectId);
  if (!existing) throw new ApiError("not_found", `unknown project ${body.projectId}`, 404);

  let owner: string | undefined;
  if (body.owner !== undefined) {
    const resolved = resolveKnownProjectOwner(body.owner);
    if (!resolved) {
      throw new ApiError(
        "invalid_owner",
        `Unknown owner "${body.owner}". Use a known person id or email, an agent id, or an MCP service principal id.`,
        422
      );
    }
    owner = resolved;
  }

  const requested: Partial<Pick<Project, "name" | "owner" | "desc" | "status">> = {
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(owner !== undefined ? { owner } : {}),
    ...(body.description !== undefined ? { desc: body.description } : {}),
    ...(body.status !== undefined ? { status: body.status } : {}),
  };
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  const changed: typeof requested = {};
  for (const key of Object.keys(requested) as (keyof typeof requested)[]) {
    const previous = key === "status" ? (existing.status ?? "active") : existing[key];
    if (previous === requested[key]) continue;
    Object.assign(changed, { [key]: requested[key] });
    before[key] = previous;
    after[key] = requested[key];
  }
  if (Object.keys(changed).length === 0) {
    return { projectId: existing.id, project: existing, changed: [], unchanged: true };
  }

  const project = await patchProject(existing.id, changed, authorized.auditLabel);
  if (!project) throw new ApiError("not_found", `unknown project ${body.projectId}`, 404);
  const eventSeq = await appendEvent({
    kind: "project.updated",
    actor: `${identity.runtime}:${identity.operatorEmail}`,
    repo: identity.repo,
    payload: {
      projectId: existing.id,
      servicePrincipalId: identity.servicePrincipalId,
      workerId: identity.workerId,
      before,
      after,
      ...(body.note ? { note: body.note } : {}),
    },
  });
  return {
    projectId: project.id,
    project,
    changed: Object.keys(changed),
    before,
    after,
    eventSeq,
    sync: project.sync,
  };
}

export async function actionListProjects(identity: McpIdentity, input: unknown = {}) {
  assertMcpToolAllowed(identity, "mc_list_projects");
  const { status = "active", q } = parseInput(listProjectsSchema, input ?? {});
  requireMcpActor(identity, "task.read");
  const snap = await snapshot();
  const query = q?.toLowerCase();
  const visible = filterProjectsByAcl(snap.projects ?? [], aclPrincipalFromMcp(identity));
  const bucketsByProject = new Map<string, string[]>();
  for (const bucket of snap.buckets ?? []) {
    if (!bucket.project) continue;
    bucketsByProject.set(bucket.project, [...(bucketsByProject.get(bucket.project) ?? []), bucket.id]);
  }
  const tasksByBucket = new Map<string, { open: number; done: number }>();
  for (const task of snap.tasks) {
    const tally = tasksByBucket.get(task.bucket) ?? { open: 0, done: 0 };
    if (DONE_STAGES.includes(task.stage)) tally.done += 1;
    else tally.open += 1;
    tasksByBucket.set(task.bucket, tally);
  }
  const projects = visible
    .filter((project) => {
      if (status !== "all" && (isProjectClosed(project) ? "closed" : "active") !== status) return false;
      return !query || project.id.toLowerCase().includes(query) || project.name.toLowerCase().includes(query);
    })
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((project) => {
      const bucketIds = bucketsByProject.get(project.id) ?? [];
      const counts = bucketIds.reduce(
        (sum, id) => {
          const tally = tasksByBucket.get(id);
          return { open: sum.open + (tally?.open ?? 0), done: sum.done + (tally?.done ?? 0) };
        },
        { open: 0, done: 0 }
      );
      return {
        id: project.id,
        name: project.name,
        owner: project.owner,
        status: project.status ?? "active",
        health: project.health,
        bucketCount: bucketIds.length,
        openTaskCount: counts.open,
        doneTaskCount: counts.done,
        closedAt: project.closedAt ?? null,
      };
    });
  return { projects, count: projects.length, filter: { status, ...(query ? { q } : {}) } };
}

export function registerProjectTools(server: McpServer, identity: McpIdentity): void {
  server.registerTool("mc_update_project", {
    description: "Steward edit of a Mission Control project: {projectId, status?, owner?, description?, name?, note?}, at least one field. status=closed removes the project from active nav, counts and pickers and blocks new tasks/buckets in it; status=active reopens. owner must be a known person, agent or service principal. Audits project.updated with before/after; queues the Projects mirror (status is MC-side only). health is not changed here.",
    inputSchema: updateProjectSchema,
  }, async (args) => mcpJsonResult({ data: await actionUpdateProject(identity, args) }));
  server.registerTool("mc_list_projects", {
    description: "List projects with id, name, owner, status, health, bucketCount, openTaskCount, doneTaskCount and closedAt. status: active (default) | closed | all; q matches id or name. Restricted projects stay hidden by ACL.",
    inputSchema: listProjectsSchema,
  }, async (args) => mcpJsonResult({ data: await actionListProjects(identity, args) }));
}
