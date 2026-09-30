import { z } from "zod";
import { cursorRoute, parseCursorBody } from "@/lib/mcp/route";
import {
  actionDismissConflict,
  actionDismissConflicts,
  dismissConflictSchema,
  dismissConflictsSchema,
} from "@/lib/mcp/sync-actions";

const dismissSchema = z.union([dismissConflictSchema, dismissConflictsSchema]);

export const POST = cursorRoute("mc_dismiss_conflict", async (req, _ctx, identity) => {
  const body = await parseCursorBody(req, dismissSchema);
  return { data: "conflictIds" in body
    ? await actionDismissConflicts(identity, body)
    : await actionDismissConflict(identity, body) };
});
