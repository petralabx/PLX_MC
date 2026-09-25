// GET /api/cursor/checkouts — mc_list_checkouts: dsp_* dispatches filtered by
// repo (owner/name), taskId, active. Read-only (task.read).

import { ApiError } from "@/lib/api/route";
import { actionListCheckouts } from "@/lib/mcp/read-actions";
import { cursorRoute } from "@/lib/mcp/route";

function parseActive(raw: string | null): boolean | undefined {
  if (raw === null || raw === "") return undefined;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new ApiError("invalid_request", "active must be true or false.");
}

export const GET = cursorRoute("mc_list_checkouts", async (req, _ctx, identity) => {
  const sp = new URL(req.url).searchParams;
  const limitRaw = sp.get("limit");
  const { filter, ...data } = await actionListCheckouts(identity, {
    repo: sp.get("repo") ?? undefined,
    taskId: sp.get("taskId") ?? undefined,
    active: parseActive(sp.get("active")),
    limit: limitRaw ? Number(limitRaw) : undefined,
  });
  return { data, meta: { filter } };
});
