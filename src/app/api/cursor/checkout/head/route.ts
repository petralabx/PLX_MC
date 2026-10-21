// POST /api/cursor/checkout/head — mc_record_checkout_head (TASK-3410): the
// launcher that took a checkout records a head it pushed on the checkout's SHA chain.
import { cursorRoute, parseCursorBody } from "@/lib/mcp/route";
import { actionRecordCheckoutHead, recordCheckoutHeadSchema } from "@/lib/mcp/checkout-head-actions";

export const POST = cursorRoute("mc_record_checkout_head", async (req, _ctx, identity) => {
  const input = await parseCursorBody(req, recordCheckoutHeadSchema);
  return { data: await actionRecordCheckoutHead(identity, input) };
});
