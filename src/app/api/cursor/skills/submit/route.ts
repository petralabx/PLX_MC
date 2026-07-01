import { z } from "zod";

import { ApiError } from "@/lib/api/route";
import { cursorRoute, parseCursorBody } from "@/lib/mcp/route";
import { actionSubmitSkill } from "@/lib/mcp/skills-actions";
import { createSkillSubmission, SKILL_ID_PATTERN } from "@/lib/skills-directory";

const submitSchema = z.object({
  id: z.string().regex(SKILL_ID_PATTERN).optional(),
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  skillMd: z.string().min(1).optional(),
  tags: z.array(z.string().min(1)).optional(),
  owner: z.string().min(1).optional(),
  skillId: z.string().regex(SKILL_ID_PATTERN).optional(),
  title: z.string().min(1).optional(),
  submitterEmail: z.string().email().optional(),
  repoUrl: z.string().url().optional(),
  contentUrl: z.string().url().optional(),
  notes: z.string().optional(),
});

export const POST = cursorRoute("mc_skills_submit", async (req, _ctx, identity) => {
  const body = await parseCursorBody(req, submitSchema);
  if (body.id || body.name || body.skillMd) {
    if (!body.id || !body.name || !body.description || !body.skillMd) {
      throw new ApiError(
        "invalid_request",
        "MCP skill submissions require id, name, description, and skillMd."
      );
    }
    return {
      data: await actionSubmitSkill(identity, {
        id: body.id,
        name: body.name,
        description: body.description,
        skillMd: body.skillMd,
        tags: body.tags,
        owner: body.owner,
      }),
    };
  }
  if (!body.skillId || !body.title || !body.submitterEmail) {
    throw new ApiError(
      "invalid_request",
      "Legacy skill submissions require skillId, title, and submitterEmail."
    );
  }
  return {
    data: await createSkillSubmission({
      skillId: body.skillId,
      title: body.title,
      description: body.description,
      submitterEmail: body.submitterEmail,
      repoUrl: body.repoUrl,
      contentUrl: body.contentUrl,
      skillMd: body.skillMd,
      notes: body.notes,
    }),
  };
});
