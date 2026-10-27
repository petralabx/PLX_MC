// Draft Projects rules (TASK-4059; PRD docs/product/PRD-draft-projects.md):
// who may see, write, submit and review a draft, and what each step changes.
// The MCP actions (src/lib/mcp/draft-actions.ts) and, in step 3, the session
// routes both call these, so the transports cannot disagree. Server-only.
//
// - Visibility follows projects: shared, or restricted to members. The author
//   always sees it; the principal that wrote it does not, by itself, because a
//   principal is a runtime key that many people share. Under enforce, an agent
//   sees a restricted draft only when its sp_* id is a member. A hidden draft
//   reads as not found.
// - Only the draft's writer edits, submits or withdraws it: for an agent, the
//   same principal acting for the same person (author); for a person, the author.
// - Submit freezes the working copy as the next version, after the completeness
//   and preflight checks pass, and raises likely duplicates as findings.
// - Reviews name the version they were given on. An agent's approval is advisory.
//   A blocking finding stays open until its raiser resolves it, or the author
//   resolves or dismisses it (a person, with a reason). Accept is step 3.

import { randomBytes } from "node:crypto";

import { ApiError } from "@/lib/api/route";
import { appendEvent } from "@/lib/compliance/repo";
import { HUMANS } from "@/lib/mc-data/data";
import { isArchived, isPetraEmail } from "@/lib/mc-data/helpers";
import { isClosedStage } from "@/lib/mc-data/policy";
import type { Bucket, Human, Project, Repo, Task } from "@/lib/mc-data/types";
import {
  canAccessProject,
  normalizeMemberToken,
  normalizeProjectMembers,
  restrictedBucketIds,
  restrictedProjectIds,
  type ProjectAclPrincipal,
} from "@/lib/permissions/project-acl";
import { recordShadowMismatch } from "@/lib/permissions/shadow-mismatch";
import { databaseConfigured } from "@/lib/secrets";
import { getBuckets, getEntities, getProjects, getRepos } from "@/lib/sync/repo";

import { likelyDuplicates, type OpenTaskTitle } from "./duplicates";
import { preflightIssues, submitIssues, type PreflightContext } from "./preflight";
import { MAX_DRAFT_CONTENT_BYTES, draftContentBytes, draftDigest } from "./schema";
import * as store from "./store";
import {
  OPEN_DRAFT_STATUSES,
  emptyDraftContent,
  isStaleReview,
  type Draft,
  type DraftContent,
  type DraftIssue,
  type DraftPlan,
  type DraftResearch,
  type DraftReview,
  type DraftReviewKind,
  type DraftStatus,
  type DraftVersion,
} from "./types";

export interface DraftActor {
  kind: "human" | "agent";
  /** The person: the session email, or the agent's operator email. */
  email: string;
  /** The session's Entra oid, or the agent's MCP service principal. */
  principalId: string;
  /** Project-ACL tokens, from the same helpers projects use. */
  acl: ProjectAclPrincipal;
  /** Audit runtime (cursor, claude-code, …) for an agent. */
  runtime?: string;
  repo?: string | null;
}

/** Live state the checks read. Injected so tests need no database. */
export interface DraftDeps {
  registry(): Promise<Record<string, Repo>>;
  projects(): Promise<Project[]>;
  buckets(): Promise<Bucket[]>;
  openTasks(): Promise<Task[]>;
  humans(): readonly Human[];
}

export const defaultDraftDeps: DraftDeps = {
  async registry() {
    return Object.fromEntries((await getRepos()).map((r) => [r.id, r]));
  },
  projects: () => getProjects(),
  buckets: () => getBuckets(),
  async openTasks() {
    return (await getEntities("task")).map((r) => r.data as unknown as Task).filter((t) => !isClosedStage(t.stage));
  },
  humans: () => Object.values(HUMANS),
};

const now = () => new Date().toISOString();

function notFound(id: string): ApiError {
  return new ApiError("not_found", `Unknown draft ${id}.`, 404);
}

async function recordEvent(kind: string, actor: DraftActor, payload: Record<string, unknown>): Promise<void> {
  if (!databaseConfigured()) return;
  await appendEvent({
    kind,
    actor: actor.kind === "agent" ? `${actor.principalId} (${actor.email})` : actor.email,
    repo: actor.repo ?? null,
    payload: { ...payload, actorKind: actor.kind, principalId: actor.principalId, runtime: actor.runtime ?? null },
  });
}

// ─── Access ──────────────────────────────────────────────────────────────────

export function canSeeDraft(draft: Pick<Draft, "visibility" | "members" | "author">, actor: Pick<DraftActor, "acl">): boolean {
  return canAccessProject({ visibility: draft.visibility, members: [...draft.members, draft.author] }, actor.acl);
}

/** The draft's writer: the author in person, or the same principal acting for the author. */
export function isDraftWriter(draft: Pick<Draft, "author" | "createdBy">, actor: DraftActor): boolean {
  const sameAuthor = normalizeMemberToken(actor.email) === normalizeMemberToken(draft.author);
  if (actor.kind === "human") return sameAuthor;
  return sameAuthor && actor.principalId === draft.createdBy;
}

function assertOpen(draft: Draft): void {
  if (!OPEN_DRAFT_STATUSES.includes(draft.status)) {
    throw new ApiError("draft_closed", `${draft.id} is ${draft.status}; it can no longer change.`, 409);
  }
}

function assertWriter(draft: Draft, actor: DraftActor): void {
  if (!isDraftWriter(draft, actor)) {
    throw new ApiError(
      "not_draft_writer",
      `Only ${draft.author}, or the agent that wrote ${draft.id} for them, may change it.`,
      403
    );
  }
}

async function visibleDraft(id: string, actor: DraftActor): Promise<Draft> {
  const draft = await store.getDraft(id);
  if (!draft || !canSeeDraft(draft, actor)) throw notFound(id);
  // TASK-3026 shadow log, as project reads keep: a restricted draft this agent
  // sees only through its operator email would vanish under enforce.
  const principalOnly = actor.acl.principalOnlyTokens;
  if (principalOnly && draft.visibility === "restricted" && !canSeeDraft(draft, { acl: { tokens: principalOnly } })) {
    void recordShadowMismatch({
      site: "drafts.read",
      mode: "shadow",
      actor: principalOnly[0] ?? actor.principalId,
      draftId: draft.id,
      operatorAllowed: true,
      principalAllowed: false,
    });
  }
  return draft;
}

// ─── Create and edit ─────────────────────────────────────────────────────────

export interface DraftSections {
  title?: string;
  plan?: DraftPlan;
  research?: DraftResearch;
  visibility?: "shared" | "restricted";
  members?: string[];
  reviewers?: string[];
}

function applySections(content: DraftContent, sections: DraftSections): DraftContent {
  const next: DraftContent = {
    title: sections.title ?? content.title,
    plan: sections.plan ?? content.plan,
    research: sections.research ?? content.research,
  };
  if (draftContentBytes(next) > MAX_DRAFT_CONTENT_BYTES) {
    throw new ApiError("draft_too_large", `A draft holds at most ${MAX_DRAFT_CONTENT_BYTES / 1024} KiB of content.`, 413);
  }
  return next;
}

function normalizeReviewers(reviewers: readonly string[]): string[] {
  return normalizeProjectMembers(reviewers).slice(0, 20);
}

export async function createDraft(actor: DraftActor, sections: DraftSections & { title: string }): Promise<Draft> {
  const author = normalizeMemberToken(actor.email);
  if (!isPetraEmail(author)) {
    throw new ApiError(
      "invalid_author",
      "A draft's author is a Petra person. Send x-mc-operator-email for the person the agent works for.",
      422
    );
  }
  const working = applySections(emptyDraftContent(sections.title), sections);
  if (!sections.plan) working.plan.project.name = sections.title;
  const draft = await store.insertDraft({
    author,
    createdBy: actor.principalId,
    visibility: sections.visibility ?? "shared",
    members: normalizeProjectMembers(sections.members),
    reviewers: normalizeReviewers(sections.reviewers ?? []),
    working,
  });
  await recordEvent("draft.created", actor, { draftId: draft.id, visibility: draft.visibility });
  return draft;
}

export async function saveDraft(actor: DraftActor, id: string, sections: DraftSections): Promise<{ draft: Draft; changed: boolean }> {
  await visibleDraft(id, actor);
  const result = await store.mutateDraft(id, (draft) => {
    assertWriter(draft, actor);
    assertOpen(draft);
    const working = applySections(draft.working, sections);
    const next: Draft = {
      ...draft,
      working,
      visibility: sections.visibility ?? draft.visibility,
      members: sections.members ? normalizeProjectMembers(sections.members) : draft.members,
      reviewers: sections.reviewers ? normalizeReviewers(sections.reviewers) : draft.reviewers,
    };
    // An edit during review returns the draft to drafting; the next submit freezes a new version.
    if (next.status === "in_review" && draftDigest(working) !== draft.digest) next.status = "drafting";
    return { draft: next };
  });
  if (!result) throw notFound(id);
  await recordEvent("draft.updated", actor, {
    draftId: id,
    status: result.draft.status,
    sections: Object.keys(sections).filter((k) => sections[k as keyof DraftSections] !== undefined),
  });
  return result;
}

export async function withdrawDraft(actor: DraftActor, id: string, reason: string): Promise<Draft> {
  await visibleDraft(id, actor);
  const result = await store.mutateDraft(id, (draft) => {
    assertWriter(draft, actor);
    assertOpen(draft);
    return { draft: { ...draft, status: "withdrawn", withdrawnAt: now(), withdrawnBy: actor.email, withdrawReason: reason } };
  });
  if (!result) throw notFound(id);
  await recordEvent("draft.withdrawn", actor, { draftId: id, reason });
  return result.draft;
}

// ─── Preflight and submit ────────────────────────────────────────────────────

async function preflightContext(actor: DraftActor, deps: DraftDeps): Promise<PreflightContext> {
  const [registry, projects] = await Promise.all([deps.registry(), deps.projects()]);
  return { registry, projects, humans: deps.humans(), principal: actor.acl };
}

/** The preflight problems in a draft's working copy, for an advisory read (mc_save_draft). */
export async function draftPreflight(actor: DraftActor, draft: Draft, deps: DraftDeps = defaultDraftDeps): Promise<DraftIssue[]> {
  return preflightIssues(draft.working, await preflightContext(actor, deps));
}

/** Open tasks in shared projects only: a finding must not leak a restricted task's title. */
async function sharedOpenTasks(deps: DraftDeps): Promise<OpenTaskTitle[]> {
  const [tasks, buckets, projects] = await Promise.all([deps.openTasks(), deps.buckets(), deps.projects()]);
  const hiddenBuckets = restrictedBucketIds(buckets, restrictedProjectIds(projects));
  const archived = new Set(buckets.filter(isArchived).map((b) => b.id));
  return tasks.filter((t) => !hiddenBuckets.has(t.bucket) && !archived.has(t.bucket)).map((t) => ({ id: t.id, title: t.title }));
}

function newReview(fields: Omit<DraftReview, "id" | "at" | "closedBy" | "closedAt" | "closeReason">): DraftReview {
  return { id: `drv_${randomBytes(8).toString("hex")}`, at: now(), closedBy: null, closedAt: null, closeReason: null, ...fields };
}

export interface SubmitResult {
  draft: Draft;
  /** False when the working copy already is the current version under review. */
  frozen: boolean;
  duplicates: number;
}

export async function submitDraft(actor: DraftActor, id: string, deps: DraftDeps = defaultDraftDeps): Promise<SubmitResult> {
  const current = await visibleDraft(id, actor);
  assertWriter(current, actor);
  assertOpen(current);
  const issues = submitIssues(current.working, await preflightContext(actor, deps));
  if (issues.length > 0) {
    throw new ApiError(
      "draft_not_ready",
      `${id} cannot be submitted: ${issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`,
      422
    );
  }
  const openTasks = await sharedOpenTasks(deps);
  const checked = draftDigest(current.working);
  let frozen = false;
  let duplicates = 0;
  const result = await store.mutateDraft(id, (draft) => {
    assertWriter(draft, actor);
    assertOpen(draft);
    const digest = draftDigest(draft.working);
    // The checks ran on the working copy read before the lock; never freeze other content.
    if (digest !== checked) throw new ApiError("draft_changed", `${id} changed during the submit; submit again.`, 409);
    if (digest === draft.digest) {
      if (draft.status === "in_review") return null;
      return { draft: { ...draft, status: "in_review" } };
    }
    const version: DraftVersion = {
      draftId: id,
      version: draft.version + 1,
      digest,
      content: draft.working,
      frozenBy: actor.email,
      frozenAt: now(),
    };
    // Every MC finding counts, closed ones too: a dismissal, with its reason, sticks.
    const known = new Set(draft.reviews.filter((r) => r.source === "mc").map((r) => `${r.target}:${r.body}`));
    const raised = likelyDuplicates(draft.working.plan.tasks, openTasks)
      .map((hit) =>
        newReview({
          kind: "finding",
          body: `Possible duplicate of ${hit.taskId}: "${hit.title}".`,
          blocking: false,
          target: hit.key,
          version: version.version,
          digest,
          by: "mission-control",
          byKind: "agent",
          byPrincipal: null,
          source: "mc",
          status: "open",
        })
      )
      .filter((r) => !known.has(`${r.target}:${r.body}`));
    frozen = true;
    duplicates = raised.length;
    return {
      draft: { ...draft, status: "in_review", version: version.version, digest, reviews: [...draft.reviews, ...raised] },
      freeze: version,
    };
  });
  if (!result) throw notFound(id);
  await recordEvent("draft.submitted", actor, {
    draftId: id,
    version: result.draft.version,
    digest: result.draft.digest,
    frozen,
    duplicates,
  });
  return { draft: result.draft, frozen, duplicates };
}

// ─── Reviews ─────────────────────────────────────────────────────────────────

export interface ReviewInput {
  kind: DraftReviewKind;
  body: string;
  blocking?: boolean;
  target?: string | null;
}

export async function reviewDraft(actor: DraftActor, id: string, input: ReviewInput): Promise<{ draft: Draft; review: DraftReview }> {
  await visibleDraft(id, actor);
  let review: DraftReview | undefined;
  const result = await store.mutateDraft(id, (draft) => {
    // Again under the lock: the writer may have restricted the draft meanwhile.
    if (!canSeeDraft(draft, actor)) throw notFound(id);
    assertOpen(draft);
    if (draft.version === 0 || !draft.digest) {
      throw new ApiError("draft_not_submitted", `${id} has no submitted version to review yet.`, 409);
    }
    const finding = input.kind === "finding";
    review = newReview({
      kind: input.kind,
      body: input.body,
      blocking: finding ? input.blocking === true : false,
      target: input.target ?? null,
      version: draft.version,
      digest: draft.digest,
      by: actor.email,
      byKind: actor.kind,
      byPrincipal: actor.kind === "agent" ? actor.principalId : null,
      source: "review",
      status: finding ? "open" : null,
    });
    return { draft: { ...draft, reviews: [...draft.reviews, review] } };
  });
  if (!result || !review) throw notFound(id);
  await recordEvent("draft.reviewed", actor, {
    draftId: id,
    reviewId: review.id,
    kind: review.kind,
    blocking: review.blocking,
    version: review.version,
  });
  return { draft: result.draft, review };
}

function raisedBy(review: DraftReview, actor: DraftActor): boolean {
  const sameEmail = normalizeMemberToken(review.by) === normalizeMemberToken(actor.email);
  if (review.byKind === "agent") return actor.kind === "agent" && sameEmail && review.byPrincipal === actor.principalId;
  return actor.kind === "human" && sameEmail;
}

/**
 * Close a finding. Its raiser, or the author in person, resolves it. Only the
 * author in person dismisses it, with a reason that stays on the draft.
 */
export async function closeFinding(
  actor: DraftActor,
  id: string,
  findingId: string,
  action: "resolve" | "dismiss",
  note: string | null
): Promise<{ draft: Draft; review: DraftReview }> {
  await visibleDraft(id, actor);
  let closed: DraftReview | undefined;
  const result = await store.mutateDraft(id, (draft) => {
    if (!canSeeDraft(draft, actor)) throw notFound(id);
    assertOpen(draft);
    const finding = draft.reviews.find((r) => r.id === findingId && r.kind === "finding");
    if (!finding) throw new ApiError("not_found", `Unknown finding ${findingId} on ${id}.`, 404);
    if (finding.status !== "open") throw new ApiError("finding_closed", `${findingId} is already ${finding.status}.`, 409);
    const authorInPerson = actor.kind === "human" && isDraftWriter(draft, actor);
    if (action === "dismiss") {
      if (!authorInPerson) throw new ApiError("forbidden", `Only ${draft.author}, signed in, may dismiss a finding.`, 403);
      if (!note || note.trim().length < 10) throw new ApiError("invalid_request", "A dismissal needs a reason of 10 characters or more.", 422);
    } else if (!authorInPerson && !raisedBy(finding, actor)) {
      throw new ApiError("forbidden", `Only the reviewer who raised ${findingId}, or ${draft.author} signed in, may resolve it.`, 403);
    }
    closed = {
      ...finding,
      status: action === "resolve" ? "resolved" : "dismissed",
      closedBy: actor.email,
      closedAt: now(),
      closeReason: note?.trim() || null,
    };
    return { draft: { ...draft, reviews: draft.reviews.map((r) => (r.id === findingId ? closed! : r)) } };
  });
  if (!result || !closed) throw notFound(id);
  await recordEvent(`draft.finding.${action === "resolve" ? "resolved" : "dismissed"}`, actor, {
    draftId: id,
    reviewId: findingId,
    blocking: closed.blocking,
  });
  return { draft: result.draft, review: closed };
}

// ─── Reads ───────────────────────────────────────────────────────────────────

export async function getVisibleDraft(actor: DraftActor, id: string): Promise<Draft> {
  return visibleDraft(id, actor);
}

export async function getVisibleDraftVersion(actor: DraftActor, id: string, version: number): Promise<DraftVersion> {
  await visibleDraft(id, actor);
  const found = await store.getDraftVersion(id, version);
  if (!found) throw new ApiError("not_found", `${id} has no version ${version}.`, 404);
  return found;
}

export interface DraftListFilter {
  status?: DraftStatus | "open" | "all";
  q?: string;
  mine?: boolean;
  needsMyReview?: boolean;
}

/** A person's tokens for "named as a reviewer": their email and directory ids. */
function reviewerTokens(actor: DraftActor): Set<string> {
  const email = normalizeMemberToken(actor.email);
  const ids = Object.values(HUMANS)
    .filter((h) => (h.email ?? "").toLowerCase() === email)
    .map((h) => h.id.toLowerCase());
  return new Set([email, ...ids]);
}

export function needsReviewFrom(draft: Draft, actor: DraftActor): boolean {
  if (draft.status !== "in_review") return false;
  const tokens = reviewerTokens(actor);
  if (!draft.reviewers.some((r) => tokens.has(normalizeMemberToken(r)))) return false;
  return !draft.reviews.some(
    (r) => !isStaleReview(r, draft) && normalizeMemberToken(r.by) === normalizeMemberToken(actor.email) && r.kind !== "comment"
  );
}

/** The drafts the actor can see, filtered in the store before its limit, newest change first. */
export async function listVisibleDrafts(actor: DraftActor, filter: DraftListFilter = {}): Promise<store.DraftSummary[]> {
  const status = filter.status ?? "open";
  const statuses: DraftStatus[] =
    status === "open" ? [...OPEN_DRAFT_STATUSES] : status === "all" ? ["drafting", "in_review", "accepted", "withdrawn"] : [status];
  return store.listDraftSummaries({
    statuses,
    tokens: actor.acl.tokens,
    author: filter.mine ? actor.email : undefined,
    reviewerTokens: filter.needsMyReview ? [...reviewerTokens(actor)] : undefined,
    viewerEmail: actor.email,
    q: filter.q?.trim() || undefined,
    limit: DRAFT_LIST_LIMIT,
  });
}

/** At most this many drafts per list read. */
export const DRAFT_LIST_LIMIT = 200;

/** A compact row for lists: counts, not content. */
export function draftSummary(draft: Draft): store.DraftSummary {
  return store.summarizeDraft(draft);
}
