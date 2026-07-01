import { cursorRoute } from "@/lib/mcp/route";
import { actionListSkills } from "@/lib/mcp/skills-actions";

export const GET = cursorRoute("mc_skills_list", async (req) => {
  const url = new URL(req.url);
  return {
    data: await actionListSkills({
      q: url.searchParams.get("q") ?? undefined,
      tag: url.searchParams.get("tag") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
    }),
  };
});
