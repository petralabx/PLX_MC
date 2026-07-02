// Company-brain session-artifact capture hook (session-knowledge-artifact
// policy). At session end, best-effort assembles a SessionArtifact v1 from
// git state and POSTs it to the VMC knowledge-ingestion endpoint so this
// session becomes part of the repo -> project -> department -> company
// knowledge ladder. Sibling of scripts/compliance-checkout.mjs (EN-007
// task-checkout capture), same opts/CLI-guard shape.
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
//   VMC_BASE_URL            VMC base URL (default: http://localhost:3100)
//   VMC_API_KEY             VMC API key (required to deliver; missing -> queue)
//
// Node stdlib only (global fetch + node:fs/node:path/node:crypto/node:child_process).

import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCHEMA_VERSION = 1;
const SESSION_ARTIFACT_ROUTE = "/api/vmc/knowledge/session-artifact";
const DEFAULT_VMC_BASE_URL = "http://localhost:3100";
const DEFAULT_DEADLINE_MS = 5000;
const GIT_TIMEOUT_MS = 1500;
const OFFLINE_QUEUE_DIR = "artifacts/session-brain";
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function isEnabled(env) {
  return (env.SESSION_BRAIN_ENABLED ?? "1").trim() !== "0";
}

function git(args) {
  try {
    return execFileSync("git", args, {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: GIT_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function branchName() {
  return git(["symbolic-ref", "--short", "HEAD"]) || git(["rev-parse", "--abbrev-ref", "HEAD"]) || "unknown";
}

function filesTouched(limit = 500) {
  const out = git(["status", "--porcelain"]);
  if (!out) return [];
  return out
    .split("\n")
    .map((line) => line.slice(3).split(" -> ").at(-1)?.trim())
    .filter(Boolean)
    .slice(0, limit);
}

function recentCommitsEvidence(count = 3) {
  const out = git(["log", `-${count}`, "--oneline"]);
  if (!out) return [];
  return out
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((ref) => ({ kind: "commit", ref }));
}

function buildArtifact() {
  const endedAt = new Date().toISOString();
  return {
    schema_version: SCHEMA_VERSION,
    runtime: "cursor",
    session_id: randomUUID(),
    started_at: endedAt,
    ended_at: endedAt,
    repo: "PLX_MC",
    branch: branchName(),
    project_slug: null,
    department: null,
    title: "Session capture (compliance-closeout)",
    summary:
      "Skeletal session artifact — the sessionEnd hook has no conversation transcript. See files_touched/evidence for what changed during this session.",
    decisions: [],
    lessons: [],
    files_touched: filesTouched(),
    evidence: recentCommitsEvidence(),
    tags: [],
  };
}

function writeOfflineQueue(artifact) {
  const day = new Date().toISOString().slice(0, 10);
  const queueDir = path.join(REPO_ROOT, OFFLINE_QUEUE_DIR, day);
  mkdirSync(queueDir, { recursive: true });
  const queuePath = path.join(queueDir, `${artifact.session_id}.json`);
  writeFileSync(queuePath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  return queuePath;
}

/**
 * @param {{
 *   env?: Record<string, string | undefined>,
 *   fetch?: typeof globalThis.fetch,
 *   log?: (msg: string) => void,
 * }} [opts]
 */
export async function closeout({ env = process.env, fetch = globalThis.fetch, log = console.log } = {}) {
  if (!isEnabled(env)) {
    log("[session-brain] disabled (SESSION_BRAIN_ENABLED=0)");
    return { delivered: false, queued: null, skipped: true };
  }

  const artifact = buildArtifact();
  const apiKey = (env.VMC_API_KEY || "").trim();
  const baseUrl = (env.VMC_BASE_URL || DEFAULT_VMC_BASE_URL).replace(/\/$/, "");

  if (!apiKey) {
    const queued = writeOfflineQueue(artifact);
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
          "x-agent-name": "cursor-session-hook",
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
    const queued = writeOfflineQueue(artifact);
    log(`[session-brain] delivery failed (${err.message}) — queued to ${queued}`);
    return { delivered: false, queued, skipped: false };
  }
}

// Run when invoked as the hook CLI, not when imported by a test.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  closeout().catch((e) => {
    // Fail-open: a session-end hook must never break the session.
    console.error(`[session-brain] unexpected error (fail-open, ignored): ${e.message}`);
    process.exit(0);
  });
}
