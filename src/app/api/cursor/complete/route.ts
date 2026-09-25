import { z } from "zod";
import { cursorRoute, parseCursorBody } from "@/lib/mcp/route";
import { actionComplete, completeTaskInputShape } from "@/lib/mcp/actions";
import { taskLink } from "@/lib/mcp/envelope";

const completeSchema = z.object(completeTaskInputShape);

export const POST = cursorRoute("mc_complete_task", async (req, _ctx, identity, meta) => {
  const body = await parseCursorBody(req, completeSchema);
  const data = await actionComplete(identity, body);
  return {
    data,
    meta: {
      links: {
        ...meta.links,
        task: data.taskId ? taskLink(data.taskId) : undefined,
      },
      evidence: data.evidence,
      sync: data.sync,
    },
  };
});
