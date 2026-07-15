// POST /api/compliance/verify — the gate brain (EN-007 decisions 2, 9, 12). The
// GitHub status check calls this with the PR's repo/number/head + changed paths;
// it returns the pass/block verdict + reasons. The soft-vs-hard (warn vs block)
// decision belongs to the caller (the status-check workflow), not this route.

import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { ApiError, parseBody, route } from "@/lib/api/route";
import {
  verifyGitHubActionsOidc,
  type GitHubActionsOidcClaims,
} from "@/lib/compliance/github-oidc";
import { verifyPrOrQueue } from "@/lib/compliance/service";
import {
  complianceCiToken,
  complianceCiTokenConfigured,
  complianceOidcConfigured,
  complianceOidcEnabled,
} from "@/lib/secrets";

// No taskId — attribution comes from the checkout credential(s), not the client
// (review S7); the status-check workflow never sends one. checkoutIds carries one
// MC-Checkout per task for a multi-task PR; checkoutId stays for back-compat.
const verifySchema = z.object({
  repo: z.string().min(1),
  repoFullName: z.string().min(3).optional(),
  prNumber: z.number().int().nonnegative(),
  headSha: z.string().min(1),
  changedPaths: z.array(z.string()).default([]),
  labels: z.array(z.string()).optional(),
  checkoutId: z.string().optional(),
  checkoutIds: z.array(z.string()).optional(),
});

const UNAUTHORIZED = new ApiError("unauthorized", "Invalid or missing CI authorization.", 401);
type VerifyBody = z.infer<typeof verifySchema>;

function extractBearerToken(authorization: string | null): string | null {
  if (!authorization) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  return match?.[1] ?? null;
}

function bearerTokenMatches(token: string, expected: string): boolean {
  const got = Buffer.from(token);
  const exp = Buffer.from(expected);
  if (got.length !== exp.length) return false;
  return timingSafeEqual(got, exp);
}

function signedComplianceWorkflowAllowed(
  workflowRef: string,
  signedRepository: string
): boolean {
  const workflow = workflowRef.split("@", 1)[0];
  return (
    workflow ===
      `${signedRepository}/.github/workflows/plx-mc-compliance.yml` ||
    workflow ===
      `${signedRepository}/.github/workflows/compliance-gate.yml` ||
    workflow ===
      "petralabx/PLX_MC/.github/workflows/compliance-gate.yml"
  );
}

function bindOidcVerifyBody(
  body: VerifyBody,
  claims: GitHubActionsOidcClaims
): VerifyBody | null {
  const signedRepoParts = claims.repository.split("/");
  const signedBareRepo = signedRepoParts[1] ?? "";
  if (!signedBareRepo || body.repo !== signedBareRepo) return null;
  if (body.repoFullName && body.repoFullName !== claims.repository) return null;

  const workflowRefs = [claims.workflowRef, claims.jobWorkflowRef].filter(
    (value): value is string => value != null
  );
  if (
    workflowRefs.length === 0 ||
    workflowRefs.some(
      (workflowRef) =>
        !signedComplianceWorkflowAllowed(workflowRef, claims.repository)
    )
  ) {
    return null;
  }

  if (claims.eventName != null && claims.eventName !== "pull_request") {
    return null;
  }
  const prRef = /^refs\/pull\/(\d+)\/(head|merge)$/.exec(claims.ref ?? "");
  if (prRef && Number(prRef[1]) !== body.prNumber) return null;
  if (
    prRef?.[2] === "head" &&
    claims.sha != null &&
    claims.sha.toLowerCase() !== body.headSha.toLowerCase()
  ) {
    return null;
  }

  return { ...body, repoFullName: claims.repository };
}

export const POST = route(async (req) => {
  // Self-authenticating endpoint (EN-007 review #3): carved out of the UI
  // session gate (src/middleware.ts). Dual-auth: GitHub Actions OIDC and/or
  // COMPLIANCE_CI_TOKEN bearer. Default-off → 503 until at least one path is
  // available, so it is never silently world-callable.
  const oidcAvailable = complianceOidcEnabled() && complianceOidcConfigured();
  const bearerAvailable = complianceCiTokenConfigured();
  if (!oidcAvailable && !bearerAvailable) {
    throw new ApiError(
      "verify_disabled",
      "Compliance verify is not configured (neither OIDC nor COMPLIANCE_CI_TOKEN configured).",
      503
    );
  }

  const body = await parseBody(req, verifySchema);
  const token = extractBearerToken(req.headers.get("authorization"));
  if (!token) {
    throw UNAUTHORIZED;
  }

  let authorized = false;
  let verifiedBody = body;
  if (oidcAvailable) {
    const oidc = await verifyGitHubActionsOidc(token);
    if (oidc.ok) {
      const bound = bindOidcVerifyBody(body, oidc.claims);
      if (bound) {
        authorized = true;
        verifiedBody = bound;
      }
    }
  }
  if (!authorized && bearerAvailable) {
    if (bearerTokenMatches(token, complianceCiToken())) {
      authorized = true;
      verifiedBody = body;
    }
  }
  if (!authorized) {
    throw UNAUTHORIZED;
  }

  return verifyPrOrQueue(verifiedBody);
});
