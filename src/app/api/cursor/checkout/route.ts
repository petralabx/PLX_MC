import { z } from "zod";
import { cursorRoute, parseCursorBody } from "@/lib/mcp/route";
import { actionCheckout } from "@/lib/mcp/actions";
import { taskLink } from "@/lib/mcp/envelope";

const checkoutSchema = z.object({
  taskId: z.string().min(1),
  repo: z.string().min(1).optional(),
  agent: z.string().regex(/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/).optional(),
  reuse: z.boolean().optional(),
  forceReason: z.string().trim().min(1).max(2000).optional(),
  baseSha: z.string().trim().regex(/^[0-9a-fA-F]{40}$/).optional(),
  launchId: z.string().trim().regex(/^[A-Za-z0-9._:-]{1,128}$/).optional(),
  branch: z.string().trim().regex(/^[A-Za-z0-9._/-]{1,255}$/).optional(),
});

export const POST = cursorRoute("mc_checkout_task", async (req, _ctx, identity, meta) => {
  const { taskId, repo, agent, reuse, forceReason, baseSha, launchId, branch } = await parseCursorBody(req, checkoutSchema);
  const data = await actionCheckout(identity, taskId, { repo, agent, reuse, forceReason, baseSha, launchId, branch });
  return {
    data,
    meta: {
      links: {
        ...meta.links,
        task: taskLink(taskId),
        checkoutStamp: data.prBodyLine,
      },
      sync: data.sync,
    },
  };
});
