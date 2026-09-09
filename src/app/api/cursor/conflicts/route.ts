import { cursorRoute } from "@/lib/mcp/route";
import { actionListConflicts } from "@/lib/mcp/sync-actions";

export const GET = cursorRoute("mc_list_conflicts", async (req, _ctx, identity) => {
  const sp = new URL(req.url).searchParams;
  const limitRaw = sp.get("limit");
  const result = await actionListConflicts(identity, {
    entityId: sp.get("entityId") ?? undefined,
    taskId: sp.get("taskId") ?? undefined,
    field: sp.get("field") ?? undefined,
    limit: limitRaw ? Number(limitRaw) : undefined,
  });
  const { filter, ...data } = result;
  return { data, meta: { filter } };
});
