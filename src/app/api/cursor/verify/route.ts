// GET /api/cursor/verify?repo=owner/name&pr=N — mc_verify_pr: the verdict
// /api/compliance/verify would compute for the PR, without recording it.
// Read-only (task.read); the GitHub `compliance` check stays the merge gate.

import { actionVerifyPr } from "@/lib/mcp/read-actions";
import { cursorRoute } from "@/lib/mcp/route";

export const GET = cursorRoute("mc_verify_pr", async (req, _ctx, identity) => {
  const sp = new URL(req.url).searchParams;
  return {
    data: await actionVerifyPr(identity, {
      repo: sp.get("repo") ?? "",
      pr: Number(sp.get("pr") ?? ""),
    }),
  };
});
