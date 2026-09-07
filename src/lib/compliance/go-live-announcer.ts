// One-way BC go-live Teams announcer (TASK-1454). Posts a single plain-text
// line on checkout / PR-open / complete via the Teams Workflow webhook.
// Fail-closed for sends. Never throws into checkout/complete/ingest.
// Never logs webhook URLs, secrets, or inbound message bodies.

import { query } from "@/lib/db";
import { getEntity } from "@/lib/sync/repo";

export const GO_LIVE_TEAM_ID = "73b1b6fb-ea03-493c-b1a0-3af4883a2953";
export const GO_LIVE_CHANNEL_ID = "19:046f10be721e4782906a2309e8a7492d@thread.tacv2";
export const GO_LIVE_GITHUB_ORG = "petralabx";

const TASK_ID_RE = /^TASK-\d{1,6}$/;
const ACTOR_RE = /^[A-Za-z0-9._@-]{1,64}$/;
const REPO_SLUG_RE = /^[A-Za-z0-9._-]+$/;
const ANNOUNCE_KINDS = new Set(["checkout", "pr.opened", "task.completed"]);

const MAX_TITLE = 80;
const MAX_URL = 200;
const MAX_LINE = 240;
const TRANSIENT_TRIES = 3;

export type GoLiveKind = "checkout" | "pr.opened" | "task.completed";

export interface GoLiveEventInput {
  kind: string;
  actor: string;
  repo?: string | null;
  taskId?: string | null;
  pr?: string | null;
  payload?: Record<string, unknown> | null;
}

export interface GoLiveConfig {
  enabled: boolean;
  checkoutEnabled: boolean;
  prOpenEnabled: boolean;
  completeEnabled: boolean;
  dryRun: boolean;
  webhookUrl: string;
  teamId: string;
  channelId: string;
}

export interface GoLiveSendResult {
  sent: boolean;
  skipped: string | null;
  eventId: string | null;
  line: string | null;
  receiptId: string | null;
}

export interface GoLiveDeps {
  loadConfig?: () => GoLiveConfig;
  loadTitle?: (taskId: string) => Promise<string | null>;
  alreadySent?: (eventId: string) => Promise<boolean>;
  markSent?: (eventId: string, receiptId: string) => Promise<void>;
  postWebhook?: (url: string, line: string) => Promise<GoLivePostReceipt>;
  sleep?: (ms: number) => Promise<void>;
}

export interface GoLivePostReceipt {
  ok: boolean;
  status: number;
  receiptId: string;
  retryable: boolean;
  permanentAuth: boolean;
}

export function loadGoLiveConfig(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): GoLiveConfig {
  const teamId = (env.MC_GO_LIVE_TEAM_ID ?? GO_LIVE_TEAM_ID).trim();
  const channelId = (env.MC_GO_LIVE_CHANNEL_ID ?? GO_LIVE_CHANNEL_ID).trim();
  return {
    enabled: envFlagFrom(env, "MC_GO_LIVE_ANNOUNCER_ENABLED", false),
    checkoutEnabled: envFlagFrom(env, "MC_GO_LIVE_ANNOUNCE_CHECKOUT", false),
    prOpenEnabled: envFlagFrom(env, "MC_GO_LIVE_ANNOUNCE_PR_OPEN", false),
    completeEnabled: envFlagFrom(env, "MC_GO_LIVE_ANNOUNCE_COMPLETE", false),
    dryRun: envFlagFrom(env, "MC_GO_LIVE_ANNOUNCER_DRY_RUN", false),
    webhookUrl: (env.MC_GO_LIVE_TEAMS_WORKFLOW_URL ?? "").trim(),
    teamId,
    channelId,
  };
}

function envFlagFrom(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  name: string,
  defaultOn: boolean
): boolean {
  const raw = (env[name] ?? "").trim().toLowerCase();
  if (!raw) return defaultOn;
  return raw === "1" || raw === "true" || raw === "yes";
}

export function configBlocksSend(cfg: GoLiveConfig): string | null {
  if (!cfg.enabled) return "global_disabled";
  if (cfg.dryRun) return "dry_run";
  if (cfg.teamId !== GO_LIVE_TEAM_ID) return "team_not_allowlisted";
  if (cfg.channelId !== GO_LIVE_CHANNEL_ID) return "channel_not_allowlisted";
  if (!cfg.webhookUrl) return "missing_webhook";
  if (!isHttpsWebhookUrl(cfg.webhookUrl)) return "malformed_webhook";
  return null;
}

export function isHttpsWebhookUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function sanitizeActor(raw: string): string | null {
  const actor = raw.trim();
  if (!ACTOR_RE.test(actor)) return null;
  return actor;
}

export function sanitizeTaskId(raw: string | null | undefined): string | null {
  const id = (raw ?? "").trim();
  if (!TASK_ID_RE.test(id)) return null;
  return id;
}

export function sanitizeTitle(raw: string | null | undefined): string {
  const stripped = String(raw ?? "")
    .replace(/[`*_#<>[\]()]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!stripped) return "untitled";
  return stripped.length > MAX_TITLE ? `${stripped.slice(0, MAX_TITLE - 1)}…` : stripped;
}

export function sanitizeGithubPrUrl(repo: string | null | undefined, pr: string | null | undefined): string | null {
  const repoId = (repo ?? "").trim();
  const prNum = (pr ?? "").trim();
  if (!/^\d{1,8}$/.test(prNum)) return null;
  const parts = repoId.split("/");
  if (parts.length !== 2) return null;
  const [org, slug] = parts;
  if (org !== GO_LIVE_GITHUB_ORG || !REPO_SLUG_RE.test(slug)) return null;
  const url = `https://github.com/${org}/${slug}/pull/${prNum}`;
  if (url.length > MAX_URL) return null;
  return url;
}

export function eventIdFor(e: GoLiveEventInput): string | null {
  const taskId = sanitizeTaskId(e.taskId);
  const payload = e.payload ?? {};
  if (e.kind === "checkout") {
    const checkoutId = typeof payload.checkoutId === "string" ? payload.checkoutId.trim() : "";
    if (!taskId || !checkoutId || !/^dsp_[a-z0-9]+$/.test(checkoutId)) return null;
    return `checkout:${checkoutId}`;
  }
  if (e.kind === "pr.opened") {
    if (!taskId) return null;
    const url = sanitizeGithubPrUrl(e.repo, e.pr);
    if (!url) return null;
    return `pr.opened:${e.repo}:${e.pr}`;
  }
  if (e.kind === "task.completed") {
    const checkoutId = typeof payload.checkoutId === "string" ? payload.checkoutId.trim() : "";
    if (!taskId || !checkoutId || !/^dsp_[a-z0-9]+$/.test(checkoutId)) return null;
    return `task.completed:${checkoutId}`;
  }
  return null;
}

export function formatGoLiveLine(
  kind: GoLiveKind,
  input: { actor: string; taskId: string; title?: string; url?: string }
): string | null {
  const actor = sanitizeActor(input.actor);
  const taskId = sanitizeTaskId(input.taskId);
  if (!actor || !taskId) return null;
  let line: string;
  if (kind === "checkout") {
    line = `${actor} claimed ${taskId} (${sanitizeTitle(input.title)})`;
  } else if (kind === "pr.opened") {
    if (!input.url) return null;
    line = `PR opened for ${taskId}: ${input.url}`;
  } else {
    line = `${taskId} complete`;
  }
  if (line.length > MAX_LINE) return null;
  return line;
}

export function switchBlocksKind(cfg: GoLiveConfig, kind: GoLiveKind): string | null {
  if (kind === "checkout" && !cfg.checkoutEnabled) return "checkout_disabled";
  if (kind === "pr.opened" && !cfg.prOpenEnabled) return "pr_open_disabled";
  if (kind === "task.completed" && !cfg.completeEnabled) return "complete_disabled";
  return null;
}

function announceDedupKey(eventId: string): string {
  return `announce:${eventId}`;
}

async function defaultLoadTitle(taskId: string): Promise<string | null> {
  try {
    const row = await getEntity("task", taskId);
    const title = row?.data && typeof row.data.title === "string" ? row.data.title : null;
    return title;
  } catch {
    return null;
  }
}

async function defaultAlreadySent(eventId: string): Promise<boolean> {
  const rows = await query<{ n: string }>(
    `SELECT 1 AS n FROM mc_events WHERE dedup_key = $1 LIMIT 1`,
    [announceDedupKey(eventId)]
  );
  return rows.length > 0;
}

async function defaultMarkSent(eventId: string, receiptId: string): Promise<void> {
  await query(
    `INSERT INTO mc_events (kind, actor, repo, task_id, pr, payload, dedup_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING`,
    [
      "announce.sent",
      "mc-go-live",
      null,
      null,
      null,
      JSON.stringify({ eventId, receiptId }),
      announceDedupKey(eventId),
    ]
  );
}

export function classifyWebhookStatus(status: number): { retryable: boolean; permanentAuth: boolean } {
  if (status === 401 || status === 403) return { retryable: false, permanentAuth: true };
  if (status === 408 || status === 429 || status >= 500) return { retryable: true, permanentAuth: false };
  if (status >= 200 && status < 300) return { retryable: false, permanentAuth: false };
  return { retryable: false, permanentAuth: false };
}

export async function postTeamsWorkflow(
  url: string,
  line: string,
  fetchImpl: typeof fetch = fetch
): Promise<GoLivePostReceipt> {
  const resp = await fetchImpl(url, {
    method: "POST",
    signal: AbortSignal.timeout(10_000),
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: line }),
  });
  const tracking =
    resp.headers.get("x-ms-workflow-run-id") ||
    resp.headers.get("x-ms-client-tracking-id") ||
    resp.headers.get("x-ms-correlation-id") ||
    "";
  let bodyId = "";
  const raw = await resp.text();
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { id?: unknown; name?: unknown };
      if (typeof parsed.id === "string") bodyId = parsed.id;
      else if (typeof parsed.name === "string") bodyId = parsed.name;
    } catch {
      bodyId = "";
    }
  }
  const { retryable, permanentAuth } = classifyWebhookStatus(resp.status);
  const receiptId = tracking || bodyId || `http-${resp.status}`;
  return {
    ok: resp.ok,
    status: resp.status,
    receiptId,
    retryable,
    permanentAuth,
  };
}

async function postWithRetry(
  url: string,
  line: string,
  postWebhook: (url: string, line: string) => Promise<GoLivePostReceipt>,
  sleep: (ms: number) => Promise<void>
): Promise<GoLivePostReceipt> {
  let last: GoLivePostReceipt | null = null;
  for (let attempt = 1; attempt <= TRANSIENT_TRIES; attempt += 1) {
    last = await postWebhook(url, line);
    if (last.ok || last.permanentAuth || !last.retryable) return last;
    if (attempt < TRANSIENT_TRIES) await sleep(100 * attempt);
  }
  return last as GoLivePostReceipt;
}

export async function announceGoLiveEvent(
  event: GoLiveEventInput,
  deps: GoLiveDeps = {}
): Promise<GoLiveSendResult> {
  const empty: GoLiveSendResult = { sent: false, skipped: "unhandled", eventId: null, line: null, receiptId: null };
  if (!ANNOUNCE_KINDS.has(event.kind)) {
    return { ...empty, skipped: "unexpected_kind" };
  }
  const kind = event.kind as GoLiveKind;
  const cfg = (deps.loadConfig ?? loadGoLiveConfig)();
  const blocked = configBlocksSend(cfg);
  if (blocked) return { ...empty, skipped: blocked };
  const kindBlocked = switchBlocksKind(cfg, kind);
  if (kindBlocked) return { ...empty, skipped: kindBlocked };

  const eventId = eventIdFor(event);
  if (!eventId) return { ...empty, skipped: "invalid_event" };
  const actor = sanitizeActor(event.actor);
  const taskId = sanitizeTaskId(event.taskId);
  if (!actor || !taskId) return { ...empty, skipped: "invalid_event", eventId };

  let title: string | undefined;
  let url: string | undefined;
  if (kind === "checkout") {
    title = sanitizeTitle(await (deps.loadTitle ?? defaultLoadTitle)(taskId));
  }
  if (kind === "pr.opened") {
    const built = sanitizeGithubPrUrl(event.repo, event.pr);
    if (!built) return { ...empty, skipped: "unapproved_url", eventId };
    url = built;
  }

  const line = formatGoLiveLine(kind, { actor, taskId, title, url });
  if (!line) return { ...empty, skipped: "invalid_event", eventId };

  if (await (deps.alreadySent ?? defaultAlreadySent)(eventId)) {
    return { sent: false, skipped: "duplicate", eventId, line, receiptId: null };
  }

  const receipt = await postWithRetry(
    cfg.webhookUrl,
    line,
    deps.postWebhook ?? ((webhookUrl, text) => postTeamsWorkflow(webhookUrl, text)),
    deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  );
  if (!receipt.ok) {
    console.error(
      "[go-live-announcer] send failed eventId=%s status=%s auth=%s retryable=%s",
      eventId,
      receipt.status,
      receipt.permanentAuth,
      receipt.retryable
    );
    return { sent: false, skipped: receipt.permanentAuth ? "auth_failed" : "send_failed", eventId, line, receiptId: receipt.receiptId };
  }
  await (deps.markSent ?? defaultMarkSent)(eventId, receipt.receiptId);
  return { sent: true, skipped: null, eventId, line, receiptId: receipt.receiptId };
}

export async function announceGoLiveEventSafe(event: GoLiveEventInput): Promise<void> {
  try {
    await announceGoLiveEvent(event);
  } catch (err) {
    console.error(
      "[go-live-announcer] failed-closed send: %s",
      err instanceof Error ? err.message : "error"
    );
  }
}
