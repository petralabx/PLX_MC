// One-way BC go-live Teams announcer (TASK-1454 / TASK-1699 / TASK-1701). Posts a single
// markdown line on checkout / PR-open / complete via the Teams Workflow webhook.
// Chat Workflow is the intended live path; channel URL is optional fallback.
// Never fans out to both. Fail-closed for sends. Never throws into
// checkout/complete/ingest. Never logs webhook URLs, secrets, or inbound bodies.

import { query } from "@/lib/db";
import { getEntity } from "@/lib/sync/repo";
import { putGoLiveDeliveryBlobIfNotExists } from "./go-live-delivery-blob";

export const GO_LIVE_TEAM_ID = "73b1b6fb-ea03-493c-b1a0-3af4883a2953";
export const GO_LIVE_CHANNEL_ID = "19:046f10be721e4782906a2309e8a7492d@thread.tacv2";
export const GO_LIVE_GITHUB_ORG = "petralabx";
export const COALESCE_WINDOW_MS = 15 * 60 * 1000;

/** Bare slugs as stored on pr.opened mc_events (webhook writes repository.name). */
export const GO_LIVE_BARE_REPO_SLUGS = new Set(["plx-customer-portal", "agentic-swarm", "PLX_MC"]);

const TASK_ID_RE = /^TASK-\d{1,6}$/;
const ACTOR_RE = /^[A-Za-z0-9._@-]{1,64}$/;
const REPO_SLUG_RE = /^[A-Za-z0-9._-]+$/;
const ANNOUNCE_KINDS = new Set(["checkout", "pr.opened", "task.completed"]);

const MAX_TITLE = 80;
const MAX_URL = 200;
const MAX_LINE = 400;
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
  chatWebhookUrl: string;
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

export interface GoLiveClaimMeta {
  taskId: string;
  kind: GoLiveKind;
}

export interface GoLiveDeps {
  loadConfig?: () => GoLiveConfig;
  loadTitle?: (taskId: string) => Promise<string | null>;
  alreadySent?: (eventId: string) => Promise<boolean>;
  claimSent?: (eventId: string, meta: GoLiveClaimMeta) => Promise<boolean>;
  siblingSent?: (taskId: string, kind: GoLiveKind, withinMs: number) => Promise<boolean>;
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
    chatWebhookUrl: (env.MC_GO_LIVE_TEAMS_CHAT_WORKFLOW_URL ?? "").trim(),
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

export function primaryDeliveryUrl(cfg: GoLiveConfig): string | null {
  const chat = cfg.chatWebhookUrl.trim();
  if (chat && isHttpsWebhookUrl(chat)) return chat;
  const channel = cfg.webhookUrl.trim();
  if (channel && isHttpsWebhookUrl(channel)) return channel;
  return null;
}

export function configBlocksSend(cfg: GoLiveConfig): string | null {
  if (!cfg.enabled) return "global_disabled";
  if (cfg.dryRun) return "dry_run";
  if (cfg.teamId !== GO_LIVE_TEAM_ID) return "team_not_allowlisted";
  if (cfg.channelId !== GO_LIVE_CHANNEL_ID) return "channel_not_allowlisted";
  if (!primaryDeliveryUrl(cfg)) return "missing_delivery";
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

export function hubBaseUrl(): string {
  return (process.env.PLX_MC_PUBLIC_URL ?? "https://mc.plxcustomer.io").replace(/\/+$/, "");
}

export function hubTaskMarkdown(taskId: string, title?: string | null): string | null {
  const id = sanitizeTaskId(taskId);
  if (!id) return null;
  const url = `${hubBaseUrl()}/tasks/${encodeURIComponent(id)}`;
  if (url.length > MAX_URL) return null;
  return `[${id} — ${sanitizeTitle(title)}](${url})`;
}

export function prMarkdown(url: string): string | null {
  const match = url.trim().match(/^https:\/\/github\.com\/petralabx\/[A-Za-z0-9._-]+\/pull\/(\d{1,8})$/);
  if (!match) return null;
  return `[PR #${match[1]}](${url})`;
}

export function normalizeGithubRepo(repo: string | null | undefined): string | null {
  const raw = (repo ?? "").trim();
  if (!raw) return null;
  if (!raw.includes("/")) {
    if (!GO_LIVE_BARE_REPO_SLUGS.has(raw) || !REPO_SLUG_RE.test(raw)) return null;
    return `${GO_LIVE_GITHUB_ORG}/${raw}`;
  }
  const parts = raw.split("/");
  if (parts.length !== 2) return null;
  const [org, slug] = parts;
  if (org !== GO_LIVE_GITHUB_ORG || !REPO_SLUG_RE.test(slug)) return null;
  return `${org}/${slug}`;
}

export function sanitizeGithubPrUrl(repo: string | null | undefined, pr: string | null | undefined): string | null {
  const prNum = (pr ?? "").trim();
  if (!/^\d{1,8}$/.test(prNum)) return null;
  const normalized = normalizeGithubRepo(repo);
  if (!normalized) return null;
  const url = `https://github.com/${normalized}/pull/${prNum}`;
  if (url.length > MAX_URL) return null;
  return url;
}

export function prUrlFromEvent(event: GoLiveEventInput): string | null {
  if (event.kind === "pr.opened") return sanitizeGithubPrUrl(event.repo, event.pr);
  const payload = event.payload ?? {};
  if (typeof payload.prUrl === "string") {
    const match = payload.prUrl
      .trim()
      .match(/^https:\/\/github\.com\/(petralabx\/[A-Za-z0-9._-]+)\/pull\/(\d{1,8})\/?$/);
    if (match) return sanitizeGithubPrUrl(match[1], match[2]);
  }
  if (event.pr) return sanitizeGithubPrUrl(event.repo, event.pr);
  return null;
}

function checkoutIdFrom(event: GoLiveEventInput): string | null {
  const checkoutId = typeof event.payload?.checkoutId === "string" ? event.payload.checkoutId.trim() : "";
  if (!checkoutId || !/^dsp_[a-z0-9]+$/.test(checkoutId)) return null;
  return checkoutId;
}

export function eventIdFor(e: GoLiveEventInput): string | null {
  const taskId = sanitizeTaskId(e.taskId);
  if (!taskId) return null;
  if (e.kind === "checkout") {
    if (!checkoutIdFrom(e)) return null;
    return `checkout:${taskId}`;
  }
  if (e.kind === "pr.opened") {
    if (!sanitizeGithubPrUrl(e.repo, e.pr)) return null;
    return `pr.opened:${taskId}`;
  }
  if (e.kind === "task.completed") {
    if (!checkoutIdFrom(e)) return null;
    return `task.completed:${taskId}`;
  }
  return null;
}

export function coalesceSiblingKind(kind: GoLiveKind): GoLiveKind | null {
  if (kind === "pr.opened") return "task.completed";
  if (kind === "task.completed") return "pr.opened";
  return null;
}

export function formatGoLiveLine(
  kind: GoLiveKind,
  input: { actor: string; taskId: string; title?: string; url?: string }
): string | null {
  const actor = sanitizeActor(input.actor);
  const taskLink = hubTaskMarkdown(input.taskId, input.title);
  if (!actor || !taskLink) return null;
  let line: string;
  if (kind === "checkout") {
    line = `${actor} claimed ${taskLink}`;
  } else if (kind === "pr.opened") {
    if (!input.url) return null;
    const prLink = prMarkdown(input.url);
    if (!prLink) return null;
    line = `PR opened for ${taskLink} — ${prLink}`;
  } else if (input.url) {
    const prLink = prMarkdown(input.url);
    if (!prLink) return null;
    line = `${taskLink} complete — ${prLink}`;
  } else {
    line = `${taskLink} complete`;
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

async function defaultSiblingSent(taskId: string, kind: GoLiveKind, withinMs: number): Promise<boolean> {
  const siblingId = `${kind}:${taskId}`;
  const rows = await query<{ n: string }>(
    `SELECT 1 AS n FROM mc_events
      WHERE dedup_key = $1
        AND payload->>'status' = 'sent'
        AND ts > now() - ($2::text || ' milliseconds')::interval
      LIMIT 1`,
    [announceDedupKey(siblingId), String(Math.max(0, Math.floor(withinMs)))]
  );
  return rows.length > 0;
}

async function defaultClaimSent(eventId: string, meta: GoLiveClaimMeta): Promise<boolean> {
  // Postgres is the always-on claim. Blob is an overlay written after a won
  // insert so an orphan blob cannot block a later retry that never got an
  // mc_events row.
  const rows = await query<{ seq: string }>(
    `INSERT INTO mc_events (kind, actor, repo, task_id, pr, payload, dedup_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING
     RETURNING seq`,
    [
      "announce.sent",
      "mc-go-live",
      null,
      meta.taskId,
      null,
      JSON.stringify({ eventId, status: "claimed", kind: meta.kind }),
      announceDedupKey(eventId),
    ]
  );
  if (rows.length === 0) return false;
  await putGoLiveDeliveryBlobIfNotExists({
    eventId,
    taskId: meta.taskId,
    kind: meta.kind,
  });
  return true;
}

async function defaultMarkSent(eventId: string, receiptId: string): Promise<void> {
  const status = receiptId === "coalesced" ? "coalesced" : "sent";
  await query(
    `UPDATE mc_events
        SET payload = coalesce(payload, '{}'::jsonb) || $2::jsonb
      WHERE dedup_key = $1`,
    [announceDedupKey(eventId), JSON.stringify({ eventId, receiptId, status })]
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

async function postDestination(
  url: string,
  line: string,
  postWebhook: (url: string, line: string) => Promise<GoLivePostReceipt>,
  sleep: (ms: number) => Promise<void>
): Promise<GoLivePostReceipt> {
  try {
    return await postWithRetry(url, line, postWebhook, sleep);
  } catch (err) {
    console.error(
      "[go-live-announcer] dest failed: %s",
      err instanceof Error ? err.message : "error"
    );
    return {
      ok: false,
      status: 0,
      receiptId: "throw",
      retryable: false,
      permanentAuth: false,
    };
  }
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

  const title = sanitizeTitle(await (deps.loadTitle ?? defaultLoadTitle)(taskId));
  const url = prUrlFromEvent(event) ?? undefined;
  if (kind === "pr.opened" && !url) return { ...empty, skipped: "unapproved_url", eventId };

  const line = formatGoLiveLine(kind, { actor, taskId, title, url });
  if (!line) return { ...empty, skipped: "invalid_event", eventId };

  const alreadySent = deps.alreadySent ?? defaultAlreadySent;
  const claimSent = deps.claimSent ?? defaultClaimSent;
  const siblingSent = deps.siblingSent ?? defaultSiblingSent;
  const markSent = deps.markSent ?? defaultMarkSent;

  if (await alreadySent(eventId)) {
    return { sent: false, skipped: "duplicate", eventId, line, receiptId: null };
  }

  const sibling = coalesceSiblingKind(kind);
  if (sibling && (await siblingSent(taskId, sibling, COALESCE_WINDOW_MS))) {
    const claimed = await claimSent(eventId, { taskId, kind });
    if (claimed) await markSent(eventId, "coalesced");
    return { sent: false, skipped: "coalesced", eventId, line, receiptId: null };
  }

  const claimed = await claimSent(eventId, { taskId, kind });
  if (!claimed) {
    return { sent: false, skipped: "duplicate", eventId, line, receiptId: null };
  }

  // Re-check only a successfully sent sibling. A claimed-but-unsent row must
  // not collapse overlapping PR-open + complete into zero Workflow POSTs.
  if (sibling && (await siblingSent(taskId, sibling, COALESCE_WINDOW_MS))) {
    await markSent(eventId, "coalesced");
    return { sent: false, skipped: "coalesced", eventId, line, receiptId: null };
  }

  const dest = primaryDeliveryUrl(cfg);
  if (!dest) return { ...empty, skipped: "missing_delivery", eventId, line };

  const postWebhook = deps.postWebhook ?? ((webhookUrl, text) => postTeamsWorkflow(webhookUrl, text));
  const sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const receipt = await postDestination(dest, line, postWebhook, sleep);

  if (!receipt.ok) {
    console.error(
      "[go-live-announcer] send failed eventId=%s status=%s auth=%s retryable=%s",
      eventId,
      receipt.status,
      receipt.permanentAuth,
      receipt.retryable
    );
    return {
      sent: false,
      skipped: receipt.permanentAuth ? "auth_failed" : "send_failed",
      eventId,
      line,
      receiptId: receipt.receiptId,
    };
  }
  await markSent(eventId, receipt.receiptId);
  if (kind === "task.completed" && url) {
    const prEventId = `pr.opened:${taskId}`;
    const claimedPr = await claimSent(prEventId, { taskId, kind: "pr.opened" });
    if (claimedPr) await markSent(prEventId, "coalesced");
  }
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
