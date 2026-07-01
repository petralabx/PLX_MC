import { z } from "zod";

import { cursorRoute, parseCursorBody } from "@/lib/mcp/route";
import { actionInstallSkills } from "@/lib/mcp/skills-actions";

const installSchema = z.object({
  ids: z.array(z.string().min(1)).optional(),
  mode: z.enum(["install", "sync"]).default("install"),
  runtimes: z.array(z.enum(["cursor", "claude"])).optional(),
  projectRoot: z.string().min(1).optional(),
  localRegistry: z.unknown().optional(),
});

export const POST = cursorRoute("mc_skills_install", async (req) => {
  const body = await parseCursorBody(req, installSchema);
  return { data: await actionInstallSkills(body) };
});
