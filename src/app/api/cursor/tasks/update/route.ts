// Metadata edits through the same action as HTTP MCP; stdio proxies here.
import { actionUpdateTask, updateTaskSchema } from "@/lib/mcp/task-update-actions";
import { cursorRoute, parseCursorBody } from "@/lib/mcp/route";

export const POST = cursorRoute("mc_update_task", async (req, _ctx, identity) => {
  const body = await parseCursorBody(req, updateTaskSchema);
  return { data: await actionUpdateTask(identity, body) };
});
