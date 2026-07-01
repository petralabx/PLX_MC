import { z } from "zod";

import { ApiError, parseBody, route } from "@/lib/api/route";
import { auth, oidcEnabled } from "@/lib/auth";
import { ACTORS } from "@/lib/mc-data/data";
import { isApprover } from "@/lib/mc-data/repos";
import type { Actor } from "@/lib/mc-data/types";
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

function actorByEmail(email: string | null | undefined): Actor | undefined {
  const normalized = email?.trim().toLowerCase();
  if (!normalized) return undefined;
  return Object.values(ACTORS).find(
    (actor) => actor.kind === "human" && actor.email?.toLowerCase() === normalized
  );
}

async function resolveReviewActor(bodyActor: string | undefined): Promise<Actor | undefined> {
  if (oidcEnabled()) {
    let session: { user?: { email?: string | null } } | null;
    try {
      session = (await auth()) as { user?: { email?: string | null } } | null;
    } catch {
      throw new ApiError("not_authenticated", "No signed-in reviewer session found.", 401);
    }
    const actor = actorByEmail(session?.user?.email);
    if (!actor) {
      throw new ApiError("not_authenticated", "No signed-in reviewer session found.", 401);
    }
    return actor;
  }
  // Dormant local/test mode has no Auth.js session provider; keep the prototype
  // actor field only there so local dev and unit tests can exercise the route.
  return bodyActor ? ACTORS[bodyActor] : undefined;
}

export const PATCH = route(async (req, ctx) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, patchSchema);
  const reviewActor = await resolveReviewActor(body.actor);
  if (!isApprover(reviewActor)) {
    throw new ApiError(
      "not_approver",
      "Only an Owner or Admin can review skill submissions.",
      403
    );
  }
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
