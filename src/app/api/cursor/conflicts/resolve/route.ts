import { z } from "zod";
import { ApiError } from "@/lib/api/route";
import { cursorRoute, parseCursorBody } from "@/lib/mcp/route";
import {
  actionResolveConflict,
  actionResolveConflicts,
  conflictResolutionSchema,
} from "@/lib/mcp/sync-actions";

const resolveSchema = z.union([
  z.object({
    conflictId: z.string().min(1),
    resolution: conflictResolutionSchema,
  }),
  z.object({
    conflictIds: z.array(z.string().min(1)).min(1),
    resolution: conflictResolutionSchema,
  }),
]);

export const POST = cursorRoute("mc_resolve_conflict", async (req, _ctx, identity) => {
  const body = await parseCursorBody(req, resolveSchema);
  if ("conflictIds" in body) {
    return { data: await actionResolveConflicts(identity, body) };
  }
  if (!("conflictId" in body)) {
    throw new ApiError("invalid_request", "conflictId or conflictIds is required.");
  }
  return { data: await actionResolveConflict(identity, body) };
});
