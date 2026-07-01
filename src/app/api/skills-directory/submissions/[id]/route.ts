import { z } from "zod";

import { ApiError, parseBody, route } from "@/lib/api/route";
import { updateSkillSubmission } from "@/lib/skills-directory";

const patchSchema = z.object({
  status: z.enum(["pending", "approved", "rejected"]).optional(),
  notes: z.string().optional(),
  reviewComment: z.string().optional(),
});

export const PATCH = route(async (req, ctx) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, patchSchema);
  const updated = await updateSkillSubmission(id, body);
  if (!updated) {
    throw new ApiError("not_found", `No skill submission found with id '${id}'.`, 404);
  }
  return updated;
});
