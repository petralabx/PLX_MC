// POST /api/routing/decide/accept — confirm an existing Task candidate.

import { z } from "zod";
import { parseBody, route } from "@/lib/api/route";
import { confirmExistingTask } from "@/lib/routing";
import {
  assertSameOriginMutation,
  requireInboxActor,
} from "../../inbox/_lib/guard";

const schema = z.object({
  proposalId: z.string().min(1),
  taskId: z.string().min(1),
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
  // Deprecated — ignored; session oid is authoritative.
  actorId: z.string().optional(),
});

export const POST = route(async (req) => {
  assertSameOriginMutation(req);
  const body = await parseBody(req, schema);
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
  });
});
