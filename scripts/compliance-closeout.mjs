// Company-brain session-artifact capture hook (session-knowledge-artifact
// policy). At session end, best-effort assembles a SessionArtifact v1 from
// the hook's stdin payload plus git state and POSTs it to the VMC
// knowledge-ingestion endpoint so this session becomes part of the repo ->
// project -> department -> company knowledge ladder. Sibling of
// scripts/compliance-checkout.mjs (EN-007 task-checkout capture), same
// opts/CLI-guard shape.
//
// Wired as the Cursor `sessionEnd` hook (.cursor/hooks.json) and the Claude
// Code `SessionEnd` hook (.claude/settings.json, `--runtime claude-code`).
//
// Stdin payload (optional JSON object):
//   Cursor       conversation_id (-> session_id), duration_ms (-> started_at)
//   Claude Code  session_id, transcript_path (first timestamp -> started_at)
// No payload id -> random UUID, tagged `session-id:generated`. No payload
// start -> the branch's first reflog entry or first session commit; if nothing
// can date the session, started_at = ended_at, tagged `started-at:unknown`.
// Session commits = HEAD minus origin's default branch (and since started_at
// when known); files_touched = their files plus uncommitted changes.
//
// Wire contract (owned by the agentic-swarm repo):
//   apps/vmc-web/src/lib/vmc/knowledge/session-artifact.ts (SessionArtifactV1Schema)
//   POST /api/vmc/knowledge/session-artifact
//
// FAIL-OPEN BY DESIGN: this hook must never block or fail a session. Any
// error (missing key, network down, bad response, timeout) falls back to
// writing the artifact to the local offline queue
// (artifacts/session-brain/<date>/<session_id>.json) and always exits 0.
//
// Kill switch: SESSION_BRAIN_ENABLED=0 disables capture and exits 0 immediately
// (default enabled — unlike compliance-checkout.mjs, this hook ships on by
// default per the session-knowledge-artifact governance policy).
//
// Env:
//   SESSION_BRAIN_ENABLED   set to "0" to disable capture (default: enabled)
//   VMC_BASE_URL            VMC base URL (default: https://missioncontrol.tayloralton.com)
//   VMC_API_KEY             VMC API key (required to deliver; missing -> queue)
//
// Node stdlib only (global fetch + node:fs/node:path/node:crypto/node:child_process).

import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { closeSync, mkdirSync, openSync, readSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCHEMA_VERSION = 1;
const SESSION_ARTIFACT_ROUTE = "/api/vmc/knowledge/session-artifact";
// Same production default as vmcBaseUrl() in src/lib/secrets.ts.
const DEFAULT_VMC_BASE_URL = "https://missioncontrol.tayloralton.com";
const DEFAULT_DEADLINE_MS = 5000;
const GIT_TIMEOUT_MS = 1500;
const STDIN_TIMEOUT_MS = 1000;
const TRANSCRIPT_HEAD_BYTES = 64 * 1024;
const MAX_COMMITS = 50;
const OFFLINE_QUEUE_DIR = "artifacts/session-brain";
const RUNTIMES = new Set(["cursor", "claude-code", "hermes", "swarm", "other"]);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function isEnabled(env) {
  return (env.SESSION_BRAIN_ENABLED ?? "1").trim() !== "0";
}

function git(cwd, args) {
  try {
    // trimEnd, not trim: porcelain status lines start with a significant space.
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      timeout: GIT_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "ignore"],
    }).trimEnd();
  } catch {
    return "";
  }
}

function isoOrNull(value) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function nonEmpty(value) {
  return typeof value === "string" ? value.trim() : "";
}

/** Hook stdin JSON (Cursor sessionEnd / Claude Code SessionEnd) -> object, else null. */
export function parseHookPayload(raw) {
  if (!raw || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** https / ssh / scp-style remote URL -> { slug: "owner/name", name }, else null. */
export function repoFromRemoteUrl(url) {
  const match = /[/:]([^/:]+)\/([^/]+?)(?:\.git)?\/?$/.exec(nonEmpty(url));
  return match ? { slug: `${match[1]}/${match[2]}`, name: match[2] } : null;
}

/** First `timestamp` in the head of a JSONL transcript (Claude Code), else null. */
function transcriptStartedAt(transcriptPath) {
  if (!nonEmpty(transcriptPath)) return null;
  let head = "";
  try {
    const fd = openSync(transcriptPath, "r");
    try {
      const buf = Buffer.alloc(TRANSCRIPT_HEAD_BYTES);
      head = buf.toString("utf8", 0, readSync(fd, buf, 0, buf.length, 0));
    } finally {
      closeSync(fd);
    }
  } catch {
    return null;
  }
  for (const line of head.split("\n")) {
    try {
      const at = isoOrNull(JSON.parse(line).timestamp);
      if (at) return at;
    } catch {
      // Truncated or non-JSON line — keep scanning.
    }
  }
  return null;
}

function payloadStartedAt(payload, endedAtMs) {
  const durationMs = Number(payload?.duration_ms);
  if (Number.isFinite(durationMs) && durationMs > 0) {
    return { at: new Date(endedAtMs - durationMs).toISOString(), source: "hook duration_ms" };
  }
  const fromTranscript = transcriptStartedAt(payload?.transcript_path);
  return fromTranscript ? { at: fromTranscript, source: "hook transcript" } : null;
}

function branchName(cwd) {
  return git(cwd, ["symbolic-ref", "--short", "HEAD"]) || git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]) || "unknown";
}

function defaultBaseRef(cwd) {
  const originHead = git(cwd, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  if (originHead) return originHead;
  return git(cwd, ["rev-parse", "--verify", "--quiet", "origin/main"]) ? "origin/main" : null;
}

function branchCreatedAt(cwd, branch) {
  const reflog = git(cwd, ["reflog", "show", "--date=unix", "--format=%gd", `refs/heads/${branch}`]);
  const match = /@\{(\d+)\}$/.exec(reflog.split("\n").at(-1) ?? "");
  return match ? new Date(Number(match[1]) * 1000).toISOString() : null;
}

/** Commits on HEAD not on the base branch (and since `since`), newest first. */
function sessionCommits(cwd, base, since) {
  // No window at all -> do not dump the whole history into the artifact.
  if (!base && !since) return [];
  const args = ["log", `--max-count=${MAX_COMMITS}`, "--no-renames", "--numstat", "--format=%x1e%h%x1f%cI%x1f%s"];
  if (since) args.push(`--since=${since}`);
  args.push("HEAD");
  if (base) args.push("--not", base);
  return git(cwd, args)
    .split("\x1e")
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const [header, ...stat] = chunk.split("\n");
      const [sha, committedAt, subject = ""] = header.split("\x1f");
      const commit = { sha, committedAt, subject, files: [], insertions: 0, deletions: 0 };
      for (const line of stat) {
        const [added, deleted, file] = line.split("\t");
        if (!file) continue;
        commit.insertions += Number(added) || 0;
        commit.deletions += Number(deleted) || 0;
        commit.files.push(file);
      }
      return commit;
    });
}

function uncommittedFiles(cwd) {
  const out = git(cwd, ["status", "--porcelain"]);
  if (!out) return [];
  return out
    .split("\n")
    .map((line) => line.slice(3).split(" -> ").at(-1)?.trim())
    .filter(Boolean);
}

function buildSummary({ branch, commits, uncommitted, runtime, idSource, startSource }) {
  const lines = [];
  if (commits.length === 0) {
    lines.push(`No commits on ${branch} in this session window.`);
  } else {
    lines.push(`${commits.length} commit(s) on ${branch}:`);
    for (const commit of commits) lines.push(`- ${commit.sha} ${commit.subject}`);
    const files = new Set(commits.flatMap((commit) => commit.files));
    const insertions = commits.reduce((sum, commit) => sum + commit.insertions, 0);
    const deletions = commits.reduce((sum, commit) => sum + commit.deletions, 0);
    lines.push(`Diff: ${files.size} file(s) changed, +${insertions}/-${deletions} lines.`);
  }
  if (uncommitted.length > 0) {
    lines.push(`Uncommitted at session end: ${uncommitted.length} file(s).`);
  }
  lines.push(`Capture: ${runtime} session-end hook; session_id ${idSource}; started_at from ${startSource}.`);
  return lines.join("\n");
}

function buildArtifact({ payload, runtime, cwd, now }) {
  const endedAt = now.toISOString();
  const hookId = nonEmpty(payload?.conversation_id) || nonEmpty(payload?.session_id);
  const branch = branchName(cwd);
  const base = defaultBaseRef(cwd);
  const fromPayload = payloadStartedAt(payload, now.getTime());
  const commits = sessionCommits(cwd, base, fromPayload?.at ?? null);
  let start = fromPayload;
  if (!start) {
    // The default branch's reflog starts at clone time — not a session start.
    const onBase = base !== null && branch === base.replace(/^origin\//, "");
    const gitAt = [onBase ? null : branchCreatedAt(cwd, branch), isoOrNull(commits.at(-1)?.committedAt)]
      .filter(Boolean)
      .sort()[0];
    start = gitAt ? { at: gitAt, source: "git (branch reflog / first session commit)" } : null;
  }
  const uncommitted = uncommittedFiles(cwd);
  const tags = [];
  if (!hookId) tags.push("session-id:generated");
  if (!start) tags.push("started-at:unknown");
  return {
    schema_version: SCHEMA_VERSION,
    runtime,
    session_id: hookId || randomUUID(),
    started_at: start?.at ?? endedAt,
    ended_at: endedAt,
    repo: repoFromRemoteUrl(git(cwd, ["remote", "get-url", "origin"]))?.name ?? "unknown",
    branch,
    project_slug: null,
    department: null,
    title:
      commits.length === 0
        ? `Session on ${branch} (no commits)`
        : `${commits[0].subject}${commits.length > 1 ? ` (+${commits.length - 1} more)` : ""}`,
    summary: buildSummary({
      branch,
      commits,
      uncommitted,
      runtime,
      idSource: hookId ? "from hook payload" : "generated (hook payload had none)",
      startSource: start?.source ?? "nothing (unknown; set to ended_at)",
    }),
    decisions: [],
    lessons: [],
    files_touched: [...new Set([...commits.flatMap((commit) => commit.files), ...uncommitted])].slice(0, 500),
    evidence: commits.map((commit) => ({ kind: "commit", ref: `${commit.sha} ${commit.subject}` })),
    tags,
  };
}

function writeOfflineQueue(artifact, root) {
  const queueDir = path.join(root, OFFLINE_QUEUE_DIR, artifact.ended_at.slice(0, 10));
  mkdirSync(queueDir, { recursive: true });
  // The id comes from hook stdin — never let it pick the path.
  const queuePath = path.join(queueDir, `${artifact.session_id.replace(/[^A-Za-z0-9._-]/g, "_")}.json`);
  writeFileSync(queuePath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  return queuePath;
}

/**
 * @param {{
 *   env?: Record<string, string | undefined>,
 *   fetch?: typeof globalThis.fetch,
 *   log?: (msg: string) => void,
 *   payload?: Record<string, unknown> | null,
 *   runtime?: string,
 *   cwd?: string,
 *   now?: Date,
 * }} [opts]
 */
export async function closeout({
  env = process.env,
  fetch = globalThis.fetch,
  log = console.log,
  payload = null,
  runtime = "cursor",
  cwd = REPO_ROOT,
  now = new Date(),
} = {}) {
  if (!isEnabled(env)) {
    log("[session-brain] disabled (SESSION_BRAIN_ENABLED=0)");
    return { delivered: false, queued: null, skipped: true };
  }

  const artifact = buildArtifact({ payload, runtime: RUNTIMES.has(runtime) ? runtime : "other", cwd, now });
  const apiKey = (env.VMC_API_KEY || "").trim();
  const baseUrl = (env.VMC_BASE_URL || DEFAULT_VMC_BASE_URL).replace(/\/$/, "");

  if (!apiKey) {
    const queued = writeOfflineQueue(artifact, cwd);
    log(`[session-brain] VMC_API_KEY not set — queued to ${queued}`);
    return { delivered: false, queued, skipped: false };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_DEADLINE_MS);
    let res;
    try {
      res = await fetch(`${baseUrl}${SESSION_ARTIFACT_ROUTE}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "x-agent-name": `${artifact.runtime}-session-hook`,
        },
        body: JSON.stringify(artifact),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    log(`[session-brain] delivered session artifact ${artifact.session_id}`);
    return { delivered: true, queued: null, skipped: false };
  } catch (err) {
    const queued = writeOfflineQueue(artifact, cwd);
    log(`[session-brain] delivery failed (${err.message}) — queued to ${queued}`);
    return { delivered: false, queued, skipped: false };
  }
}

function readStdin(timeoutMs = STDIN_TIMEOUT_MS) {
  if (process.stdin.isTTY) return Promise.resolve("");
  return new Promise((resolve) => {
    let data = "";
    const finish = () => {
      clearTimeout(timer);
      process.stdin.destroy();
      resolve(data);
    };
    // A hook runner that never closes stdin must not hold the session open.
    const timer = setTimeout(finish, timeoutMs);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", finish);
    process.stdin.on("error", finish);
  });
}

// Run when invoked as the hook CLI, not when imported by a test.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const runtimeFlag = process.argv.indexOf("--runtime");
  readStdin()
    .then((raw) =>
      closeout({
        payload: parseHookPayload(raw),
        runtime: runtimeFlag >= 0 ? process.argv[runtimeFlag + 1] : "cursor",
      })
    )
    .catch((e) => {
      // Fail-open: a session-end hook must never break the session.
      console.error(`[session-brain] unexpected error (fail-open, ignored): ${e.message}`);
      process.exit(0);
    });
}
