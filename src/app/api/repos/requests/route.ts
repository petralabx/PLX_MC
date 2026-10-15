// POST /api/repos/requests — persist a self-service repo request (EN-002 /
// Item 2). The client mirrors the full request through here on create, after
// GitHub-org validation reconciles `verified`, and on approve/reject — an
// idempotent upsert so the request queue survives a reload.
//
// Authority is the signed-in session, never the body (TASK-3011): a new request
// is filed as `pending` by the session (repo.request); only its requester may
// update it while pending; a decision needs repo.approve, is recorded under the
// session, and nobody approves their own request. A decided request is final.

import { z } from "zod";
import { ApiError, parseBody, route } from "@/lib/api/route";
import { sessionAuthorId } from "@/lib/api/session-actor";
import { requireSessionActor } from "@/lib/routing/mutations/actors";
import { getRepoRequests, stamp, upsertRepoRequest } from "@/lib/sync/repo";

const repoRequestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  owner: z.string().min(1),
  lang: z.string().optional(),
  visibility: z.enum(["public", "private"]).optional(),
  scope: z.string().optional(),
  def: z.string().optional(),
  // Ignored — the requester and decider are the session (TASK-3011).
  requestedBy: z.string().min(1),
  requestedTs: z.string().min(1),
  status: z.enum(["pending", "approved", "rejected"]),
  verified: z.boolean(),
  note: z.string().optional(),
  decidedBy: z.string().optional(),
  decidedTs: z.string().optional(),
});

export const POST = route(async (req) => {
  const { decidedBy: _decidedBy, decidedTs: _decidedTs, ...body } = await parseBody(req, repoRequestSchema);
  const existing = (await getRepoRequests()).find((r) => r.id === body.id);

  if (body.status !== "pending") {
    if (!existing) {
      throw new ApiError("invalid_request", "A new repo request is filed as pending.", 400);
    }
    const authorized = await requireSessionActor("repo.approve", { type: "repo", id: body.id });
    const decider = sessionAuthorId(authorized.auditLabel);
    if (existing.status !== "pending") {
      throw new ApiError("request_decided", `Repo request ${body.id} is already ${existing.status}.`, 409);
    }
    if (body.status === "approved" && existing.requestedBy === decider) {
      throw new ApiError("self_approval", "A repo request must be approved by someone other than its requester.", 403);
    }
    if (body.status === "approved" && !existing.verified) {
      throw new ApiError("repo_unverified", `${existing.name} hasn't been verified against the GitHub org.`, 409);
    }
    const decided = { ...existing, status: body.status, decidedBy: decider, decidedTs: stamp() };
    await upsertRepoRequest(decided);
    return decided;
  }

  const authorized = await requireSessionActor("repo.request", { type: "repo", id: body.id });
  const requester = sessionAuthorId(authorized.auditLabel);
  if (existing && existing.status !== "pending") {
    throw new ApiError("request_decided", `Repo request ${body.id} is already ${existing.status}.`, 409);
  }
  if (existing && existing.requestedBy !== requester) {
    throw new ApiError("forbidden", "Only the requester can update a pending repo request.", 403);
  }
  const request = {
    ...body,
    requestedBy: existing?.requestedBy ?? requester,
    requestedTs: existing?.requestedTs ?? body.requestedTs,
  };
  await upsertRepoRequest(request);
  return request;
});
