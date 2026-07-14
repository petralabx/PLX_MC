// POST /api/routing/decide/create-intent — confirmed Task creation for a proposal.

import { z } from "zod";
import { parseBody, route } from "@/lib/api/route";
import { createConfirmedTask } from "@/lib/routing";
import {
  assertSameOriginMutation,
  requireInboxActor,
} from "../../inbox/_lib/guard";

const schema = z.object({
  proposalId: z.string().min(1),
  bucketId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  repos: z.array(z.string()).optional(),
  /** Optional — defaults to session Entra oid (never trust spoofed actor). */
  accountableOwnerId: z.string().optional(),
  revisionId: z.string().optional(),
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
  labels: z.array(z.string()).optional(),
  priority: z.enum(["urgent", "high", "medium", "low"]).optional(),
  actorId: z.string().optional(),
});

export const POST = route(async (req) => {
  assertSameOriginMutation(req);
  const body = await parseBody(req, schema);
  const authorized = await requireInboxActor("routing.resolve", {
    type: "routing",
    id: body.proposalId,
  });

  return createConfirmedTask(authorized, {
    proposalId: body.proposalId,
    bucketId: body.bucketId,
    title: body.title,
    description: body.description,
    repos: body.repos,
    accountableOwnerId: body.accountableOwnerId?.trim() || authorized.actorId,
    revisionId: body.revisionId,
    headSha: body.headSha,
    mergeSha: body.mergeSha,
    authorizationTrust: body.authorizationTrust,
    labels: body.labels,
    priority: body.priority,
  });
});
