// EN-007 P1 — GitHub webhook helpers for git → MC ingestion (decision 8). Pure:
// HMAC signature verification + parsing a `pull_request` event into a normalized
// shape. The route (src/app/api/compliance/webhook) reads the raw body, verifies
// the signature here, then hands the parsed event to the ingestion service.
// Raw PR body is processed in memory for markers only — never returned for
// persistence beyond checkout ids / routing marker extraction at call sites.

import { createHmac, timingSafeEqual } from "node:crypto";

export interface PrEvent {
  action: string;
  merged: boolean;
  /** Bare repo name (github.event.repository.name) — back-compat for gate/ingest. */
  repo: string;
  /** Full owner/repo when available. */
  repoFullName?: string;
  /** Durable numeric GitHub repository id when present. */
  repositoryId?: string | null;
  prNumber: number;
  headSha: string;
  /** The head before a synchronize push (GitHub `before`); null for other actions (TASK-3410). */
  beforeSha?: string | null;
  forced?: boolean;
  /** Merge commit SHA when closed+merged; otherwise null. */
  mergeSha?: string | null;
  /** GitHub pr.merged_at (ISO-8601) when closed+merged — the task completion time. */
  mergedAt?: string | null;
  branch: string;
  baseBranch?: string;
  /** The head branch lives in another repository (a fork), or that fork is gone (TASK-4004). */
  crossRepo?: boolean;
  title: string;
  author: string;
  labels: string[];
  /** GitHub pull_request.draft — the projection shows a draft PR as "draft" (TASK-3743). */
  draft?: boolean;
  // Parsed from the PR-body markers the capture hook stamps (P3): "MC-Checkout:
  // dsp_…". `checkoutId` is the first (back-compat); `checkoutIds` is every stamp
  // on the PR — a multi-task PR completes N tasks, so ingestion attributes all.
  checkoutId: string | null;
  checkoutIds: string[];
  /**
   * In-memory PR body for marker/hash extraction at the propose boundary.
   * Callers must not persist this field — strip before any durable write.
   */
  body?: string;
  changedPaths?: string[];
}

// GitHub signs the raw body with HMAC-SHA256 (header `X-Hub-Signature-256:
// sha256=<hex>`). Constant-time compare; a missing/short header fails closed.
export function verifyGithubSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string
): boolean {
  if (!signatureHeader) return false;
  const expected = "sha256=" + createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const got = Buffer.from(signatureHeader);
  const exp = Buffer.from(expected);
  return got.length === exp.length && timingSafeEqual(got, exp);
}

// Collect EVERY stamp on the PR (multi-task), deduped, order-preserving.
const CHECKOUT_RE_G = /MC-Checkout:\s*(dsp_[A-Za-z0-9]+)/g;

function parseCheckoutIds(body: string): string[] {
  const ids = new Set<string>();
  for (const m of body.matchAll(CHECKOUT_RE_G)) ids.add(m[1]);
  return Array.from(ids);
}

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}
function asStr(v: unknown): string {
  return typeof v === "string" ? v : "";
}

// Returns null when the payload is not a pull_request event we handle.
export function parsePullRequestEvent(payload: unknown): PrEvent | null {
  const p = asObj(payload);
  const pr = asObj(p.pull_request);
  const num = pr.number;
  if (typeof num !== "number") return null;

  const head = asObj(pr.head);
  const base = asObj(pr.base);
  const repository = asObj(p.repository);
  const user = asObj(pr.user);
  const labelsRaw = Array.isArray(pr.labels) ? pr.labels : [];
  const body = asStr(pr.body);
  const checkoutIds = parseCheckoutIds(body);
  const fullName = asStr(repository.full_name);
  const bareName = asStr(repository.name) || (fullName.includes("/") ? fullName.slice(fullName.lastIndexOf("/") + 1) : fullName);
  const repoIdRaw = repository.id;
  const repositoryId =
    typeof repoIdRaw === "number" || typeof repoIdRaw === "string"
      ? String(repoIdRaw)
      : null;
  const mergeCommitSha = asStr(pr.merge_commit_sha);
  const merged = pr.merged === true;
  // GitHub sends head.repo as null once the fork is deleted.
  const headRepo = head.repo === null ? null : asObj(head.repo);
  const headFullName = headRepo ? asStr(headRepo.full_name) : "";
  const crossRepo = headRepo === null || (!!headFullName && !!fullName && headFullName.toLowerCase() !== fullName.toLowerCase());

  return {
    action: asStr(p.action),
    merged,
    repo: bareName,
    repoFullName: fullName || bareName,
    repositoryId,
    prNumber: num,
    headSha: asStr(head.sha),
    beforeSha: asStr(p.before) || null,
    forced: p.forced === true,
    mergeSha: merged && mergeCommitSha ? mergeCommitSha : null,
    mergedAt: merged && asStr(pr.merged_at) ? asStr(pr.merged_at) : null,
    branch: asStr(head.ref),
    baseBranch: asStr(base.ref) || "main",
    crossRepo,
    title: asStr(pr.title),
    author: asStr(user.login),
    labels: labelsRaw.map((l) => asStr(asObj(l).name)).filter((s) => s.length > 0),
    draft: pr.draft === true,
    checkoutId: checkoutIds[0] ?? null,
    checkoutIds,
    body,
    changedPaths: [],
  };
}

export type PrTaskResolution =
  | { kind: "none" }
  | { kind: "checkout" }
  | { kind: "resolved" | "ambiguous" | "revert" | "fork"; source: "title" | "branch"; taskIds: string[] };

// A whole upper-case TASK-n token, or a task-n in any case that opens the text
// or a branch segment ("claude/task-4004-x"). So "subtask-2", Dependabot's
// "setup-task-2" and "MY_TASK-2" name no task. Stricter than routing's
// extractBranchTaskIds, which only scores suggestions; this one links.
const TASK_REF_RE = /(?<![A-Za-z0-9_-])TASK-(\d+)(?![A-Za-z0-9])|(?:^|(?<=\/))[Tt][Aa][Ss][Kk]-(\d+)(?![A-Za-z0-9])/g;
// "revert", "reverts", "reverted" or "reverting" as a word anywhere in the title
// ("chore: revert …", "TASK-1: Revert …"), but not "Revert-safe". A false match
// only skips the link (and records it); a miss would promote the undone task.
const REVERT_TITLE_RE = /(?<![\w-])revert(?:s|ed|ing)?(?![\w-])/i;

function taskRefs(text: string): string[] {
  const ids = new Set<string>();
  for (const m of text.matchAll(TASK_REF_RE)) ids.add(`TASK-${m[1] ?? m[2]}`);
  return Array.from(ids);
}

// TASK-4004: the task a PR delivers. The first source present decides: the PR's
// MC-Checkout stamps (the dispatch ledger resolves them, even to no task), then
// a TASK-n in the title, then one in the branch. A title or branch that names
// several distinct ids is ambiguous and never falls through to the next. A
// revert (REVERT_TITLE_RE, or a branch segment starting `revert-`) names the
// task it undoes: kind "revert". A fork PR can come from anyone on a public
// repo: kind "fork". Neither links.
export function resolvePrTask(
  pr: Pick<PrEvent, "title" | "branch" | "crossRepo">,
  checkoutIds: string[]
): PrTaskResolution {
  if (checkoutIds.length > 0) return { kind: "checkout" };
  const revert = REVERT_TITLE_RE.test(pr.title) || /(^|\/)revert-/i.test(pr.branch);
  for (const source of ["title", "branch"] as const) {
    const taskIds = taskRefs(pr[source]);
    if (taskIds.length === 0) continue;
    const kind = pr.crossRepo ? "fork" : revert ? "revert" : taskIds.length === 1 ? "resolved" : "ambiguous";
    return { kind, source, taskIds };
  }
  return { kind: "none" };
}

/** Strip in-memory body before any durable / cross-boundary handoff. */
export function withoutPrBody(evt: PrEvent): Omit<PrEvent, "body"> & { body?: never } {
  const { body: _body, ...rest } = evt;
  return rest;
}
