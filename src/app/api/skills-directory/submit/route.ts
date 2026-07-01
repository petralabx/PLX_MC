import { z } from "zod";

import { parseBody, route } from "@/lib/api/route";
import { createSkillSubmission, SKILL_ID_PATTERN } from "@/lib/skills-directory";

const submitSchema = z.object({
  skillId: z.string().regex(SKILL_ID_PATTERN),
  title: z.string().min(1),
  description: z.string().optional(),
  submitterEmail: z.string().email(),
  repoUrl: z.string().url().optional(),
  contentUrl: z.string().url().optional(),
  skillMd: z.string().min(1).optional(),
  notes: z.string().optional(),
});

export const POST = route(async (req) => {
  const body = await parseBody(req, submitSchema);
  return createSkillSubmission(body);
});
