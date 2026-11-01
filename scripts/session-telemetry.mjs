// Session-end token telemetry (TASK-4273). Reports one mc_report_session_telemetry
// row per agent session (POST /api/cursor/session-telemetry), so the evaluation
// loop gets real token counts.
//
// Shared file: PLX_MC and plx-customer-portal carry the same copy. Each repo's
// session-end hook imports reportTelemetry and runs it next to its session
// artifact. Change both copies together.
//
// Token counts:
//   Claude Code  the assistant `usage` blocks in the transcript at transcript_path
//                and in its subagent transcripts (<session>/subagents/*.jsonl),
//                one count per message id (a message's content blocks repeat its
//                usage on several lines).
//   Cursor       token counts in the hook payload when it has them. Cursor's
//                sessionEnd payload has none today, so a Cursor session reports
//                nothing (recorded on TASK-4273).
//   tokensIn is every input token: input + cache creation + cache read
//   (Anthropic usage names). tokensOut is output tokens. No costCents is sent.
//
// Limits: MC keeps one row per sessionId (dedup key telemetry:<sessionId>), so a
// resumed session that keeps its id is not counted again, and a copied
// transcript under a new id is counted twice.
//
// FAIL-OPEN BY DESIGN: no credentials, no counts, an HTTP error, a redirect, a
// non-JSON answer or the time budget running out logs one line and returns.
// Nothing is queued and no key is printed. Redirects are refused, so the key
// never goes to another host.
//
// Env:
//   SESSION_TELEMETRY_ENABLED  set to "0" to disable telemetry (default: enabled).
//                              SESSION_BRAIN_ENABLED switches only the artifact.
//   MC_BASE_URL, MC_MCP_API_KEY, MC_OPERATOR_EMAIL (or MC_ACCOUNTABLE)
//                              Mission Control credentials, read the way
//                              scripts/compliance-checkout.mjs reads them
//   MC_REPO                    owner/name for x-mc-repo (default: the origin remote)
//   MC_CHECKOUT_ID             dsp_* checkout of this session (default: the
//                              MC-Checkout trailer of the newest commit made in
//                              this session on this branch)
//
// Node stdlib only.

import { execFileSync } from "node:child_process";
import { createReadStream, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";

const TELEMETRY_ROUTE = "/api/cursor/session-telemetry";
// Inside the 8 s Cursor and 10 s Claude Code hook timeouts.
const DEFAULT_BUDGET_MS = 8000;
const SCAN_SHARE_MS = 3000;
const FETCH_SHARE_MS = 4000;
const MIN_FETCH_MS = 300;
const GIT_TIMEOUT_MS = 1500;
const MAX_COMMITS = 50;
const TRANSCRIPT_MAX_BYTES = 256 * 1024 * 1024;
const CHECKOUT_ID = /^dsp_[A-Za-z0-9]+$/;
const REPO_SLUG = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const RUNTIMES = new Set(["cursor", "claude-code", "hermes", "swarm", "other"]);

function nonEmpty(value) {
  return typeof value === "string" ? value.trim() : "";
}

function git(cwd, args, timeoutMs = GIT_TIMEOUT_MS) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      timeout: Math.max(1, timeoutMs),
      stdio: ["ignore", "pipe", "ignore"],
    }).trimEnd();
  } catch {
    return "";
  }
}

function tokenCount(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

function anthropicInput(usage) {
  return (
    tokenCount(usage.input_tokens) +
    tokenCount(usage.cache_creation_input_tokens) +
    tokenCount(usage.cache_read_input_tokens)
  );
}

/** The transcript and its subagent transcripts (<dir>/<session>/subagents/*.jsonl). */
function transcriptFiles(transcriptPath) {
  const files = [transcriptPath];
  const subagents = path.join(
    path.dirname(transcriptPath),
    path.basename(transcriptPath, ".jsonl"),
    "subagents"
  );
  try {
    for (const name of readdirSync(subagents).sort()) {
      if (name.endsWith(".jsonl")) files.push(path.join(subagents, name));
    }
  } catch {
    // No subagents directory.
  }
  return files;
}

/**
 * Token usage of a Claude Code session: { tokensIn, tokensOut, model, messages, startedAt }.
 * Each message id counts once across the transcript and its subagent transcripts.
 * null when the main transcript is unreadable, the files pass maxBytes together,
 * nothing carries usage, or reading takes longer than deadlineMs (a partial sum
 * is never reported).
 */
export async function sumTranscriptUsage(
  transcriptPath,
  { deadlineMs = SCAN_SHARE_MS, maxBytes = TRANSCRIPT_MAX_BYTES } = {}
) {
  if (!nonEmpty(transcriptPath)) return null;
  const stop = Date.now() + deadlineMs;
  let files;
  try {
    if (!statSync(transcriptPath).isFile()) return null;
    files = transcriptFiles(transcriptPath);
    let bytes = 0;
    for (const file of files) bytes += statSync(file).size;
    if (bytes > maxBytes) return null;
  } catch {
    return null;
  }
  const seen = new Set();
  const models = new Map();
  let tokensIn = 0;
  let tokensOut = 0;
  let startedAt = null;
  for (const file of files) {
    const stream = createReadStream(file, { encoding: "utf8" });
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    try {
      for await (const line of lines) {
        if (Date.now() > stop) return null;
        if (file === transcriptPath && startedAt === null && line.includes('"timestamp"')) {
          try {
            const at = JSON.parse(line).timestamp;
            if (typeof at === "string" && !Number.isNaN(Date.parse(at))) startedAt = new Date(at).toISOString();
          } catch {
            // Keep looking.
          }
        }
        if (!line.includes('"usage"')) continue;
        let entry;
        try {
          entry = JSON.parse(line);
        } catch {
          continue; // a truncated last line
        }
        const message = entry?.type === "assistant" ? entry.message : null;
        const usage = message && typeof message === "object" ? message.usage : null;
        if (!usage || typeof usage !== "object") continue;
        const id = nonEmpty(message.id) || nonEmpty(entry.requestId);
        if (id) {
          if (seen.has(id)) continue;
          seen.add(id);
        }
        tokensIn += anthropicInput(usage);
        tokensOut += tokenCount(usage.output_tokens);
        const model = nonEmpty(message.model);
        if (model && model !== "<synthetic>") models.set(model, (models.get(model) ?? 0) + 1);
      }
    } catch {
      if (file === transcriptPath) return null; // an unreadable subagent file is skipped
    } finally {
      lines.close();
      stream.destroy();
    }
  }
  if (seen.size === 0 && tokensIn === 0 && tokensOut === 0) return null;
  const model = [...models.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return { tokensIn, tokensOut, model, messages: seen.size, startedAt };
}

/**
 * Token counts a hook payload carries (top level or under `usage`), else null.
 * Anthropic cache fields count as input. Cursor's input_tokens already includes
 * its cache tokens, so its cache_read_tokens / cache_write_tokens are not added.
 */
export function payloadTokens(payload) {
  for (const source of [payload, payload?.usage]) {
    if (!source || typeof source !== "object") continue;
    if (source.input_tokens === undefined && source.output_tokens === undefined) continue;
    return {
      tokensIn: anthropicInput(source),
      tokensOut: tokenCount(source.output_tokens),
      model: nonEmpty(payload?.model) || null,
    };
  }
  return null;
}

/** owner/name from https, ssh and scp-style remote URLs, else null. */
function slugFromRemote(url) {
  const match = /[/:]([^/:]+)\/([^/]+?)(?:\.git)?\/?$/.exec(nonEmpty(url));
  return match ? `${match[1]}/${match[2]}` : null;
}

function defaultBaseRef(cwd, timeoutMs) {
  const originHead = git(cwd, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], timeoutMs);
  if (originHead) return originHead;
  return git(cwd, ["rev-parse", "--verify", "--quiet", "origin/main"], timeoutMs) ? "origin/main" : null;
}

/** MC_CHECKOUT_ID, else the last MC-Checkout trailer of the newest session commit that has one. */
function sessionCheckoutId(cwd, env, startedAt, timeoutMs) {
  const fromEnv = nonEmpty(env.MC_CHECKOUT_ID);
  if (CHECKOUT_ID.test(fromEnv)) return fromEnv;
  const base = defaultBaseRef(cwd, timeoutMs);
  // No base and no session start: any trailer could be from another session.
  if (!base && !startedAt) return null;
  const args = ["log", `--max-count=${MAX_COMMITS}`, "--format=%(trailers:key=MC-Checkout,valueonly,separator=%x2C)"];
  if (startedAt) args.push(`--since=${startedAt}`);
  args.push("HEAD");
  if (base) args.push("--not", base);
  for (const line of git(cwd, args, timeoutMs).split("\n")) {
    const ids = line
      .split(",")
      .map((id) => id.trim())
      .filter((id) => CHECKOUT_ID.test(id));
    if (ids.length > 0) return ids.at(-1);
  }
  return null;
}

/**
 * Reports one telemetry row for this session to Mission Control. Never throws.
 * @param {{
 *   env?: Record<string, string | undefined>,
 *   fetch?: typeof globalThis.fetch,
 *   log?: (msg: string) => void,
 *   payload?: Record<string, unknown> | null,
 *   runtime?: string,
 *   cwd?: string,
 *   budgetMs?: number,
 * }} [opts]
 */
export async function reportTelemetry({
  env = process.env,
  fetch = globalThis.fetch,
  log = console.log,
  payload = null,
  runtime = "cursor",
  cwd = process.cwd(),
  budgetMs = DEFAULT_BUDGET_MS,
} = {}) {
  const deadline = Date.now() + budgetMs;
  const left = () => deadline - Date.now();
  const skip = (reason) => {
    log(`[session-telemetry] not reported: ${reason}`);
    return { reported: false, reason };
  };
  try {
    if ((env.SESSION_TELEMETRY_ENABLED ?? "1").trim() === "0") {
      return skip("disabled (SESSION_TELEMETRY_ENABLED=0)");
    }
    const sessionId = (nonEmpty(payload?.session_id) || nonEmpty(payload?.conversation_id)).slice(0, 120);
    if (!sessionId) return skip("the hook payload has no session id");
    const baseUrl = nonEmpty(env.MC_BASE_URL).replace(/\/$/, "");
    const apiKey = (env.MC_MCP_API_KEY || "").replace(/\$\{.*\}/, "").trim();
    const operatorEmail = nonEmpty(env.MC_OPERATOR_EMAIL || env.MC_ACCOUNTABLE).toLowerCase();
    if (!baseUrl || !apiKey || !operatorEmail) {
      return skip("MC_BASE_URL, MC_MCP_API_KEY or MC_OPERATOR_EMAIL is not set");
    }
    const usage =
      runtime === "claude-code"
        ? await sumTranscriptUsage(payload?.transcript_path, { deadlineMs: Math.min(SCAN_SHARE_MS, left()) })
        : payloadTokens(payload);
    if (!usage) {
      return skip(
        runtime === "claude-code" ? "no token usage in the transcript" : "the hook payload has no token counts"
      );
    }
    const envRepo = nonEmpty(env.MC_REPO);
    const repo = REPO_SLUG.test(envRepo)
      ? envRepo
      : slugFromRemote(git(cwd, ["remote", "get-url", "origin"], Math.min(GIT_TIMEOUT_MS, left())));
    if (!repo) return skip("no MC_REPO and no origin remote to name the repo");
    const checkoutId = sessionCheckoutId(cwd, env, usage.startedAt ?? null, Math.min(GIT_TIMEOUT_MS, left()));
    const body = {
      sessionId,
      tokensIn: usage.tokensIn,
      tokensOut: usage.tokensOut,
      ...(usage.model ? { model: usage.model.slice(0, 120) } : {}),
      ...(checkoutId ? { checkoutId } : {}),
    };
    const fetchMs = Math.min(FETCH_SHARE_MS, left());
    if (fetchMs < MIN_FETCH_MS) return skip("out of time");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), fetchMs);
    let recorded = false;
    try {
      const res = await fetch(`${baseUrl}${TELEMETRY_ROUTE}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "x-mc-operator-email": operatorEmail,
          "x-mc-runtime": RUNTIMES.has(runtime) ? runtime : "other",
          "x-mc-worker-id": `session-end-${process.pid}`,
          "x-mc-repo": repo,
        },
        body: JSON.stringify(body),
        // The key must never follow a redirect to another host.
        redirect: "error",
        signal: controller.signal,
      });
      if (!res.ok) return skip(`HTTP ${res.status}`);
      const answer = await res.json().catch(() => null);
      recorded = answer?.data?.recorded === true;
    } catch (err) {
      return skip(err?.name === "AbortError" ? "timed out" : "request failed");
    } finally {
      clearTimeout(timer);
    }
    if (!recorded) return skip("Mission Control did not confirm the row");
    log(`[session-telemetry] reported ${sessionId}: ${body.tokensIn} in, ${body.tokensOut} out`);
    return { reported: true, body };
  } catch {
    return skip("unexpected error");
  }
}
