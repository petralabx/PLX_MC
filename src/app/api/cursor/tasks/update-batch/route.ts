// Metadata edits through the same action as HTTP MCP; stdio proxies here.
import { actionUpdateTasks, updateTasksSchema } from "@/lib/mcp/task-update-actions";
import { cursorRoute, parseCursorBody } from "@/lib/mcp/route";

export const POST = cursorRoute("mc_update_tasks", async (req, _ctx, identity) => {
  const body = await parseCursorBody(req, updateTasksSchema);
  return { data: await actionUpdateTasks(identity, body) };
});
