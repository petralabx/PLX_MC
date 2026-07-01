import { z } from "zod";

import { cursorRoute, parseCursorBody } from "@/lib/mcp/route";
import { createSkillSubmission } from "@/lib/skills-directory";

const submitSchema = z.object({
  skillId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  submitterEmail: z.string().email(),
  repoUrl: z.string().url().optional(),
  contentUrl: z.string().url().optional(),
  notes: z.string().optional(),
});

export const POST = cursorRoute("mc_skills_submit", async (req) => {
  const body = await parseCursorBody(req, submitSchema);
  return { data: await createSkillSubmission(body) };
});
