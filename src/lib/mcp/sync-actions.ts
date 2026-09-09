// MCP sync conflict list + resolve. List is read (task.read). Resolve uses
// the same engine path as the Entra console, authorized by the durable MCP
// principal + sync.mutate (not browser oid).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ApiError } from "@/lib/api/route";
import { requireMcpActor } from "@/lib/routing/mutations/actors";
import { resolveConflict } from "@/lib/sync/engine";
import { listOpenConflicts } from "@/lib/sync/repo";
import type { McpIdentity } from "./auth";

export const CONFLICT_RESOLUTIONS = ["keep_mc", "keep_sp"] as const;
export type ConflictResolution = (typeof CONFLICT_RESOLUTIONS)[number];

export const conflictResolutionSchema = z.enum(CONFLICT_RESOLUTIONS);

export const resolveConflictSchema = z.object({
  conflictId: z.string().min(1),
  resolution: conflictResolutionSchema,
});

export const resolveConflictsSchema = z.object({
  conflictIds: z.array(z.string().min(1)).min(1),
  resolution: conflictResolutionSchema,
});

export type ResolveConflictInput = z.infer<typeof resolveConflictSchema>;
export type ResolveConflictsInput = z.infer<typeof resolveConflictsSchema>;

export const LIST_CONFLICTS_DEFAULT_LIMIT = 200;
export const LIST_CONFLICTS_MAX_LIMIT = 500;

export const listConflictsSchema = z.object({
  entityId: z.string().min(1).optional(),
  taskId: z.string().min(1).optional(),
  field: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(LIST_CONFLICTS_MAX_LIMIT).optional(),
});

export type ListConflictsInput = z.infer<typeof listConflictsSchema>;

export type ListConflictsFilter = {
  entityId?: string;
  field?: string;
  limit: number;
};

/** Resolve entityId / taskId aliases; reject conflicting values. */
export function resolveListConflictsFilter(input: ListConflictsInput = {}): ListConflictsFilter {
  const entityIdRaw = input.entityId?.trim() ?? "";
  const taskIdRaw = input.taskId?.trim() ?? "";
  if (entityIdRaw && taskIdRaw && entityIdRaw !== taskIdRaw) {
    throw new ApiError(
      "invalid_request",
      "Provide only one of entityId or taskId (they are aliases); conflicting values were sent."
    );
  }
  const entityId = entityIdRaw || taskIdRaw;
  const field = input.field?.trim() ?? "";
  const requested = input.limit;
  const limit = Number.isFinite(requested)
    ? Math.min(Math.max(requested as number, 1), LIST_CONFLICTS_MAX_LIMIT)
    : LIST_CONFLICTS_DEFAULT_LIMIT;
  return {
    ...(entityId ? { entityId } : {}),
    ...(field ? { field } : {}),
    limit,
  };
}

export function mapConflictResolution(resolution: ConflictResolution): "mc" | "sp" {
  return resolution === "keep_mc" ? "mc" : "sp";
}

function jsonResult(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}

export async function actionResolveConflict(
  identity: McpIdentity,
  input: ResolveConflictInput
) {
  const authorized = requireMcpActor(identity, "sync.mutate", { type: "sync" });
  const winner = mapConflictResolution(input.resolution);
  const resolved = await resolveConflict(input.conflictId, winner, authorized.actorId);
  if (!resolved) {
    throw new ApiError(
      "not_found",
      `unknown or already-resolved conflict ${input.conflictId}`,
      404
    );
  }
  return {
    resolved: true,
    conflictId: input.conflictId,
    resolution: input.resolution,
    winner,
  };
}

export async function actionResolveConflicts(
  identity: McpIdentity,
  input: ResolveConflictsInput
) {
  const authorized = requireMcpActor(identity, "sync.mutate", { type: "sync" });
  const winner = mapConflictResolution(input.resolution);
  const results = [];
  for (const conflictId of input.conflictIds) {
    const resolved = await resolveConflict(conflictId, winner, authorized.actorId);
    results.push(
      resolved
        ? { conflictId, resolved: true }
        : {
            conflictId,
            resolved: false,
            error: `unknown or already-resolved conflict ${conflictId}`,
          }
    );
  }
  return {
    resolution: input.resolution,
    winner,
    results,
    resolvedCount: results.filter((row) => row.resolved).length,
  };
}

export async function actionListConflicts(identity: McpIdentity, input: ListConflictsInput = {}) {
  requireMcpActor(identity, "task.read", { type: "sync" });
  const filter = resolveListConflictsFilter(input);
  const open = await listOpenConflicts();
  let conflicts = open;
  if (filter.entityId) {
    conflicts = conflicts.filter((row) => row.entityId === filter.entityId);
  }
  if (filter.field) {
    const needle = filter.field.toLowerCase();
    conflicts = conflicts.filter((row) => row.field.toLowerCase() === needle);
  }
  return {
    conflicts: conflicts.slice(0, filter.limit),
    total: conflicts.length,
    filter,
  };
}

/** HTTP MCP registration for SharePoint conflict list + resolve (TASK-1467/1473). */
export function registerSyncConflictTools(server: McpServer, identity: McpIdentity): void {
  server.tool(
    "mc_list_conflicts",
    "List open SharePoint Sync conflicts (cf-* ids) so Ledger can Keep MC leftovers. Optional filters: entityId / taskId, field, limit. Auth is the MCP principal + task.read, not Entra. Does not resolve; never marks a task Verified.",
    {
      entityId: z.string().min(1).optional(),
      taskId: z.string().min(1).optional(),
      field: z.string().min(1).optional(),
      limit: z.number().int().min(1).max(LIST_CONFLICTS_MAX_LIMIT).optional(),
    },
    async (args) => {
      const result = await actionListConflicts(identity, args);
      const { filter, ...data } = result;
      return jsonResult({ data, meta: { filter } });
    }
  );

  server.tool(
    "mc_resolve_conflict",
    "Resolve one SharePoint Sync conflict. resolution is required: keep_mc (Ledger default for stage lag) or keep_sp (explicit only — never silent). Same engine as the Sync console; auth is the MCP principal + sync.mutate, not Entra. Agents never mark a task Verified.",
    {
      conflictId: z.string().min(1),
      resolution: conflictResolutionSchema,
    },
    async (args) => jsonResult(await actionResolveConflict(identity, args))
  );

  server.tool(
    "mc_resolve_conflicts",
    "Resolve a batch of SharePoint Sync conflicts with one explicit resolution (keep_mc | keep_sp). Never default keep_sp. Ledger owns Keep MC for stage-lag leftovers. Agents never mark a task Verified.",
    {
      conflictIds: z.array(z.string().min(1)).min(1),
      resolution: conflictResolutionSchema,
    },
    async (args) => jsonResult(await actionResolveConflicts(identity, args))
  );
}
