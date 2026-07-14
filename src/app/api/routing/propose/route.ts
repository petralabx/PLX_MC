// POST /api/routing/propose — authoritative metadata-only PR proposal upsert.
// Authenticated via GitHub Actions OIDC only. Self-authenticating (middleware
// carve-out). Binds verified claims to submitted repository identity, event,
// PR ref/number, workflow ref, and SHA — rejects fork/cross-repo/replay drift.

import { z } from "zod";
import { ApiError, parseBody, route } from "@/lib/api/route";
import {
  bindOidcClaimsToPropose,
  verifyGitHubActionsOidc,
} from "@/lib/compliance/github-oidc";
import { proposeRoutingFromPr } from "@/lib/compliance/service";
import {
  complianceOidcConfigured,
  complianceOidcEnabled,
} from "@/lib/secrets";

const proposeSchema = z.object({
  repository: z.string().min(1),
  repositoryId: z.union([z.string().min(1), z.number().int().positive()]),
  eventName: z.literal("pull_request"),
  action: z.enum(["opened", "reopened", "synchronize", "closed"]),
  prNumber: z.number().int().positive(),
  headSha: z.string().min(1),
  mergeSha: z.string().nullable().optional(),
  headRef: z.string().optional(),
  baseBranch: z.string().optional(),
  sourceBranch: z.string().optional(),
  title: z.string().optional(),
  /** In-memory only — hashed/markers extracted; never persisted raw. */
  body: z.string().optional(),
  labels: z.array(z.string()).optional(),
  changedPaths: z.array(z.string()).optional(),
  author: z.string().optional(),
  workflowRef: z.string().optional(),
  actorKind: z.enum(["agent", "operator"]).optional(),
});

function extractBearerToken(authorization: string | null): string | null {
  if (!authorization) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  return match?.[1] ?? null;
}

export const POST = route(async (req) => {
  const oidcAvailable = complianceOidcEnabled() && complianceOidcConfigured();
  if (!oidcAvailable) {
    throw new ApiError(
      "propose_disabled",
      "Routing propose requires GitHub Actions OIDC (COMPLIANCE_OIDC_*).",
      503
    );
  }

  const token = extractBearerToken(req.headers.get("authorization"));
  if (!token) {
    throw new ApiError("unauthorized", "Invalid or missing OIDC bearer token.", 401);
  }

  const oidc = await verifyGitHubActionsOidc(token);
  if (!oidc.ok) {
    throw new ApiError("unauthorized", `OIDC verification failed (${oidc.reason}).`, 401);
  }

  const body = await parseBody(req, proposeSchema);

  const bound = bindOidcClaimsToPropose(oidc.claims, {
    repository: body.repository,
    repositoryId: body.repositoryId,
    eventName: body.eventName,
    prNumber: body.prNumber,
    headSha: body.headSha,
    mergeSha: body.mergeSha,
    headRef: body.headRef ?? body.sourceBranch,
    workflowRef: body.workflowRef,
  });
  if (!bound.ok) {
    throw new ApiError("oidc_binding_failed", `OIDC claim binding failed (${bound.reason}).`, 403);
  }

  const result = await proposeRoutingFromPr({
    repository: body.repository,
    repositoryId: body.repositoryId,
    prNumber: body.prNumber,
    action: body.action,
    headSha: body.headSha,
    mergeSha: body.mergeSha,
    baseBranch: body.baseBranch,
    sourceBranch: body.sourceBranch ?? body.headRef,
    title: body.title,
    body: body.body,
    labels: body.labels,
    changedPaths: body.changedPaths,
    author: body.author,
    actorKind: body.actorKind ?? "operator",
    runId: oidc.claims.runId,
    eventSource: "oidc.propose",
  });

  // Explicitly do not echo raw body back.
  return {
    proposalId: result.proposalId,
    revisionId: result.revisionId,
    state: result.state,
    deepLink: result.deepLink,
    sessionId: result.sessionId,
    candidates: result.candidates,
    bodyContentHash: result.bodyContentHash,
    policyVersion: result.policyVersion,
  };
});
