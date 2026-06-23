// POST /api/compliance/verify — the gate brain (EN-007 decisions 2, 9, 12). The
// GitHub status check calls this with the PR's repo/number/head + changed paths;
// it returns the pass/block verdict + reasons. The soft-vs-hard (warn vs block)
// decision belongs to the caller (the status-check workflow), not this route.

import { z } from "zod";
import { ApiError, parseBody, route } from "@/lib/api/route";
import { complianceCiToken, complianceCiTokenConfigured } from "@/lib/secrets";
import { verifyPrOrQueue } from "@/lib/compliance/service";

// No taskId — attribution comes from the checkout credential, not the client
// (review S7); the status-check workflow never sends one.
const verifySchema = z.object({
  repo: z.string().min(1),
  prNumber: z.number().int().nonnegative(),
  headSha: z.string().min(1),
  changedPaths: z.array(z.string()).default([]),
  labels: z.array(z.string()).optional(),
  checkoutId: z.string().optional(),
});

export const POST = route(async (req) => {
  // Self-authenticating endpoint (EN-007 review #3): it is carved out of the UI
  // session gate (src/middleware.ts), so the CI bearer is its only protection.
  // Default-off → 503 until COMPLIANCE_CI_TOKEN is configured, so it is never
  // silently world-callable.
  if (!complianceCiTokenConfigured()) {
    throw new ApiError("verify_disabled", "Compliance verify is not configured (COMPLIANCE_CI_TOKEN unset).", 503);
  }
  if (req.headers.get("authorization") !== `Bearer ${complianceCiToken()}`) {
    throw new ApiError("unauthorized", "Invalid or missing CI authorization.", 401);
  }
  return verifyPrOrQueue(await parseBody(req, verifySchema));
});
