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
});

export const POST = cursorRoute("mc_checkout_task", async (req, _ctx, identity, meta) => {
  const { taskId, repo, agent, reuse, forceReason } = await parseCursorBody(req, checkoutSchema);
  const data = await actionCheckout(identity, taskId, { repo, agent, reuse, forceReason });
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
