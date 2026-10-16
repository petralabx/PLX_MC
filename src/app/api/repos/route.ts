// POST /api/repos — upsert a registry repo (EN-002 / Item 2). Called by the
// store when an approver approves a request, so the approved repo joins the
// persisted allow-list and re-queues the push-only SharePoint mirror. The
// approver gate is enforced HERE too (not just in the store/UI), so humans and
// agents are bound to the same allow-list at the server boundary. In OIDC mode
// the approver is the signed-in session's mc_users row, never the body's
// `actor` field (requireRepoApprover, TASK-3010).
// The UI's approve path no longer calls this — it decides through POST
// /api/repos/requests, which adds the repo in the same write (TASK-3011). A
// direct add is still refused when it would approve the caller's own pending
// request.

import { z } from "zod";
import { ApiError, parseBody, route } from "@/lib/api/route";
import { requireRepoApprover } from "@/lib/api/session-actor";
import { repoFromRequest } from "@/lib/mc-data/repos";
import { getRepoRequests, upsertRepo } from "@/lib/sync/repo";

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
  const approver = await requireRepoApprover(actor, "Only an Owner or Admin can add a repo to the registry.", {
    type: "repo",
    id: repo.id,
  });
  const ownPending = (await getRepoRequests()).some(
    (r) => r.status === "pending" && r.requestedBy === approver.authorId && repoFromRequest(r).id === repo.id
  );
  if (ownPending) {
    throw new ApiError("self_approval", "A repo request must be approved by someone other than its requester.", 403);
  }
  await upsertRepo(repo);
  return repo;
});
