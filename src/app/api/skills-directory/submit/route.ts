// POST /api/skills-directory/submit — file a skill for review. Needs
// skill.submit on the signed-in session, whose email is the submitter; the
// body never names it (TASK-3011).

import { z } from "zod";

import { parseBody, route } from "@/lib/api/route";
import { requireSessionActor } from "@/lib/routing/mutations/actors";
import { createSkillSubmission, SKILL_ID_PATTERN } from "@/lib/skills-directory";

const submitSchema = z.object({
  skillId: z.string().regex(SKILL_ID_PATTERN),
  title: z.string().min(1),
  description: z.string().optional(),
  repoUrl: z.string().url().optional(),
  contentUrl: z.string().url().optional(),
  skillMd: z.string().min(1).optional(),
  notes: z.string().optional(),
});

export const POST = route(async (req) => {
  const body = await parseBody(req, submitSchema);
  const authorized = await requireSessionActor("skill.submit");
  return createSkillSubmission({ ...body, submitterEmail: authorized.auditLabel });
});
