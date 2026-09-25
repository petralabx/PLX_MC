// POST /api/repos — upsert a registry repo (EN-002 / Item 2). Called by the
// store when an approver approves a request, so the approved repo joins the
// persisted allow-list and re-queues the push-only SharePoint mirror. The
// approver gate is enforced HERE too (not just in the store/UI), so humans and
// agents are bound to the same allow-list at the server boundary. In OIDC mode
// the approver is the signed-in session, never the body's `actor` field.

import { z } from "zod";
import { ApiError, parseBody, route } from "@/lib/api/route";
import { resolveRequestActor } from "@/lib/api/session-actor";
import { isApprover } from "@/lib/mc-data/repos";
import { upsertRepo } from "@/lib/sync/repo";

const upsertRepoSchema = z.object({
  actor: z.string().min(1).optional(),
  repo: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    lang: z.string(),
    def: z.string(),
    owner: z.string().min(1),
    visibility: z.enum(["public", "private"]),
    scope: z.string(),
  }),
});

export const POST = route(async (req) => {
  const { actor, repo } = await parseBody(req, upsertRepoSchema);
  if (!isApprover(await resolveRequestActor(actor))) {
    throw new ApiError("not_approver", "Only an Owner or Admin can add a repo to the registry.", 403);
  }
  await upsertRepo(repo);
  return repo;
});
