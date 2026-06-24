import { z } from "zod";
import { cursorRoute, parseCursorBody } from "@/lib/mcp/route";
import { actionCheckout } from "@/lib/mcp/actions";
import { taskLink } from "@/lib/mcp/envelope";

const checkoutSchema = z.object({
  taskId: z.string().min(1),
});

export const POST = cursorRoute("mc_checkout_task", async (req, _ctx, identity, meta) => {
  const { taskId } = await parseCursorBody(req, checkoutSchema);
  const data = await actionCheckout(identity, taskId);
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
