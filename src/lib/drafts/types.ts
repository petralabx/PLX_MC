// Draft Projects (TASK-4059; PRD docs/product/PRD-draft-projects.md) — the
// client-safe shapes. A draft is a reviewable bundle: a planned project, its
// buckets and tasks under draft keys (P, B1, T1), plus the research behind it.
// Nothing in a draft is live. Accept (step 3) turns it into real records.

import type { PriorityKey } from "@/lib/mc-data/types";
import type { TaskKind } from "@/lib/tasks/kind-labels";

export const DRAFT_STATUSES = ["drafting", "in_review", "accepted", "withdrawn"] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];

/** Open drafts can still change; accepted and withdrawn drafts are closed. */
export const OPEN_DRAFT_STATUSES: readonly DraftStatus[] = ["drafting", "in_review"];

export const DRAFT_ID_RE = /^DRF-\d+$/;
export const DRAFT_BUCKET_KEY_RE = /^B\d{1,3}$/;
export const DRAFT_TASK_KEY_RE = /^T\d{1,3}$/;
export const DRAFT_DIGEST_RE = /^sha256:[0-9a-f]{64}$/;

export interface DraftPlanProject {
  key: "P";
  /** An open PRJ-* the draft adds buckets to; null plans a new project. */
  existing: string | null;
  name: string;
  owner: string;
  repos: string[];
  desc: string;
}

export interface DraftPlanBucket {
  key: string;
  name: string;
  owner: string;
  repos: string[];
  desc: string;
}

export interface DraftPlanTask {
  key: string;
  /** A draft bucket key (B1). */
  bucket: string;
  title: string;
  description: string;
  priority: PriorityKey;
  kind: TaskKind;
  repos: string[];
  accountableOwner: string | null;
  /** Draft task keys (T2) or existing TASK-* ids. */
  dependsOn: string[];
}

export interface DraftPlan {
  project: DraftPlanProject;
  buckets: DraftPlanBucket[];
  tasks: DraftPlanTask[];
}

export interface DraftFinding {
  text: string;
  /** Source refs ("[1]") this finding cites. */
  sources: string[];
}

export interface DraftApproach {
  name: string;
  pros: string[];
  cons: string[];
  risk: "low" | "medium" | "high";
  effort: "S" | "M" | "L";
  chosen: boolean;
}

export interface DraftRisk {
  text: string;
  likelihood: "low" | "medium" | "high";
  impact: "low" | "medium" | "high";
  mitigation: string;
}

export interface DraftSource {
  ref: string;
  title: string;
  url: string;
  kind: "internal" | "external";
  excerpt: string;
  /** ISO date the source was read. */
  accessed: string;
}

export const DRAFT_ARTIFACT_KINDS = ["diagram", "screenshot", "web-page", "document", "markdown", "mermaid"] as const;

export interface DraftArtifact {
  kind: (typeof DRAFT_ARTIFACT_KINDS)[number];
  name: string;
  /** A link; null for an inline artifact. */
  url: string | null;
  /** Inline markdown or Mermaid; null for a link. */
  inline: string | null;
}

export interface DraftResearch {
  summary: string;
  context: string;
  findings: DraftFinding[];
  approaches: DraftApproach[];
  recommendation: string;
  risks: DraftRisk[];
  openQuestions: string[];
  sources: DraftSource[];
  artifacts: DraftArtifact[];
}

/** What a version freezes: the title, the plan and the research. */
export interface DraftContent {
  title: string;
  plan: DraftPlan;
  research: DraftResearch;
}

export const DRAFT_REVIEW_KINDS = ["comment", "finding", "approve", "request_changes"] as const;
export type DraftReviewKind = (typeof DRAFT_REVIEW_KINDS)[number];

export type DraftFindingStatus = "open" | "resolved" | "dismissed";

export interface DraftReview {
  /** drv_* id. */
  id: string;
  kind: DraftReviewKind;
  body: string;
  /** Findings only: an open blocking finding refuses Accept (PRD decision 2). */
  blocking: boolean;
  /** Optional plan key (P, B1, T3) or research section the review is about. */
  target: string | null;
  /** The frozen version and digest the review was given on. */
  version: number;
  digest: string;
  /** Audit label: the person's email. */
  by: string;
  byKind: "human" | "agent";
  /** The MCP service principal for an agent review. */
  byPrincipal: string | null;
  at: string;
  /**
   * "mc" when Mission Control raised it (a likely duplicate task at submit).
   * Review pages (TASK-4135): "page" records a published page, "artifact" a
   * comment relayed from one.
   */
  source: "review" | "mc" | "page" | "artifact";
  /** Findings only. */
  status: DraftFindingStatus | null;
  closedBy: string | null;
  closedAt: string | null;
  closeReason: string | null;
  /** "page" and "artifact": the review page's link. */
  pageUrl?: string | null;
  /** "artifact": the page's comment id, so a comment relayed twice is recorded once. */
  pageCommentId?: string | null;
  /** "artifact": the agent that relayed the comment, and the person it works for. */
  relayedBy?: string | null;
  relayedFor?: string | null;
}

/** The review pages published for a draft (TASK-4135), oldest first. */
export function draftPages(draft: Pick<Draft, "reviews">): DraftReview[] {
  return draft.reviews.filter((r) => r.source === "page" && r.pageUrl);
}

export interface Draft {
  id: string;
  status: DraftStatus;
  /** Always a person (email). For a draft an agent writes, the person it works for. */
  author: string;
  /** The MCP service principal, or the session, that wrote the draft. */
  createdBy: string;
  visibility: "shared" | "restricted";
  members: string[];
  /** People the author asks to review (directory ids or emails). */
  reviewers: string[];
  /** The latest frozen version; 0 before the first submit. */
  version: number;
  digest: string | null;
  /** The working copy; it matches the latest version until the next edit. */
  working: DraftContent;
  reviews: DraftReview[];
  /** Draft key to created record id, written by Accept (step 3). */
  materialized: Record<string, string>;
  /** In review: when the running Accept claimed the draft (null once it fails). Accepted: when. */
  acceptedAt: string | null;
  /** Who accepted, or whose Accept started; set while in review, it pins the content (accept_unfinished). */
  acceptedBy: string | null;
  withdrawnAt: string | null;
  withdrawnBy: string | null;
  withdrawReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DraftVersion {
  draftId: string;
  version: number;
  digest: string;
  content: DraftContent;
  frozenBy: string;
  frozenAt: string;
}

/** One preflight or completeness problem that refuses a submit. */
export interface DraftIssue {
  code: string;
  /** Where in the content: "plan.tasks[T2].repos", "research.approaches". */
  path: string;
  message: string;
}

export function emptyDraftContent(title = ""): DraftContent {
  return {
    title,
    plan: {
      project: { key: "P", existing: null, name: title, owner: "", repos: [], desc: "" },
      buckets: [],
      tasks: [],
    },
    research: {
      summary: "",
      context: "",
      findings: [],
      approaches: [],
      recommendation: "",
      risks: [],
      openQuestions: [],
      sources: [],
      artifacts: [],
    },
  };
}

/** A review given on an older version than the draft's current one. */
export function isStaleReview(review: Pick<DraftReview, "digest">, draft: Pick<Draft, "digest">): boolean {
  return review.digest !== draft.digest;
}

/** A claim older than this belongs to a crashed Accept; the next Accept takes over. */
export const ACCEPT_CLAIM_STALE_MS = 10 * 60_000;

/** An Accept is running: the draft is still in review and its claim is fresh. */
export function acceptInProgress(draft: Pick<Draft, "status" | "acceptedAt">, nowMs = Date.now()): boolean {
  return draft.status === "in_review" && draft.acceptedAt !== null && nowMs - Date.parse(draft.acceptedAt) < ACCEPT_CLAIM_STALE_MS;
}

/** Open blocking findings, on any version: each refuses Accept until closed. */
export function openBlockingFindings(draft: Pick<Draft, "reviews">): DraftReview[] {
  return draft.reviews.filter((r) => r.kind === "finding" && r.blocking && r.status === "open");
}
