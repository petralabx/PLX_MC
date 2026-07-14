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
  /** Merge commit SHA when closed+merged; otherwise null. */
  mergeSha?: string | null;
  branch: string;
  baseBranch?: string;
  title: string;
  author: string;
  labels: string[];
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

  return {
    action: asStr(p.action),
    merged,
    repo: bareName,
    repoFullName: fullName || bareName,
    repositoryId,
    prNumber: num,
    headSha: asStr(head.sha),
    mergeSha: merged && mergeCommitSha ? mergeCommitSha : null,
    branch: asStr(head.ref),
    baseBranch: asStr(base.ref) || "main",
    title: asStr(pr.title),
    author: asStr(user.login),
    labels: labelsRaw.map((l) => asStr(asObj(l).name)).filter((s) => s.length > 0),
    checkoutId: checkoutIds[0] ?? null,
    checkoutIds,
    body,
    changedPaths: [],
  };
}

/** Strip in-memory body before any durable / cross-boundary handoff. */
export function withoutPrBody(evt: PrEvent): Omit<PrEvent, "body"> & { body?: never } {
  const { body: _body, ...rest } = evt;
  return rest;
}
