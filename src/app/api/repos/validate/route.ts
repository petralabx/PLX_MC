// POST /api/repos/validate — validate a self-service repo request against the
// GitHub org (EN-002 / WS-2). Needs repo.request on the signed-in session
// (TASK-3011): the probe spends the server's GITHUB_TOKEN.
//
// With `requestId` (TASK-3043) the server validates that filed request's own
// owner/name and records the result on it — `verified` is never taken from the
// client, and approval reads only this server-recorded result. Only the
// requester re-validates their request, only while it is pending and still
// names this repo (409 otherwise). Without `requestId` it is a bare probe and
// records nothing.

import { z } from "zod";
import { ApiError, parseBody, route } from "@/lib/api/route";
import { sessionAuthorId } from "@/lib/api/session-actor";
import { requireSessionActor } from "@/lib/routing/mutations/actors";
import { validateRepoInOrg, verifyRepoRequest } from "@/lib/sync";
import { getRepoRequest, recordRepoRequestVerification } from "@/lib/sync/repo";
import { REPO_ORG } from "@/lib/mc-data/data";

const validateRepoSchema = z.object({
  name: z.string().min(1),
  owner: z.string().min(1).optional(),
  requestId: z.string().min(1).optional(),
});

export const POST = route(async (req) => {
  const { name, owner = REPO_ORG, requestId } = await parseBody(req, validateRepoSchema);
  if (!requestId) {
    await requireSessionActor("repo.request");
    return validateRepoInOrg(owner, name);
  }
  const authorized = await requireSessionActor("repo.request", { type: "repo", id: requestId });
  const existing = await getRepoRequest(requestId);
  if (!existing) throw new ApiError("not_found", `unknown repo request ${requestId}`, 404);
  if (existing.requestedBy !== sessionAuthorId(authorized.auditLabel)) {
    throw new ApiError("forbidden", "Only the requester can validate a repo request.", 403);
  }
  if (existing.status !== "pending") {
    throw new ApiError("request_decided", `Repo request ${requestId} is already ${existing.status}.`, 409);
  }
  if (existing.name !== name || existing.owner !== owner) {
    throw new ApiError("request_changed", `Repo request ${requestId} names ${existing.owner}/${existing.name}.`, 409);
  }
  const verification = await verifyRepoRequest(existing.owner, existing.name);
  if (!(await recordRepoRequestVerification({ id: requestId, name, owner, ...verification }))) {
    throw new ApiError("request_changed", `Repo request ${requestId} changed or was decided meanwhile.`, 409);
  }
  const { verified, ...rest } = verification;
  return { ok: verified, ...rest };
});
