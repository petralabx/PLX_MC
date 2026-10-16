// POST /api/repos — upsert a registry repo (EN-002 / Item 2). Called by the
// store when an approver approves a request, so the approved repo joins the
// persisted allow-list and re-queues the push-only SharePoint mirror. The
// approver gate is enforced HERE too (not just in the store/UI), so humans and
// agents are bound to the same allow-list at the server boundary. In OIDC mode
// the approver is the signed-in session, never the body's `actor` field.
// The UI's approve path no longer calls this — it decides through POST
// /api/repos/requests, which adds the repo in the same write (TASK-3011). A
// direct add is still refused when it would approve the caller's own pending
// request.

import { z } from "zod";
import { ApiError, parseBody, route } from "@/lib/api/route";
import { resolveRequestActor } from "@/lib/api/session-actor";
import { authorize, permissionActorFromDirectoryRole } from "@/lib/permissions";
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
  const directoryActor = await resolveRequestActor(actor);
  const requestActor = permissionActorFromDirectoryRole(directoryActor);
  if (!authorize({ actor: requestActor, capability: "repo.approve" }).allowed) {
    throw new ApiError("not_approver", "Only an Owner or Admin can add a repo to the registry.", 403);
  }
  const ownPending = (await getRepoRequests()).some(
    (r) => r.status === "pending" && r.requestedBy === directoryActor?.id && repoFromRequest(r).id === repo.id
  );
  if (ownPending) {
    throw new ApiError("self_approval", "A repo request must be approved by someone other than its requester.", 403);
  }
  await upsertRepo(repo);
  return repo;
});
