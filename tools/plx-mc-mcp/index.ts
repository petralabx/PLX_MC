#!/usr/bin/env node
import { taskSearchShape } from "./task-search-schema";
/**
 * PLX-MC MCP Server (stdio)
 *
 * Team-distributed MCP for PLX Mission Control task lifecycle + swarm delegation.
 * Proxies to PLX MC /api/cursor/* (REST) with standard envelope + audit trail.
 *
 * Remote alternative: register https://mc.plxcustomer.io/api/cursor/mcp (Streamable HTTP).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, isAbsolute } from "node:path";
import os from "node:os";
import { z } from "zod";
import { TASK_KINDS } from "./task-kind-schema";
import { callSwarmTool } from "./lib/swarm-client.mjs";
import { installToolErrorEnvelope, restErrorFromResponse } from "./lib/tool-errors.mjs";
import { registerRoutingTools } from "./routing-suggest-tools";

const DEFAULT_MC_BASE = "https://mc.plxcustomer.io";
const MC_BASE_URL = (process.env.MC_BASE_URL?.trim() || DEFAULT_MC_BASE).replace(/\/+$/, "");
const MC_MCP_API_KEY = (process.env.MC_MCP_API_KEY || "").replace(/\$\{.*\}/, "").trim();
const MC_OPERATOR_EMAIL = (process.env.MC_OPERATOR_EMAIL || process.env.MC_ACCOUNTABLE || "").trim().toLowerCase();
const MC_REPO = (process.env.MC_REPO || "").trim();
const MCP_ENABLED = (process.env.PLX_MC_MCP_ENABLED || "0").trim() !== "0";
const REQUEST_TIMEOUT_MS = Math.max(1000, Number(process.env.MC_MCP_TIMEOUT_MS || "15000") || 15000);
const SKILL_ID_PATTERN = /^[a-z][a-z0-9-]*$/;

const BOX_ID =
  process.env.SWARM_BOX_ID?.trim() ||
  os.hostname().replace(/[^A-Za-z0-9._-]/g, "-").toLowerCase() ||
  "unknown-box";
const RUNTIME = (process.env.MC_RUNTIME || "cursor").trim();
const WORKER_ID = `${BOX_ID}-${RUNTIME}-${process.pid}-${randomBytes(3).toString("hex")}`;

function disabledTool(name: string) {
  return {
    content: [{ type: "text" as const, text: `${name} is disabled (PLX_MC_MCP_ENABLED=0). Set PLX_MC_MCP_ENABLED=1 to enable.` }],
    isError: true,
  };
}

function requireConfig() {
  if (!MCP_ENABLED) throw new Error("PLX_MC_MCP_ENABLED=0");
  if (!MC_MCP_API_KEY) throw new Error("MC_MCP_API_KEY is not set");
  if (!MC_OPERATOR_EMAIL) throw new Error("MC_OPERATOR_EMAIL (or MC_ACCOUNTABLE) is not set");
  if (!MC_REPO) throw new Error("MC_REPO is not set (e.g. petralabx/PLX_MC)");
}

async function mcFetch(path: string, init?: { method?: string; body?: unknown; timeoutMs?: number }): Promise<unknown> {
  requireConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init?.timeoutMs ?? REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${MC_BASE_URL}/api/cursor${path}`, {
      method: init?.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": MC_MCP_API_KEY,
        "X-MC-Operator-Email": MC_OPERATOR_EMAIL,
        "X-MC-Runtime": RUNTIME,
        "X-MC-Worker-Id": WORKER_ID,
        "X-MC-Repo": MC_REPO,
      },
      body: init?.body ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    let json: unknown;
    try { json = JSON.parse(text); } catch { json = { raw: text }; }
    if (!res.ok) {
      // Keep the REST error code; installToolErrorEnvelope returns it as JSON.
      throw restErrorFromResponse(res.status, json);
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

function printResult(result: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
}

const server = new McpServer(
  { name: "PLX-MC", version: "1.0.0" },
  {
    instructions:
      "PLX Mission Control — create projects/buckets, checkout tasks (mc_checkout_task), suggest work (mc_suggest_work), report progress, complete with evidence, " +
      "manage the PLX skills directory, and optionally dispatch_to_swarm. Prefer mc_suggest_work when Task ID is unknown. Append MC-Checkout lines from checkout responses to PR bodies.",
  }
);
// Before any registration: failed tools return { error: { code, message } } JSON.
installToolErrorEnvelope(server);

server.tool("mc_self_check", "Validate PLX MC MCP auth and connectivity.", {}, async () => {
  if (!MCP_ENABLED) return disabledTool("mc_self_check");
  return printResult(await mcFetch("/self-check"));
});

server.tool(
  "mc_get_context",
  "Read compact or full MC context (tasks, buckets). Pass taskIds to scope; bucket scopes by project. Applied filters are echoed in meta.filter.",
  {
    depth: z.enum(["compact", "full"]).optional(),
    bucket: z.string().optional(),
    taskIds: z.array(z.string().min(1)).optional(),
  },
  async ({ depth, bucket, taskIds }) => {
    if (!MCP_ENABLED) return disabledTool("mc_get_context");
    const qs = new URLSearchParams();
    if (depth) qs.set("depth", depth);
    if (bucket) qs.set("bucket", bucket);
    if (taskIds?.length) {
      for (const id of taskIds) qs.append("taskIds", id);
    }
    const q = qs.toString();
    return printResult(await mcFetch(`/context${q ? `?${q}` : ""}`));
  }
);

server.tool(
  "mc_search_tasks",
  "Search/list MC tasks. `query` and `q` are aliases. Filter by bucket, stage, label, assignee, or completion date (completedAfter inclusive / completedBefore exclusive, ISO-8601). Rows carry completedAt and cancellation (stage=cancelled lists cancelled tasks). Page with nextCursor. Use searchComments/in for discussion and fields=compact. Applied filters are echoed in meta.filter.",
  taskSearchShape,
  async (args) => {
    if (!MCP_ENABLED) return disabledTool("mc_search_tasks");
    const qs = new URLSearchParams();
    if (args.q) qs.set("q", args.q);
    if (args.query) qs.set("query", args.query);
    if (args.bucket) qs.set("bucket", args.bucket);
    if (args.stage) qs.set("stage", args.stage);
    if (args.assignee) qs.set("assignee", args.assignee);
    if (args.completedAfter) qs.set("completedAfter", args.completedAfter);
    if (args.completedBefore) qs.set("completedBefore", args.completedBefore);
    if (args.limit) qs.set("limit", String(args.limit));
    if (args.label) qs.set("label", args.label);
    if (args.cursor) qs.set("cursor", args.cursor);
    if (args.fields) qs.set("fields", args.fields);
    if (args.searchComments !== undefined) qs.set("searchComments", String(args.searchComments));
    for (const field of args.in ?? []) qs.append("in", field);
    return printResult(await mcFetch(`/tasks?${qs.toString()}`));
  }
);

server.tool(
  "mc_create_project",
  "Create a Mission Control project. repos[] uses MC registry ids; the project is queued for the SharePoint Projects mirror.",
  {
    name: z.string().min(1),
    description: z.string().optional(),
    owner: z.string().min(1).optional(),
    health: z.enum(["track", "risk", "off"]).optional(),
    target: z.string().optional(),
    started: z.string().optional(),
    repos: z.array(z.string()).optional(),
    prd: z.string().nullable().optional(),
  },
  async (body) => {
    if (!MCP_ENABLED) return disabledTool("mc_create_project");
    return printResult(await mcFetch("/projects", { method: "POST", body }));
  }
);

server.tool(
  "mc_list_buckets",
  "Discover valid BKT-* bucket ids and minimal ownership/project metadata before creating tasks or buckets.",
  {
    includeArchived: z.boolean().optional(),
    q: z.string().optional().describe("Case-insensitive match against bucket id or name"),
    project: z.string().optional().describe("Exact parent project id"),
  },
  async ({ q, project, includeArchived }) => {
    if (!MCP_ENABLED) return disabledTool("mc_list_buckets");
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (project) params.set("project", project);
    if (includeArchived !== undefined) params.set("includeArchived", String(includeArchived));
    const query = params.size ? `?${params.toString()}` : "";
    return printResult(await mcFetch(`/buckets${query}`));
  }
);

server.tool(
  "mc_create_bucket",
  "Create a Mission Control bucket/initiative, optionally under an existing project. repos[] uses MC registry ids; the bucket is queued for the SharePoint Roadmap mirror.",
  {
    name: z.string().min(1),
    description: z.string().optional(),
    owner: z.string().min(1).optional(),
    health: z.enum(["track", "risk", "off"]).optional(),
    target: z.string().optional(),
    started: z.string().optional(),
    repos: z.array(z.string()).optional(),
    prd: z.string().nullable().optional(),
    project: z.string().nullable().optional().describe("Existing Mission Control project id"),
  },
  async (body) => {
    if (!MCP_ENABLED) return disabledTool("mc_create_bucket");
    return printResult(await mcFetch("/buckets", { method: "POST", body }));
  }
);

server.tool(
  "mc_update_bucket",
  "Archive/unarchive with {id, action, reason, force?}. Refuses open tasks unless forced; cannot mix with metadata. Patch fields on an existing Mission Control bucket/initiative (prd, health, owner, description, name, target, started, repos, project). Queues the SharePoint Roadmap mirror.",
  {
    action: z.enum(["archive", "unarchive"]).optional(),
    reason: z.string().trim().min(1).max(2000).optional(),
    force: z.boolean().optional(),
    id: z.string().min(1).describe("Existing BKT-* bucket id"),
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    owner: z.string().min(1).optional(),
    health: z.enum(["track", "risk", "off"]).optional(),
    target: z.string().optional(),
    started: z.string().optional(),
    repos: z.array(z.string()).optional(),
    prd: z.string().nullable().optional(),
    project: z.string().nullable().optional().describe("Existing Mission Control project id, or null to unparent"),
  },
  async (body) => {
    if (!MCP_ENABLED) return disabledTool("mc_update_bucket");
    return printResult(await mcFetch("/buckets", { method: "PATCH", body }));
  }
);

server.tool(
  "mc_create_task",
  "Create a new MC task. repos[] items are MC registry ids (portal-web, plx-mc, agentic-swarm) — not GitHub slugs. MC_REPO / X-MC-Repo stays the full GitHub slug for checkout/compliance and is a different namespace from repos[]. Pass kind; omitted kind defaults to kind:needs-review. When a person must verify the task (label verify:human or kind human-test), write the description in STE-lite: one instruction per sentence, 20 words per sentence in a numbered step, 25 per other sentence. Warns until 2026-10-24 (result.evidenceStandard), then refuses with evidence_standard.",
  {
    title: z.string().min(1),
    bucket: z.string().min(1),
    reporter: z.string().optional(),
    description: z.string().optional(),
    priority: z.enum(["urgent", "high", "medium", "low"]).optional(),
    repos: z
      .array(z.string())
      .optional()
      .describe(
        "MC registry ids only (e.g. portal-web, plx-mc, agentic-swarm). Not MC_REPO / GitHub slugs — those are for checkout/compliance."
      ),
    assignee: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Optional executor: a person id, or agent:<slug> for an agent. Only sp_mcp_portal may set an agent: assignee; any other MCP principal gets forbidden (403)."
      ),
    labels: z.array(z.string().trim().min(1).max(128)).max(100).optional(),
    kind: z.enum(TASK_KINDS).optional().describe("Task kind. Omitted defaults to kind:needs-review; must agree with any kind:* label."),
    idempotencyKey: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
      .optional()
      .describe(
        "Optional idempotency key. A repeat with the same key from the same principal returns the original task (replayed: true) and creates nothing. The same key with a different payload gets 409."
      ),
  },
  async (body) => {
    if (!MCP_ENABLED) return disabledTool("mc_create_task");
    return printResult(
      await mcFetch("/tasks", {
        method: "POST",
        body: { ...body, reporter: body.reporter || MC_OPERATOR_EMAIL },
      })
    );
  }
);

server.tool(
  "mc_checkout_task",
  "Check out a task; returns MC-Checkout stamp for PR body. Optional repo binds actor.repo for allowlisted consumers (e.g. petralabx/local-inference). Omitted repo keeps MC_REPO / X-MC-Repo. Unknown slugs fail closed.",
  {
    taskId: z.string().min(1),
    repo: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Optional GitHub slug (e.g. petralabx/local-inference) to bind checkout actor.repo. Allowlisted consumers only. Omitted = MC_REPO / X-MC-Repo."
      ),
    agent: z
      .string()
      .regex(/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/)
      .optional()
      .describe("Optional <runtime>/<lane> of the calling agent, recorded on the checkout; the gate holds each commit's Agent trailer to it."),
    reuse: z.boolean().optional().describe("Return your own live checkout of this task instead of minting a second one."),
    forceReason: z.string().min(1).max(2000).optional().describe("Why you take over a task another holder has a live checkout of."),
    baseSha: z.string().regex(/^[0-9a-fA-F]{40}$/).optional().describe("Full commit SHA your work starts from; the root of the checkout's SHA chain."),
    launchId: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/).optional().describe("Launch record id; launcher principals only."),
    branch: z
      .string()
      .regex(/^[A-Za-z0-9._/-]{1,255}$/)
      .optional()
      .describe("The PR head branch. On the portal a full lane refuses a checkout for a new PR (lane_cap_full); a branch with an open PR always passes."),
  },
  async ({ taskId, repo, agent, reuse, forceReason, baseSha, launchId, branch }) => {
    if (!MCP_ENABLED) return disabledTool("mc_checkout_task");
    return printResult(
      await mcFetch("/checkout", {
        method: "POST",
        body: {
          taskId,
          ...(repo ? { repo } : {}),
          ...(agent ? { agent } : {}),
          ...(reuse !== undefined ? { reuse } : {}),
          ...(forceReason ? { forceReason } : {}),
          ...(baseSha ? { baseSha } : {}),
          ...(launchId ? { launchId } : {}),
          ...(branch ? { branch } : {}),
        },
      })
    );
  }
);

server.tool(
  "mc_record_checkout_head",
  "Record a head you pushed on your own checkout's SHA chain (TASK-3410). Only the principal that took the checkout may record; a rebase or force-push needs this call. Idempotent per head.",
  {
    checkoutId: z.string().regex(/^dsp_[A-Za-z0-9]+$/),
    headSha: z.string().regex(/^[0-9a-fA-F]{40}$/),
    beforeSha: z.string().regex(/^[0-9a-fA-F]{40}$/).optional(),
    pr: z.number().int().positive().optional(),
  },
  async (body) => {
    if (!MCP_ENABLED) return disabledTool("mc_record_checkout_head");
    return printResult(await mcFetch("/checkout/head", { method: "POST", body }));
  }
);

server.tool(
  "mc_report_progress",
  "Report task progress (stage, notes). stage=cancelled needs cancelReason (duplicate|obsolete|superseded|delivered_without_pr) plus replacedBy (TASK-n, required for duplicate/superseded) and optional note; needs a principal granted task.cancel (cancel) / task.reopen (reopen); the operator email grants nothing. stage=verified is refused on a UAT ticket task (kind:code plus uat:<feedbackId>): only the portal's mc_update_task verify sets it.",
  {
    taskId: z.string().min(1),
    stage: z
      .enum(["backlog", "specced", "approved", "planned", "progress", "qa", "review", "merged", "verified"])
      .optional(),
    notes: z.string().optional(),
    progressPct: z.number().min(0).max(100).optional(),
    cancelReason: z.string().optional(),
    replacedBy: z.string().nullable().optional(),
    note: z.string().max(2000).optional(),
  },
  async (body) => {
    if (!MCP_ENABLED) return disabledTool("mc_report_progress");
    return printResult(await mcFetch("/progress", { method: "POST", body }));
  }
);

server.tool(
  "mc_list_conflicts",
  "List open SharePoint Sync conflicts (cf-* ids) so Ledger can Keep MC leftovers. Optional filters: entityId / taskId, field, limit. Auth is the MCP principal, not Entra. Does not resolve; never marks a task Verified.",
  {
    entityId: z.string().min(1).optional(),
    taskId: z.string().min(1).optional(),
    field: z.string().min(1).optional(),
    limit: z.number().int().min(1).max(500).optional(),
  },
  async ({ entityId, taskId, field, limit }) => {
    if (!MCP_ENABLED) return disabledTool("mc_list_conflicts");
    const qs = new URLSearchParams();
    if (entityId) qs.set("entityId", entityId);
    if (taskId) qs.set("taskId", taskId);
    if (field) qs.set("field", field);
    if (limit != null) qs.set("limit", String(limit));
    const q = qs.toString();
    return printResult(await mcFetch(`/conflicts${q ? `?${q}` : ""}`));
  }
);

server.tool(
  "mc_dismiss_conflict",
  "Close obsolete open Sync conflicts without applying either value, changing task stage or writing SharePoint. Records actor and optional reason; requires sync.mutate.",
  {
    conflictId: z.string().trim().min(1),
    reason: z.string().trim().min(1).max(2000).optional(),
  },
  async (body) => {
    if (!MCP_ENABLED) return disabledTool("mc_dismiss_conflict");
    return printResult(await mcFetch("/conflicts/dismiss", { method: "POST", body }));
  }
);

server.tool(
  "mc_dismiss_conflicts",
  "Close obsolete open Sync conflicts without applying either value, changing task stage or writing SharePoint. Records actor and optional reason; requires sync.mutate.",
  {
    conflictIds: z.array(z.string().trim().min(1)).min(1).max(500),
    reason: z.string().trim().min(1).max(2000).optional(),
  },
  async (body) => {
    if (!MCP_ENABLED) return disabledTool("mc_dismiss_conflicts");
    return printResult(await mcFetch("/conflicts/dismiss", { method: "POST", body }));
  }
);

server.tool(
  "mc_resolve_conflict",
  "Resolve one SharePoint Sync conflict. resolution is required: keep_mc (Ledger default for stage lag) or keep_sp (explicit only — never silent). Same engine as the Sync console; auth is the MCP principal, not Entra. Agents never mark a task Verified.",
  {
    conflictId: z.string().min(1),
    resolution: z.enum(["keep_mc", "keep_sp"]),
  },
  async (body) => {
    if (!MCP_ENABLED) return disabledTool("mc_resolve_conflict");
    return printResult(await mcFetch("/conflicts/resolve", { method: "POST", body }));
  }
);

server.tool(
  "mc_resolve_conflicts",
  "Resolve a batch of SharePoint Sync conflicts with one explicit resolution (keep_mc | keep_sp). Never default keep_sp. Ledger owns Keep MC for stage-lag leftovers. Agents never mark a task Verified.",
  {
    conflictIds: z.array(z.string().min(1)).min(1),
    resolution: z.enum(["keep_mc", "keep_sp"]),
  },
  async (body) => {
    if (!MCP_ENABLED) return disabledTool("mc_resolve_conflicts");
    return printResult(await mcFetch("/conflicts/resolve", { method: "POST", body }));
  }
);

server.tool(
  "mc_complete_task",
  "Complete agent work for a checkout credential. verificationCommands and rollback are required. Evidence saved earlier with mc_save_evidence is kept where this call sends nothing: testRun, shots and uploaded artifacts; the fields this call sends win. When a person must verify the work (verify:human, kind:human-test, or a high-risk filesChanged), the summary must be STE-lite; pass filesChanged. Warns until 2026-10-24 (result.evidenceStandard), then refuses with evidence_standard; fix the summary and call again on the same checkout.",
  {
    checkoutId: z.string().min(1),
    summary: z.string().min(1),
    commitSha: z.string().optional(),
    prUrl: z.string().optional(),
    outcome: z.enum(["completed", "blocked", "failed"]).optional()
      .describe("UAT code work requires prUrl unless outcome is blocked or failed."),
    // Pipeline contract: non-empty verificationCommands AND rollback (matches
    // completeTaskInputShape in src/lib/mcp/actions.ts).
    verificationCommands: z.array(z.string().trim().min(1)).min(1),
    filesChanged: z.array(z.string()).optional(),
    rollback: z.string().trim().min(1),
    testRun: z
      .object({
        suite: z.string().min(1),
        passed: z.number().int().nonnegative(),
        failed: z.number().int().nonnegative(),
        total: z.number().int().nonnegative().optional(),
      })
      .optional(),
    shots: z.array(z.object({ label: z.string(), cap: z.string() })).optional(),
  },
  async (body) => {
    if (!MCP_ENABLED) return disabledTool("mc_complete_task");
    return printResult(await mcFetch("/complete", { method: "POST", body }));
  }
);

server.tool(
  "mc_save_evidence",
  "Save summary, verificationCommands and rollback on a checked-out task before merge without completing it. Never changes stage. Compliance reads the saved evidence. Needs your own live checkout. Optional testRun and shots; fields you omit keep their saved values. The summary follows the mc_complete_task evidence standard; pass filesChanged.",
  {
    checkoutId: z.string().min(1),
    summary: z.string().min(1),
    verificationCommands: z.array(z.string().trim().min(1)).optional(),
    filesChanged: z.array(z.string()).optional(),
    rollback: z.string().optional(),
    testRun: z
      .object({
        suite: z.string().min(1),
        passed: z.number().int().nonnegative(),
        failed: z.number().int().nonnegative(),
        total: z.number().int().nonnegative().optional(),
      })
      .optional(),
    shots: z.array(z.object({ label: z.string(), cap: z.string() })).optional(),
  },
  async (body) => {
    if (!MCP_ENABLED) return disabledTool("mc_save_evidence");
    return printResult(await mcFetch("/save-evidence", { method: "POST", body }));
  }
);

/**
 * A video file is too big to send inline (TASK-3167): MC opens a SharePoint
 * upload session, this process PUTs the file there, and MC checks what landed.
 */
async function uploadVideoFile(filePath: string, fileName: string, fields: Record<string, unknown>): Promise<unknown> {
  const bytes = await readFile(filePath);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const started = (await mcFetch("/evidence", {
    method: "POST",
    body: { ...fields, fileName, size: bytes.length, sha256 },
  })) as { data?: { upload?: { url: string; uploadedName: string; chunkBytes: number } } };
  const upload = started.data?.upload;
  if (!upload) return started; // The task already has this file.
  for (let start = 0; start < bytes.length; start += upload.chunkBytes) {
    const chunk = bytes.subarray(start, start + upload.chunkBytes);
    // The session URL carries its own auth: never send the MC key or a token to it.
    const res = await fetch(upload.url, {
      method: "PUT",
      headers: { "Content-Range": `bytes ${start}-${start + chunk.length - 1}/${bytes.length}` },
      body: chunk,
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`The SharePoint upload session returned ${res.status} at byte ${start}. Run the tool again.`);
  }
  // MC reads the whole file back to check its type and SHA-256.
  return mcFetch("/evidence", {
    method: "POST",
    body: { ...fields, fileName, sha256, uploadedName: upload.uploadedName },
    timeoutMs: Math.max(REQUEST_TIMEOUT_MS, 240_000),
  });
}

server.tool(
  "mc_upload_evidence",
  "Upload evidence that a person opens to verify the work: kind diagram (svg, png), screenshot (png, jpeg, webp; annotate it) or web-page (html), 3 MiB or less, or video (mp4, webm; 100 MiB or less, send filePath) with a caption. Send filePath (an absolute path to a local file) or contentBase64 with fileName. Needs a live checkout. MC stores it on SharePoint under <system>/<project>/<bucket>/<task id> and records the link and SHA-256 on the task. A task a person must verify needs one before the compliance gate passes (warning only while uploads are off, then until 2026-11-01). evidence_store_unavailable says what a person must set up. Complex work a person must verify also needs a video from the plx-knowledge-video skill (warning only until 2026-11-01).",
  {
    checkoutId: z.string().min(1),
    kind: z.enum(["diagram", "screenshot", "web-page", "video"]),
    contentType: z.string().trim().min(1),
    caption: z.string().trim().min(1).max(500),
    // Absolute: a relative path would resolve against this server's working directory, not the agent's.
    filePath: z.string().min(1).refine(isAbsolute, "filePath must be an absolute path.").optional(),
    contentBase64: z.string().min(1).optional(),
    fileName: z.string().trim().min(1).max(120).optional(),
  },
  async ({ filePath, contentBase64, fileName, ...rest }) => {
    if (!MCP_ENABLED) return disabledTool("mc_upload_evidence");
    if (!filePath === !contentBase64) throw new Error("Send exactly one of filePath or contentBase64.");
    const name = fileName ?? (filePath ? basename(filePath) : undefined);
    if (!name) throw new Error("fileName is required with contentBase64.");
    if (filePath && rest.kind === "video") return printResult(await uploadVideoFile(filePath, name, rest));
    const content = contentBase64 ?? (await readFile(filePath!)).toString("base64");
    return printResult(
      await mcFetch("/evidence", { method: "POST", body: { ...rest, fileName: name, contentBase64: content } })
    );
  }
);

server.tool(
  "mc_list_skills",
  "List PLX skills catalog entries, optionally filtered by query, tag, or status.",
  {
    q: z.string().optional(),
    tag: z.string().optional(),
    status: z.string().optional(),
  },
  async (args) => {
    if (!MCP_ENABLED) return disabledTool("mc_list_skills");
    const qs = new URLSearchParams();
    if (args.q) qs.set("q", args.q);
    if (args.tag) qs.set("tag", args.tag);
    if (args.status) qs.set("status", args.status);
    const q = qs.toString();
    return printResult(await mcFetch(`/skills/list${q ? `?${q}` : ""}`));
  }
);

server.tool(
  "mc_install_skills",
  "Build local install/sync scripts for PLX company skills.",
  {
    ids: z.array(z.string().regex(SKILL_ID_PATTERN)).optional(),
    mode: z.enum(["install", "sync"]).optional(),
    runtimes: z.array(z.enum(["cursor", "claude"])).optional(),
    projectRoot: z.string().min(1).optional(),
    localRegistry: z.unknown().optional(),
  },
  async (body) => {
    if (!MCP_ENABLED) return disabledTool("mc_install_skills");
    return printResult(await mcFetch("/skills/install", { method: "POST", body }));
  }
);

server.tool(
  "mc_sync_skills",
  "Compare a local PLX skills registry against the approved catalog.",
  {
    packageId: z.string().min(1).optional(),
    localRegistry: z.unknown().optional(),
    runtimes: z.array(z.enum(["cursor", "claude"])).optional(),
  },
  async (body) => {
    if (!MCP_ENABLED) return disabledTool("mc_sync_skills");
    return printResult(await mcFetch("/skills/sync", { method: "POST", body }));
  }
);

server.tool(
  "mc_submit_skill",
  "Submit a proposed skill to the PLX skills directory review queue.",
  {
    id: z.string().regex(SKILL_ID_PATTERN),
    name: z.string().min(1),
    description: z.string().min(1),
    skillMd: z.string().min(1),
    tags: z.array(z.string().min(1)).optional(),
    owner: z.string().min(1).optional(),
  },
  async (body) => {
    if (!MCP_ENABLED) return disabledTool("mc_submit_skill");
    return printResult(await mcFetch("/skills/submit", { method: "POST", body }));
  }
);

// ── Wave 4: agent read tools + approval request (cursor REST proxies) ──

server.tool(
  "mc_get_task",
  "Read one MC task: the task, accountable owner, evidence, checkouts and recent mc_events history. Checkout ids are redacted to checkoutRef (dsp_…last4). Read-only; restricted-project tasks return not_found.",
  { id: z.string().min(1).describe("TASK-* id") },
  async ({ id }) => {
    if (!MCP_ENABLED) return disabledTool("mc_get_task");
    return printResult(await mcFetch(`/tasks/${encodeURIComponent(id)}`));
  }
);

server.tool(
  "mc_list_checkouts",
  "List checkouts (dispatches), newest first, as checkoutRef (dsp_…last4) — never the usable dsp_* id. Filters: repo (full owner/name slug), taskId, active (true = unrevoked and unexpired). Read-only.",
  {
    repo: z.string().min(1).optional().describe("Full GitHub slug, e.g. petralabx/PLX_MC"),
    taskId: z.string().min(1).optional(),
    active: z.boolean().optional(),
    limit: z.number().int().min(1).max(200).optional(),
  },
  async ({ repo, taskId, active, limit }) => {
    if (!MCP_ENABLED) return disabledTool("mc_list_checkouts");
    const qs = new URLSearchParams();
    if (repo) qs.set("repo", repo);
    if (taskId) qs.set("taskId", taskId);
    if (active !== undefined) qs.set("active", String(active));
    if (limit != null) qs.set("limit", String(limit));
    const q = qs.toString();
    return printResult(await mcFetch(`/checkouts${q ? `?${q}` : ""}`));
  }
);

server.tool(
  "mc_search_knowledge",
  "Search the company brain (Ask the Brain / VMC knowledge). Each hit carries provenance: id, source, namespace, score. Read-only.",
  {
    q: z.string().describe("Search text"),
    limit: z.number().int().min(1).max(25).optional(),
  },
  async ({ q, limit }) => {
    if (!MCP_ENABLED) return disabledTool("mc_search_knowledge");
    const qs = new URLSearchParams({ q });
    if (limit != null) qs.set("limit", String(limit));
    return printResult(await mcFetch(`/knowledge/search?${qs.toString()}`));
  }
);

server.tool(
  "mc_verify_pr",
  "Compute the compliance-gate verdict for a PR from its MC-Checkout stamps and changed files. Read-only (recorded:false); the GitHub `compliance` check stays the merge authority.",
  {
    repo: z.string().min(1).describe("Full GitHub slug, e.g. petralabx/PLX_MC"),
    pr: z.number().int().positive(),
  },
  async ({ repo, pr }) => {
    if (!MCP_ENABLED) return disabledTool("mc_verify_pr");
    const qs = new URLSearchParams({ repo, pr: String(pr) });
    return printResult(await mcFetch(`/verify?${qs.toString()}`));
  }
);

server.tool(
  "mc_request_approval",
  "Raise a runtime approval gate on a task. The task freezes input-required until a human other than the requester decides it in the Approvals inbox. Send the approver the returned gateLink.",
  {
    taskId: z.string().min(1),
    reason: z.string().min(1).max(500),
    checkoutId: z.string().min(1).optional().describe("Full dsp_* id; blocks that checkout until approved"),
    proposal: z
      .object({
        summary: z.string().min(1).max(1000),
        action: z.string().min(1).max(500).optional(),
        diff: z.string().max(32768).optional(),
        plan: z.string().max(32768).optional(),
        risk: z.enum(["low", "medium", "high", "critical"]).optional(),
      })
      .strict()
      .optional()
      .describe("Structured proposal for the reviewer (32 KB total cap)"),
    scope: z
      .discriminatedUnion("kind", [
        z.object({ kind: z.literal("launch"), lane: z.string(), promptHash: z.string() }).strict(),
        z.object({ kind: z.literal("merge"), repo: z.string(), pr: z.number().int().positive(), headSha: z.string() }).strict(),
        z.object({ kind: z.literal("flags"), flags: z.array(z.string()).min(1).max(20) }).strict(),
      ])
      .optional()
      .describe("TASK-3408: what the approval covers; the server validates the formats"),
    sourceRef: z.string().min(1).max(500).optional().describe("Where the request came from (message link, ticket)"),
  },
  async (body) => {
    if (!MCP_ENABLED) return disabledTool("mc_request_approval");
    return printResult(await mcFetch("/request-approval", { method: "POST", body }));
  }
);

server.tool(
  "mc_ask_question",
  "Ask one named person (directory id or email, never an agent) a question on a task, with up to 8 options, a recommendation (TASK-3567) and optional context shown under the question (TASK-3720). It shows only on their Approvals screen; only they can answer, and the answer is posted to the task as a comment. Send them the returned questionLink. Agents never answer questions.",
  {
    taskId: z.string().min(1),
    addressee: z.string().min(1).max(254).describe("Directory id (e.g. ricardo) or email"),
    question: z.string().min(1).max(500),
    options: z.array(z.string().min(1).max(200)).max(8).optional().describe("Multiple-choice options"),
    recommended: z.number().int().nonnegative().optional().describe("Index of the option you recommend"),
    recommendationReason: z.string().min(1).max(1000).optional().describe("Why you recommend it"),
    context: z.string().trim().max(2000).optional().describe("Background shown under the question"),
  },
  async (body) => {
    if (!MCP_ENABLED) return disabledTool("mc_ask_question");
    return printResult(await mcFetch("/ask-question", { method: "POST", body }));
  }
);

server.tool(
  "mc_verify_approval",
  "Check whether a signed approval on a task covers a launch {lane?, promptHash?}, a merge {repo?, pr?, headSha?} or a flag {flag?} now (TASK-3408). ok is true only for a person's unexpired, validly signed approval in scope; otherwise reason names the first failure.",
  {
    taskId: z.string().min(1),
    approvalId: z.string().optional(),
    expect: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("launch"), lane: z.string().optional(), promptHash: z.string().optional() }).strict(),
      z.object({ kind: z.literal("merge"), repo: z.string().optional(), pr: z.number().int().positive().optional(), headSha: z.string().optional() }).strict(),
      z.object({ kind: z.literal("flags"), flag: z.string().optional() }).strict(),
    ]),
  },
  async (body) => {
    if (!MCP_ENABLED) return disabledTool("mc_verify_approval");
    return printResult(await mcFetch("/approvals/verify", { method: "POST", body }));
  }
);

server.tool(
  "mc_get_approval_gate",
  "Read an approval gate (pending/approved/rejected, decider, decidedAt, note) by checkoutId or taskId. waitSeconds (max 25) long-polls and returns early on a decision. Only the service principal that raised the gate may read it; returns checkoutRef, never the usable checkout id.",
  {
    checkoutId: z.string().min(1).optional(),
    taskId: z.string().min(1).optional(),
    gateId: z.string().min(1).optional(),
    waitSeconds: z.number().min(0).max(25).optional(),
  },
  async ({ checkoutId, taskId, gateId, waitSeconds }) => {
    if (!MCP_ENABLED) return disabledTool("mc_get_approval_gate");
    const qs = new URLSearchParams();
    if (checkoutId) qs.set("checkoutId", checkoutId);
    if (taskId) qs.set("taskId", taskId);
    if (gateId) qs.set("gateId", gateId);
    if (waitSeconds !== undefined) qs.set("waitSeconds", String(waitSeconds));
    return printResult(await mcFetch(`/approval-gate?${qs.toString()}`));
  }
);

// ── TASK-2326: release stray or expired checkouts (cursor REST proxies) ──

const releaseCheckoutItem = {
  checkoutId: z.string().min(1).optional().describe("Full dsp_* checkout id"),
  checkoutRef: z.string().min(1).optional().describe("Redacted ref dsp_…last4; needs taskId"),
  taskId: z.string().min(1).optional().describe("TASK-* id; required with checkoutRef"),
  reason: z.string().min(1).max(500),
};

server.tool(
  "mc_release_checkout",
  "Release a stray or expired checkout lease (audits checkout.released). Target the full checkoutId, or checkoutRef (dsp_…last4) plus taskId. Only the checkout's accountable human, an admin, or a Ledger/CoS steward may release. Refuses an already-released lease, and refuses an expired-lease reason (open_pr_expiry_exception) while an open PR carries the stamp. Never changes the task stage or Verified.",
  releaseCheckoutItem,
  async (body) => {
    if (!MCP_ENABLED) return disabledTool("mc_release_checkout");
    return printResult(await mcFetch("/checkouts/release", { method: "POST", body }));
  }
);

server.tool(
  "mc_release_checkouts",
  "Batch form of mc_release_checkout (max 50 items), with a per-item outcome; refused[] names each unreleased item by checkoutRef, taskId, code and reason.",
  { items: z.array(z.object(releaseCheckoutItem)).min(1).max(50) },
  async (body) => {
    if (!MCP_ENABLED) return disabledTool("mc_release_checkouts");
    return printResult(await mcFetch("/checkouts/release-batch", { method: "POST", body }));
  }
);

// Hub metadata tools: keep strict objects so forbidden fields are never stripped.
// The REST action owns semantic validation and per-item batch outcomes.
const taskUpdatePatch = z.object({
  labels: z.array(z.string().trim().min(1).max(128)).max(100).optional(),
  addLabels: z.array(z.string().trim().min(1).max(128)).max(100).optional(),
  removeLabels: z.array(z.string().trim().min(1).max(128)).max(100).optional(),
  description: z.string().max(32_000).optional(),
  appendDescription: z.string().trim().min(1).max(32_000).optional(),
  title: z.string().trim().min(1).max(255).optional(),
  priority: z.enum(["urgent", "high", "medium", "low"]).optional(),
  cancel: z.object({
    reason: z.string().trim().min(1).describe("duplicate | obsolete | superseded | delivered_without_pr"),
    replacedBy: z.string().trim().nullable().optional().describe("TASK-n; required for duplicate and superseded"),
    note: z.string().trim().max(2000).optional(),
  }).strict().optional(),
  reopen: z.object({
    stage: z.enum(["backlog", "specced", "approved", "planned", "progress", "qa", "review"]).optional(),
    note: z.string().trim().max(2000).optional(),
  }).strict().optional(),
  bucket: z.string().trim().regex(/^BKT-[A-Z0-9-]+$/).optional(),
  note: z.string().trim().min(1).max(500).optional(),
  // TASK-3407: need task.assign and reason (10+ characters).
  assignee: z.string().trim().min(1).max(128).nullable().optional(),
  accountableOwner: z.string().trim().min(1).max(128).optional(),
  reason: z.string().trim().min(10).max(2000).optional(),
}).strict();

server.registerTool("mc_update_project", {
  description: "Archive/unarchive with {projectId, action, reason, force?}; cascades buckets, refuses open tasks unless forced. Steward edit of a Mission Control project: {projectId, status?, owner?, description?, name?, note?}, at least one field. status=closed removes the project from active nav, counts and pickers and blocks new tasks/buckets in it; status=active reopens. owner must be a known person, agent or service principal. Audits project.updated with before/after. health is not changed here.",
  inputSchema: z.object({
    projectId: z.string().trim().min(1).max(128),
    action: z.enum(["archive", "unarchive"]).optional(),
    reason: z.string().trim().min(1).max(2000).optional(),
    force: z.boolean().optional(),
    status: z.enum(["active", "closed"]).optional(),
    owner: z.string().trim().min(1).max(320).optional(),
    description: z.string().max(32_000).optional(),
    name: z.string().trim().min(1).max(255).optional(),
    note: z.string().trim().max(2_000).optional(),
  }).strict(),
}, async (body) => {
  if (!MCP_ENABLED) return disabledTool("mc_update_project");
  return printResult(await mcFetch("/projects", { method: "PATCH", body }));
});

server.registerTool("mc_list_projects", {
  description: "List projects with id, name, owner, status, health, bucketCount, openTaskCount, doneTaskCount and closedAt. status: active (default) | closed | all; q matches id or name.",
  inputSchema: z.object({
    includeArchived: z.boolean().optional(),
    status: z.enum(["active", "closed", "all"]).optional(),
    q: z.string().trim().max(200).optional(),
  }).strict(),
}, async ({ status, q, includeArchived }) => {
  if (!MCP_ENABLED) return disabledTool("mc_list_projects");
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (includeArchived !== undefined) params.set("includeArchived", String(includeArchived));
  if (q) params.set("q", q);
  const query = params.size ? `?${params.toString()}` : "";
  return printResult(await mcFetch(`/projects${query}`));
});

// Draft Projects (TASK-4059). The server validates plan and research in full
// (src/lib/drafts/schema.ts); this client passes them through.
server.registerTool("mc_save_draft", {
  description: "Create or edit a Draft Project: a reviewable plan (one project, buckets and tasks under draft keys P, B1, T1) plus its research (summary, context, findings citing sources by ref, 2+ approaches with exactly one chosen, recommendation, risks, open questions, sources, artifacts). Nothing in a draft is live. Omit draftId to create (title required; the author is your operator email). With draftId, each section you send replaces that section. withdraw {reason} closes it. Returns preflight: the checks mc_submit_draft runs. Off when PLX_MC_DRAFTS_ENABLED=0.",
  inputSchema: z.object({
    draftId: z.string().trim().min(1).optional(),
    title: z.string().trim().min(1).max(255).optional(),
    plan: z.unknown().optional().describe("{project:{key:'P', existing, name, owner, repos, desc}, buckets:[{key:'B1', name, owner, repos, desc}], tasks:[{key:'T1', bucket:'B1', title, description, priority, kind, repos, accountableOwner, dependsOn}]}"),
    research: z.unknown().optional().describe("{summary, context, findings:[{text, sources:['[1]']}], approaches:[{name, pros, cons, risk, effort, chosen}], recommendation, risks:[{text, likelihood, impact, mitigation}], openQuestions, sources:[{ref:'[1]', title, url, kind, excerpt, accessed}], artifacts:[{kind, name, url|inline}]}"),
    visibility: z.enum(["shared", "restricted"]).optional(),
    members: z.array(z.string().trim().min(1).max(320)).max(200).optional(),
    reviewers: z.array(z.string().trim().min(1).max(320)).max(20).optional(),
    withdraw: z.object({ reason: z.string().trim().min(10).max(2000) }).strict().optional(),
  }).strict(),
}, async (body) => {
  if (!MCP_ENABLED) return disabledTool("mc_save_draft");
  return printResult(await mcFetch("/drafts", { method: "POST", body }));
});

server.registerTool("mc_submit_draft", {
  description: "Freeze a draft's working copy as its next version and open it for review. Refuses with draft_not_ready and every problem when the research is incomplete or the plan fails preflight. Raises likely duplicate open tasks as non-blocking findings.",
  inputSchema: z.object({ draftId: z.string().trim().min(1) }).strict(),
}, async (body) => {
  if (!MCP_ENABLED) return disabledTool("mc_submit_draft");
  return printResult(await mcFetch("/drafts/submit", { method: "POST", body }));
});

server.registerTool("mc_get_draft", {
  description: "Read a draft you can see (working copy, status, version, digest, reviews marked stale, open blocking findings), or one frozen version with version.",
  inputSchema: z.object({
    draftId: z.string().trim().min(1),
    version: z.number().int().positive().optional(),
  }).strict(),
}, async ({ draftId, version }) => {
  if (!MCP_ENABLED) return disabledTool("mc_get_draft");
  const query = version !== undefined ? `?version=${version}` : "";
  return printResult(await mcFetch(`/drafts/${encodeURIComponent(draftId)}${query}`));
});

server.registerTool("mc_list_drafts", {
  description: "List drafts you can see, newest change first. status: open (default) | all | drafting | in_review | accepted | withdrawn; q matches id or title; mine; needsMyReview.",
  inputSchema: z.object({
    status: z.enum(["open", "all", "drafting", "in_review", "accepted", "withdrawn"]).optional(),
    q: z.string().trim().max(200).optional(),
    mine: z.boolean().optional(),
    needsMyReview: z.boolean().optional(),
  }).strict(),
}, async ({ status, q, mine, needsMyReview }) => {
  if (!MCP_ENABLED) return disabledTool("mc_list_drafts");
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (q) params.set("q", q);
  if (mine !== undefined) params.set("mine", String(mine));
  if (needsMyReview !== undefined) params.set("needsMyReview", String(needsMyReview));
  const query = params.size ? `?${params.toString()}` : "";
  return printResult(await mcFetch(`/drafts${query}`));
});

server.registerTool("mc_review_draft", {
  description: "Review a submitted draft's current version: comment, finding (blocking: true refuses Accept until closed), approve (advisory for an agent) or request_changes, with an optional target (plan key or research section). Send version: the version you read; a newer one refuses with draft_version_moved. resolve {findingId} closes a finding you raised. Agents never accept drafts.",
  inputSchema: z.object({
    draftId: z.string().trim().min(1),
    kind: z.enum(["comment", "finding", "approve", "request_changes", "resolve"]),
    version: z.number().int().positive().optional(),
    body: z.string().trim().min(1).max(8000).optional(),
    blocking: z.boolean().optional(),
    target: z.string().trim().max(120).optional(),
    findingId: z.string().trim().min(1).optional(),
  }).strict(),
}, async (body) => {
  if (!MCP_ENABLED) return disabledTool("mc_review_draft");
  return printResult(await mcFetch("/drafts/review", { method: "POST", body }));
});

server.registerTool("mc_upload_draft_artifact", {
  description: "Upload a file to a draft you wrote, as one of its research artifacts: kind diagram (svg, png), screenshot (png, jpeg, webp) or web-page (html), 3 MiB or less. Send filePath (an absolute path to a local file) or contentBase64 with fileName. MC stores it in the Mission Control library under Drafts/DRF-<n>/ and adds it to the draft's artifacts as a link named name (default fileName). A restricted draft refuses with draft_restricted, because the library is shared; a Trading Lab draft (its plan names petralabx/agentic-swarm) refuses with evidence_store_unavailable, because its files go on its own site. evidence_store_unavailable says what a person must set up.",
  inputSchema: z.object({
    draftId: z.string().trim().min(1),
    kind: z.enum(["diagram", "screenshot", "web-page"]),
    contentType: z.string().trim().min(1),
    name: z.string().trim().min(1).max(255).optional(),
    // Absolute: a relative path would resolve against this server's working directory, not the agent's.
    filePath: z.string().min(1).refine(isAbsolute, "filePath must be an absolute path.").optional(),
    contentBase64: z.string().min(1).optional(),
    fileName: z.string().trim().min(1).max(120).optional(),
  }).strict(),
}, async ({ filePath, contentBase64, fileName, ...rest }) => {
  if (!MCP_ENABLED) return disabledTool("mc_upload_draft_artifact");
  if (!filePath === !contentBase64) throw new Error("Send exactly one of filePath or contentBase64.");
  const name = fileName ?? (filePath ? basename(filePath) : undefined);
  if (!name) throw new Error("fileName is required with contentBase64.");
  const content = contentBase64 ?? (await readFile(filePath!)).toString("base64");
  return printResult(await mcFetch("/drafts/artifact", { method: "POST", body: { ...rest, fileName: name, contentBase64: content } }));
});

server.registerTool("mc_update_task", {
  description: "Hub only: {taskId, patch} edits labels (replace) or addLabels/removeLabels, description (replace) or appendDescription, title, priority, bucket (+note; moves the task, audits task.moved). Mutually exclusive forms cannot mix. Exactly one kind:* (code|admin-setup|human-test|decision|blocked-external|needs-review) must remain: two kinds or an unknown kind is rejected, removing the only kind leaves kind:needs-review, swap with removeLabels:[old], addLabels:[new]. Exactly one lane:* must remain, unless a lane-less task only gains/loses kind:* or closed:* closure labels (or not-needed; on a UAT ticket task with kind:code plus uat:<feedbackId>, also uat:hold, uat-attempt:<n>, uat:blocked and uat:cause:<x>) in a label-only patch, is moved by bucket alone, or is merged/verified. Also cancel {reason: duplicate|obsolete|superseded|delivered_without_pr, replacedBy? (TASK-n; required for duplicate/superseded), note?} and reopen {stage?, note?}: stage changes, not combinable with other fields; needs a principal granted task.cancel (cancel) / task.reopen (reopen); the operator email grants nothing; audit task.cancelled / task.reopened. assignee (person id or agent:<slug>; null clears) and accountableOwner (a person) need task.assign plus reason (10+ characters); audits task.assignment.changed. Evidence, checkouts and unknown fields are rejected. Audits task.updated; labels stay DB-only, other fields use normal ToDos sync.",
  inputSchema: z.object({
    taskId: z.string().trim().min(1).max(128),
    patch: taskUpdatePatch,
  }).strict(),
}, async (body) => {
  if (!MCP_ENABLED) return disabledTool("mc_update_task");
  return printResult(await mcFetch("/tasks/update", { method: "POST", body }));
});

server.registerTool("mc_update_tasks", {
  description: "Batch mc_update_task: {items:[{taskId, patch}]}, 1–100 items. Each item returns its own outcome, including validation errors. Same fields, kind rule, lane rule and DB-only labels as mc_update_task (exactly one kind:*; lane-less tasks may gain/lose kind:* in a label-only patch).",
  inputSchema: z.object({
    items: z.array(z.unknown().describe("One {taskId, patch} object using mc_update_task fields.")).min(1).max(100),
  }).strict(),
}, async (body) => {
  if (!MCP_ENABLED) return disabledTool("mc_update_tasks");
  return printResult(await mcFetch("/tasks/update-batch", { method: "POST", body }));
});

server.tool(
  "mc_report_session_telemetry",
  "Report this agent session's token usage and cost estimate (cents) at close. One row per sessionId; a replay is a no-op. Feeds per-runtime and per-bucket cost-per-completed-task in /api/agent-metrics?rollup=cost.",
  {
    sessionId: z.string().min(1).max(120),
    taskId: z.string().min(1).optional(),
    checkoutId: z.string().min(1).optional(),
    model: z.string().max(120).optional(),
    tokensIn: z.number().int().min(0),
    tokensOut: z.number().int().min(0),
    costCents: z.number().int().min(0).optional(),
  },
  async (body) => {
    if (!MCP_ENABLED) return disabledTool("mc_report_session_telemetry");
    return printResult(await mcFetch("/session-telemetry", { method: "POST", body }));
  }
);

registerRoutingTools({
  server,
  mcpEnabled: MCP_ENABLED,
  mcFetch,
  printResult,
  disabledTool,
});

server.tool(
  "dispatch_to_swarm",
  "Delegate work to the agentic-swarm COS orchestrator.",
  {
    message: z.string().min(1),
    team: z.string().optional(),
    thread_id: z.string().optional(),
    deep: z.boolean().optional(),
    timeout_seconds: z.number().optional(),
  },
  async (args) => {
    const r = await callSwarmTool("dispatch_to_swarm", args);
    return { content: [{ type: "text" as const, text: r.text }], isError: r.isError };
  }
);

server.tool("list_swarm_teams", "List valid swarm dispatch team routes.", {}, async () => {
  const r = await callSwarmTool("list_swarm_teams");
  return { content: [{ type: "text" as const, text: r.text }] };
});

server.tool("swarm_health", "Check swarm API health.", {}, async () => {
  const r = await callSwarmTool("swarm_health");
  return { content: [{ type: "text" as const, text: r.text }], isError: r.isError };
});

const transport = new StdioServerTransport();
await server.connect(transport);
