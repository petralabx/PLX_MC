// PATCH  /api/reporting/goals/entries/[id] — an Editor changes an entry's fields (TASK-2897).
// DELETE /api/reporting/goals/entries/[id] — an Editor deletes one: it stops
// counting and leaves the list, and its history is kept (soft delete).
// Both are audited; 404 when there is no such live entry.

import { z } from "zod";

import { ApiError, parseBody, route } from "@/lib/api/route";
import { ENTRY_PATCH, deleteEntry, requireGoalsRole, updateEntry } from "@/lib/reporting/goals";

export const dynamic = "force-dynamic";

const entryIdParam = z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/);

async function entryIdOf(ctx: { params: Promise<Record<string, string>> }): Promise<string> {
  const parsed = entryIdParam.safeParse((await ctx.params).id);
  if (!parsed.success) throw new ApiError("invalid_request", "The entry id must look like M001.");
  return parsed.data.toUpperCase();
}

export const PATCH = route(async (req, ctx) => {
  const actor = await requireGoalsRole("editor");
  const entryId = await entryIdOf(ctx);
  const body = await parseBody(req, ENTRY_PATCH);
  return { entry: await updateEntry(entryId, body, actor) };
});

export const DELETE = route(async (_req, ctx) => {
  const actor = await requireGoalsRole("editor");
  const entryId = await entryIdOf(ctx);
  await deleteEntry(entryId, actor);
  return { entryId, deleted: true };
});
