// POST /api/compliance/webhook — git → MC ingestion (EN-007 decision 8). GitHub
// posts pull_request events here; we verify the HMAC signature against the shared
// secret, parse the event, and record it into the system of record. Default-off:
// returns 503 until COMPLIANCE_WEBHOOK_SECRET is configured. Reads the raw body
// (not parseBody) because the signature is over the exact bytes.

import { ApiError, route } from "@/lib/api/route";
import { complianceWebhookConfigured, complianceWebhookSecret } from "@/lib/secrets";
import { ingestOrQueue } from "@/lib/compliance/service";
import { parsePullRequestEvent, verifyGithubSignature } from "@/lib/compliance/webhook";

export const POST = route(async (req) => {
  if (!complianceWebhookConfigured()) {
    throw new ApiError("webhook_disabled", "Compliance webhook is not configured (default-off).", 503);
  }
  const raw = await req.text();
  const signature = req.headers.get("x-hub-signature-256");
  if (!verifyGithubSignature(raw, signature, complianceWebhookSecret())) {
    throw new ApiError("invalid_signature", "Webhook signature verification failed.", 401);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new ApiError("invalid_json", "Webhook body must be valid JSON.", 400);
  }
  const evt = parsePullRequestEvent(payload);
  if (!evt) return { ingested: false };
  return ingestOrQueue(evt);
});
