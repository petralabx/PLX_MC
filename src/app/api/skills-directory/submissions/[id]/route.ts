import { z } from "zod";

import { ApiError, parseBody, route } from "@/lib/api/route";
import { requireRepoApprover } from "@/lib/api/session-actor";
import {
  getSkillSubmission,
  publishApprovedSkillSubmission,
  updateSkillSubmission,
} from "@/lib/skills-directory";

const patchSchema = z.object({
  actor: z.string().min(1).optional(),
  status: z.enum(["pending", "approved", "rejected"]).optional(),
  notes: z.string().optional(),
  reviewComment: z.string().optional(),
});

export const PATCH = route(async (req, ctx) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, patchSchema);
  await requireRepoApprover(body.actor, "Only an Owner or Admin can review skill submissions.");
  if (body.status === "approved") {
    const current = await getSkillSubmission(id);
    if (!current) {
      throw new ApiError("not_found", `No skill submission found with id '${id}'.`, 404);
    }
    const publish = await publishApprovedSkillSubmission({
      ...current,
      reviewComment: body.reviewComment ?? current.reviewComment,
    });
    const updated = await updateSkillSubmission(id, body);
    if (!updated) {
      throw new ApiError("not_found", `No skill submission found with id '${id}'.`, 404);
    }
    return { ...updated, publish };
  }
  const updated = await updateSkillSubmission(id, body);
  if (!updated) {
    throw new ApiError("not_found", `No skill submission found with id '${id}'.`, 404);
  }
  return updated;
});
