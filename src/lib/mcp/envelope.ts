// Standard MCP cursor response envelope — { data, meta } with deep links.

import { randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ApiError } from "@/lib/api/route";
import type { McpIdentity } from "./auth";
import { MCP_CHECKOUT_REPO_ALLOWLIST } from "./checkout-repo";

export interface McpSyncMeta {
  status: "pushed" | "queued" | "conflict" | "synced";
  conflictId?: string;
  link?: string;
}

export interface McpResponseMeta {
  requestId: string;
  ts: string;
  actor: McpIdentity;
  links: {
    mcBase: string;
    task?: string;
    checkoutStamp?: string;
    events?: string;
    conflicts?: string;
  };
  /** Applied tool filters (search/context). Absent keys were not requested. */
  filter?: Record<string, unknown>;
  evidence?: Record<string, unknown>;
  audit: { eventSeq?: string; kinds: string[] };
  sync?: McpSyncMeta;
}

export function publicMcBaseUrl(): string {
  return (process.env.PLX_MC_PUBLIC_URL ?? "https://mc.plxcustomer.io").replace(/\/+$/, "");
}

export function taskLink(taskId: string): string {
  return `${publicMcBaseUrl()}/tasks/${encodeURIComponent(taskId)}`;
}

/** Project deep link (TASK-3442): /projects/PRJ-n, an alias onto the shell's project screen. */
export function projectLink(projectId: string): string {
  return `${publicMcBaseUrl()}/projects/${encodeURIComponent(projectId)}`;
}

/** Bucket deep link (TASK-3442): /buckets/BKT-n, an alias onto the shell's bucket screen. */
export function bucketLink(bucketId: string): string {
  return `${publicMcBaseUrl()}/buckets/${encodeURIComponent(bucketId)}`;
}

/** Approval gate deep link (TASK-3559): opens the gate on the Approvals screen; the session decides who sees it. */
export function gateLink(gateId: string): string {
  return `${publicMcBaseUrl()}/?screen=approvals&gate=${encodeURIComponent(gateId)}`;
}

export function buildMeta(
  identity: McpIdentity,
  partial: Partial<Omit<McpResponseMeta, "requestId" | "ts" | "actor">> = {}
): McpResponseMeta {
  const base = publicMcBaseUrl();
  return {
    requestId: randomUUID(),
    ts: new Date().toISOString(),
    actor: identity,
    links: {
      mcBase: base,
      events: `${base}/api/events`,
      ...partial.links,
    },
    audit: partial.audit ?? { kinds: [] },
    filter: partial.filter,
    evidence: partial.evidence,
    sync: partial.sync,
  };
}

export function wrapMcpResponse<T>(data: T, meta: McpResponseMeta): { data: T; meta: McpResponseMeta } {
  return { data, meta };
}

// ─── MCP tool results ────────────────────────────────────────────────────────

export function mcpJsonResult(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}

export interface McpToolErrorBody {
  error: { code: string; message: string; hint?: string; retryAfterMs?: number };
}

// Agent-actionable next steps for codes an agent can fix on its own (W04): one
// sentence that starts with the step. Keep this short: a hint that is not
// concrete is noise. tests/mcp-error-hints.test.ts reads every code thrown under
// src/lib/mcp/ and in the compliance service, and fails on a code that is in
// neither this map nor NO_HINT_CODES.
export const ERROR_HINTS: Readonly<Record<string, string>> = {
  agent_required: "Pass agent as <runtime>/<lane> to mc_checkout_task, or send it in the X-MC-Agent header.",
  already_cancelled: "Leave this UAT ticket task cancelled: a cancelled ticket is never verified and is never closed as STALE.",
  already_verified: "Leave this UAT ticket task verified: the submitter's PASS already closed it, so closeStale does not apply.",
  ambiguous_checkout_ref: "Pass the full checkoutId from your mc_checkout_task receipt instead of the short checkoutRef.",
  autonomy_approval_required:
    "Raise mc_request_approval with this checkoutId and wait for a person to approve it before you call mc_complete_task again.",
  chain_bound: "Use the PR this checkout's SHA chain is bound to, or take a fresh mc_checkout_task for the other PR.",
  checkout_held:
    "Call mc_checkout_task with reuse to get your own live lease back, or pass forceReason to take over another holder's.",
  checkout_inactive: "Run mc_checkout_task again and use the new MC-Checkout stamp in the PR body.",
  checkout_mismatch: "Pass the checkoutId that mc_checkout_task returned for this task.",
  creator_approval_pending: "Wait for vince@ or cos@ to approve the task in Mission Control before you move it to progress or later.",
  draft_not_submitted: "Submit the draft with mc_submit_draft, then render its page again.",
  evidence_standard:
    "Rewrite the flagged text in STE-lite, one instruction per sentence and 20 words per step, then send the same call again.",
  idempotency_in_progress: "Retry with the same idempotencyKey once the first create has finished.",
  idempotency_key_failed: "Send the create again with a new idempotencyKey.",
  idempotency_key_reused: "Use a new idempotencyKey for a different payload, or resend the first payload with this key.",
  invalid_agent: "Pass agent as <runtime>/<lane> starting with your X-MC-Runtime value, such as claude-code/claude-code.",
  invalid_artifact: "Fix the file, kind or content type the message names, then upload it again.",
  invalid_checkout:
    "Run mc_checkout_task again and use the new MC-Checkout stamp: the old checkout is unknown, revoked, released or expired.",
  invalid_json: "Send a request body that parses as JSON.",
  invalid_owner: "Pass owner as a person id or email from the PLX directory, an agent id or an MCP service principal id.",
  invalid_query: "Pass q with the text to search for.",
  invalid_repo: "Pass a full GitHub slug (owner/name), not a bare repo name or MC registry id.",
  lane_cap_full: "Wait until one of the lane's open PRs merges or closes, then call mc_checkout_task again.",
  missing_operator: "Send the X-MC-Operator-Email header with the email of the person you work for.",
  missing_repo: "Send the X-MC-Repo header with the full GitHub slug of the repo you edit, such as petralabx/PLX_MC.",
  not_checkout_launcher:
    "Leave head recording to the push webhook: only the principal that took the checkout calls mc_record_checkout_head.",
  not_merged: "Wait until the UAT ticket task's fix merges, then send verify again.",
  payload_too_large: "Send a smaller snapshot, under the byte limit the message names.",
  pr_linked_elsewhere: "Link the PR from the task that already holds it, or pass override with an overrideReason to link it here too.",
  pr_not_merged: "Wait until the PR merges, then call mc_link_merged_pr again.",
  repo_mismatch: "Pass the repo that the PR belongs to, as the message names it.",
  repo_not_allowlisted: `Pass one of ${MCP_CHECKOUT_REPO_ALLOWLIST.join(", ")} as repo, or omit repo to bind the connector X-MC-Repo.`,
  stage_regression: "Post notes without a stage, or open a follow-up task with mc_create_task for new work.",
  task_cancelled: "Check out the replacement task the cancellation names, or ask a person to reopen this one.",
  task_closed: "Attach the evidence to an open task: a verified or cancelled task takes none.",
  uat_code_pr_required: "Pass prUrl to mc_complete_task, or set outcome to blocked or failed.",
  upload_not_found: "Finish the PUTs to the upload session, or start a new session for the task's current folder and upload again.",
  verified_needs_person: "Ask the task's accountable person to mark it Verified in Mission Control.",
};

/** Codes with no hint, and why: the message already names the fix, or only a person can act. */
export const NO_HINT_CODES: Readonly<Record<string, string>> = {
  approval_gate_read_failed: "The message says to retry, or to report the gate id to an operator.",
  catalog_unavailable: "The skills catalog is down; nothing in the call can fix it.",
  evidence_store_unavailable: "The message names what a person must set up.",
  forbidden: "The message names the missing capability or checkout, and most of them need a person.",
  github_error: "GitHub failed; retry later or report it.",
  internal: "An unexpected failure; the message is deliberately generic.",
  invalid_api_key: "A person restores the key (docs/FLEET-SECRETS-SOP.md).",
  invalid_registry: "The server's skills registry is broken; a person fixes it.",
  invalid_request: "The message names the field to fix.",
  mcp_disabled: "A person turns MCP on (PLX_MC_MCP_ENABLED).",
  mcp_key_config_invalid: "Server key configuration; a person fixes it.",
  mcp_key_not_configured: "Server key configuration; a person fixes it.",
  mcp_service_principal_missing: "Server principal configuration; a person fixes it.",
  mcp_service_principal_revoked: "A person revoked this principal.",
  not_a_launcher: "Only launcher principals attach launch records.",
  not_found: "The message names the id that does not exist.",
  operator_not_allowed: "A person adds the operator to the PLX MC allowlist.",
  routing_cohort_disabled: "A server switch is off for this repository.",
  routing_metadata_disabled: "A server switch is off (PLX_MC_ROUTING_METADATA_ENABLED).",
  routing_proposals_disabled: "A server switch is off (PLX_MC_ROUTING_PROPOSALS_ENABLED).",
  routing_suggest_disabled: "A server switch is off (PLX_MC_ROUTING_SUGGEST_ENABLED).",
  routing_suggest_unavailable_for_cohort: "The autonomy dial keeps this repository in shadow.",
};

/** The next step for an error code, or undefined when an agent cannot fix it. */
export function errorHint(code: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(ERROR_HINTS, code) ? ERROR_HINTS[code] : undefined;
}

/** `{ error: { code, message, hint?, retryAfterMs? } }` for an ApiError: one shape for MCP tools and cursor REST routes. */
export function apiErrorBody(err: ApiError): McpToolErrorBody {
  const hint = errorHint(err.code);
  const retry = err.retryAfterMs !== undefined ? { retryAfterMs: err.retryAfterMs } : {};
  return { error: { code: err.code, message: err.message, ...(hint ? { hint } : {}), ...retry } };
}

/**
 * A failed tool call as MCP `isError` + the standard `{ error: { code, message } }`
 * JSON (plus an optional hint), mirroring the cursor REST envelope. Unexpected
 * throws map to `internal` without leaking their message, as cursorRoute does.
 */
export function mcpToolErrorResult(err: unknown) {
  let body: McpToolErrorBody;
  if (err instanceof ApiError) {
    body = apiErrorBody(err);
  } else {
    console.error("[mcp] unhandled tool error:", err);
    body = { error: { code: "internal", message: "Internal error." } };
  }
  return { ...mcpJsonResult(body), isError: true as const };
}

type ToolRegistrar = (...args: unknown[]) => unknown;

function withToolErrors(args: unknown[]): unknown[] {
  const last = args.length - 1;
  const callback = args[last];
  if (typeof callback !== "function") return args;
  const wrapped = async (...callbackArgs: unknown[]) => {
    try {
      return await callback(...callbackArgs);
    } catch (err) {
      return mcpToolErrorResult(err);
    }
  };
  return [...args.slice(0, last), wrapped];
}

/**
 * Route every tool registered on `server` afterwards (server.tool and
 * server.registerTool, including the split registration modules) through
 * mcpToolErrorResult. Without this the SDK flattens a thrown ApiError to its
 * message text and the code is lost. Call once, right after constructing the
 * server and before any registration.
 */
export function installMcpToolErrorEnvelope(server: McpServer): McpServer {
  const registrars = server as unknown as { tool: ToolRegistrar; registerTool: ToolRegistrar };
  const tool = registrars.tool.bind(server);
  const registerTool = registrars.registerTool.bind(server);
  registrars.tool = (...args) => tool(...withToolErrors(args));
  registrars.registerTool = (...args) => registerTool(...withToolErrors(args));
  return server;
}
