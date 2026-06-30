import { cursorRoute } from "@/lib/mcp/route";
import { actionSelfCheck } from "@/lib/mcp/actions";

export const GET = cursorRoute("mc_self_check", async (_req, _ctx, identity) => ({
  data: await actionSelfCheck(identity),
}));
