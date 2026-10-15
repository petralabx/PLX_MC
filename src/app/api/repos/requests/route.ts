// POST /api/repos/requests — persist a self-service repo request (EN-002 /
// Item 2). The client mirrors the request through here on create and sends its
// approve/reject decision here — an idempotent upsert so the request queue
// survives a reload.
//
// Authority is the signed-in session, never the body (TASK-3011):
// - Filing / updating needs repo.request. A new request is filed `pending` by
//   the session; only its requester may update it while pending. The server
//   verifies the repo against the GitHub org itself (allowed org + GitHub
//   lookup) and re-verifies when the name or owner changes; `verified`, `note`,
//   `visibility`, `def` and `lang` in the body are ignored.
// - Deciding needs repo.approve (plus the directory approver role until mode
//   `enforce`, matching POST /api/repos), is recorded under the session, and is
//   final. Nobody approves their own request, and only a verified request in an
//   allowed org is approved. An approval adds the repo to the registry in the
//   same transaction.
// Every write is conditional on the row still being pending (409 otherwise).

import { z } from "zod";
import { ApiError, parseBody, route } from "@/lib/api/route";
import { resolveRequestActor, sessionAuthorId } from "@/lib/api/session-actor";
import { permissionsEnforcementMode } from "@/lib/auth/identity";
import { isAllowedRepoOrg, repoFromRequest } from "@/lib/mc-data/repos";
import { ALLOWED_REPO_ORGS } from "@/lib/mc-data/data";
import type { RepoRequest } from "@/lib/mc-data/types";
import { authorize, permissionActorFromDirectoryRole } from "@/lib/permissions";
import { requireSessionActor } from "@/lib/routing/mutations/actors";
import { validateRepoInOrg } from "@/lib/sync";
import { decideRepoRequest, getRepoRequest, stamp, upsertRepoRequest } from "@/lib/sync/repo";

const repoRequestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  owner: z.string().min(1),
  scope: z.string().optional(),
  // Ignored — the requester is the session and the server stamps the time.
  requestedBy: z.string().min(1),
  requestedTs: z.string().min(1),
  status: z.enum(["pending", "approved", "rejected"]),
  // Ignored — the server verifies; kept so the client's full request still parses.
  verified: z.boolean(),
});

type Verification = Pick<RepoRequest, "verified" | "note" | "visibility" | "def" | "lang">;

async function verify(owner: string, name: string): Promise<Verification> {
  if (!isAllowedRepoOrg(owner)) {
    return { verified: false, note: `Org ${owner} is not allowed — permitted orgs: ${ALLOWED_REPO_ORGS.join(", ")}.` };
  }
  const result = await validateRepoInOrg(owner, name);
  if (!result.ok) return { verified: false, note: result.note ?? "Could not be validated against the org." };
  return {
    verified: true,
    note: `Validated against ${owner} on GitHub.`,
    visibility: result.visibility,
    def: result.def,
    lang: result.lang,
  };
}

const decided = (existing: RepoRequest) =>
  new ApiError("request_decided", `Repo request ${existing.id} is already ${existing.status}.`, 409);

export const POST = route(async (req) => {
  const body = await parseBody(req, repoRequestSchema);
  const existing = await getRepoRequest(body.id);

  if (body.status !== "pending") {
    if (!existing) {
      throw new ApiError("invalid_request", "A new repo request is filed as pending.", 400);
    }
    const authorized = await requireSessionActor("repo.approve", { type: "repo", id: body.id });
    // Until enforce, every session is synthesized as admin, so the directory
    // approver role (the POST /api/repos gate) still decides who may approve.
    if (permissionsEnforcementMode() !== "enforce") {
      const directoryActor = permissionActorFromDirectoryRole(await resolveRequestActor(undefined));
      if (!authorize({ actor: directoryActor, capability: "repo.approve" }).allowed) {
        throw new ApiError("not_approver", "Only an Owner or Admin can decide a repo request.", 403);
      }
    }
    const decider = sessionAuthorId(authorized.auditLabel);
    if (existing.status !== "pending") throw decided(existing);
    if (body.status === "approved") {
      if (existing.requestedBy === decider) {
        throw new ApiError("self_approval", "A repo request must be approved by someone other than its requester.", 403);
      }
      if (!isAllowedRepoOrg(existing.owner)) {
        throw new ApiError("repo_org_not_allowed", `Org ${existing.owner} is not allowed.`, 409);
      }
      if (!existing.verified) {
        throw new ApiError("repo_unverified", `${existing.name} hasn't been verified against the GitHub org.`, 409);
      }
    }
    const decision: RepoRequest = { ...existing, status: body.status, decidedBy: decider, decidedTs: stamp() };
    const repo = body.status === "approved" ? repoFromRequest(existing) : undefined;
    if (!(await decideRepoRequest(decision, repo))) {
      throw new ApiError("request_changed", `Repo request ${body.id} changed or was decided meanwhile.`, 409);
    }
    return decision;
  }

  const authorized = await requireSessionActor("repo.request", { type: "repo", id: body.id });
  const requester = sessionAuthorId(authorized.auditLabel);
  if (existing) {
    if (existing.status !== "pending") throw decided(existing);
    if (existing.requestedBy !== requester) {
      throw new ApiError("forbidden", "Only the requester can update a pending repo request.", 403);
    }
    if (existing.name === body.name && existing.owner === body.owner && existing.scope === body.scope) {
      return existing;
    }
  }
  const sameRepo = existing && existing.name === body.name && existing.owner === body.owner;
  const request: RepoRequest = {
    id: body.id,
    name: body.name,
    owner: body.owner,
    scope: body.scope,
    requestedBy: existing?.requestedBy ?? requester,
    requestedTs: existing?.requestedTs ?? stamp(),
    status: "pending",
    ...(sameRepo
      ? { verified: existing.verified, note: existing.note, visibility: existing.visibility, def: existing.def, lang: existing.lang }
      : await verify(body.owner, body.name)),
  };
  if (!(await upsertRepoRequest(request))) {
    throw new ApiError("request_decided", `Repo request ${body.id} was decided meanwhile.`, 409);
  }
  return request;
});
