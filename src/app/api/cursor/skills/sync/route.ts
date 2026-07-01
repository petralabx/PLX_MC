import { z } from "zod";

import { cursorRoute, parseCursorBody } from "@/lib/mcp/route";
import { actionSyncSkills } from "@/lib/mcp/skills-actions";

const syncSchema = z.object({
  packageId: z.string().min(1).optional(),
  localRegistry: z.unknown().optional(),
  runtimes: z.array(z.enum(["cursor", "claude"])).optional(),
});

export const POST = cursorRoute("mc_skills_sync", async (req) => {
  const body = await parseCursorBody(req, syncSchema);
  return { data: await actionSyncSkills(body) };
});
