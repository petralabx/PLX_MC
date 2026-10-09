import { z } from "zod";
import { cursorRoute, parseCursorBody } from "@/lib/mcp/route";
import { actionProgress, progressSchemaShape } from "@/lib/mcp/actions";
import { taskLink } from "@/lib/mcp/envelope";

const progressSchema = z.object(progressSchemaShape);

export const POST = cursorRoute("mc_report_progress", async (req, _ctx, identity, meta) => {
  const body = await parseCursorBody(req, progressSchema);
  const data = await actionProgress(identity, body);
  return {
    data,
    meta: {
      links: { ...meta.links, task: taskLink(body.taskId) },
      sync: data.sync,
    },
  };
});
