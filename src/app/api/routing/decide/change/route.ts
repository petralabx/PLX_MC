// POST /api/routing/decide/change — override / change selected Task (requires reason).

import { z } from "zod";
import { ApiError, parseBody, route } from "@/lib/api/route";
import { confirmExistingTask } from "@/lib/routing";
import {
  assertSameOriginMutation,
  requireInboxActor,
} from "../../inbox/_lib/guard";

const schema = z.object({
  proposalId: z.string().min(1),
  taskId: z.string().min(1),
  overrideReason: z.string().min(1),
  revisionId: z.string().optional(),
  linkType: z.enum(["related", "delivery"]).optional(),
  headSha: z.string().optional(),
  mergeSha: z.string().optional(),
  authorizationTrust: z
    .enum([
      "credentialed_checkout",
      "persisted_decision",
      "author_declaration",
      "routing_correlation",
      "fuzzy",
      "none",
    ])
    .optional(),
  actorId: z.string().optional(),
});

export const POST = route(async (req) => {
  assertSameOriginMutation(req);
  const body = await parseBody(req, schema);
  if (!body.overrideReason.trim()) {
    throw new ApiError("invalid_request", "overrideReason is required to change routing.", 400);
  }
  const authorized = await requireInboxActor("routing.resolve", {
    type: "routing",
    id: body.proposalId,
  });

  return confirmExistingTask(authorized, {
    proposalId: body.proposalId,
    taskId: body.taskId,
    revisionId: body.revisionId,
    linkType: body.linkType,
    headSha: body.headSha,
    mergeSha: body.mergeSha,
    authorizationTrust: body.authorizationTrust,
    overrideReason: body.overrideReason.trim(),
  });
});
