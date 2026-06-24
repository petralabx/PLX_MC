import { z } from "zod";
import { cursorRoute, parseCursorBody } from "@/lib/mcp/route";
import { actionComplete } from "@/lib/mcp/actions";
import { taskLink } from "@/lib/mcp/envelope";

const completeSchema = z.object({
  checkoutId: z.string().min(1),
  summary: z.string().min(1),
  commitSha: z.string().optional(),
  prUrl: z.string().optional(),
  verificationCommands: z.array(z.string()).optional(),
  filesChanged: z.array(z.string()).optional(),
});

export const POST = cursorRoute("mc_complete_task", async (req, _ctx, _identity, meta) => {
  const body = await parseCursorBody(req, completeSchema);
  const data = await actionComplete(body);
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
