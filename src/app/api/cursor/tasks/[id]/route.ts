// GET /api/cursor/tasks/{id} — mc_get_task: one task with its accountable
// owner, evidence, checkouts and recent event history. Read-only (task.read).

import { taskLink } from "@/lib/mcp/envelope";
import { actionGetTask } from "@/lib/mcp/read-actions";
import { cursorRoute } from "@/lib/mcp/route";

export const GET = cursorRoute("mc_get_task", async (_req, ctx, identity, meta) => {
  const { id } = await ctx.params;
  const data = await actionGetTask(identity, id);
  return { data, meta: { links: { ...meta.links, task: taskLink(data.taskId) } } };
});
