import { z } from "zod";
import { cursorRoute, parseCursorBody } from "@/lib/mcp/route";
import { actionProgress } from "@/lib/mcp/actions";
import { taskLink } from "@/lib/mcp/envelope";

const progressSchema = z.object({
  taskId: z.string().min(1),
  stage: z
    .enum(["backlog", "specced", "approved", "planned", "progress", "qa", "review", "merged", "verified"])
    .optional(),
  notes: z.string().optional(),
  progressPct: z.number().min(0).max(100).optional(),
});

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
