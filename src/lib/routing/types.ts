// Routing control-plane contracts. Metadata-only evidence — raw PR bodies are
// never part of a persisted record. matchScore and authorizationTrust stay
// separate so textual certainty never becomes mutation authority.

/** Provisional routing session id (`rtx_*`). */
export type RoutingSessionId = `rtx_${string}`;

/** Stable proposal identity once a PR (change) exists. */
export interface ProposalIdentity {
  repoId: string;
  changeId: string;
}

/**
 * Metadata-only evidence collected for scoring/proposal revisions.
 * Callers must hash the PR body before constructing this; `bodyContentHash`
 * is retained, never the raw body text.
 */
export interface RoutingEvidenceMeta {
  /** Durable repository identity when known; optional on provisional drafts. */
  repoId?: string;
  repoFullName?: string;
  changeId?: string;
  headSha?: string;
  baseBranch?: string;
  sourceBranch?: string;
  branch?: string;
  title?: string;
  bodyContentHash?: string;
  changedPaths?: string[];
  pathCount?: number;
  labels?: string[];
  actorId?: string;
  actorKind?: RoutingActorKind;
  eventSource?: string;
  eventAction?: string;
  eventAt?: string;
}

/** How much mutation authority an exact match may claim — not a score. */
export type AuthorizationTrust =
  | "credentialed_checkout"
  | "persisted_decision"
  | "author_declaration"
  | "routing_correlation"
  | "fuzzy"
  | "none";

export type MarkerKind = "task" | "routing" | "checkout";

/**
 * Authority classification for parsed markers.
 * - task_declaration: author-controlled; ranks but does not authorize alone
 * - routing_correlation: session correlation only; no mutation authority
 * - checkout_credential_reference: may become credentialed after MC validates;
 *   the parser itself does not validate the credential
 */
export type MarkerAuthority =
  | "task_declaration"
  | "routing_correlation"
  | "checkout_credential_reference";

export interface ParsedRoutingMarker {
  kind: MarkerKind;
  value: string;
  authority: MarkerAuthority;
}

export type MarkerParseRejection = "malformed" | "oversized";

export interface ParseRoutingMarkersResult {
  ok: boolean;
  markers: ParsedRoutingMarker[];
  taskIds: string[];
  routingSessionIds: string[];
  checkoutIds: string[];
  /**
   * sha256 hex of the full UTF-8 body when within the limit. For oversized
   * input, hashes exactly the first MAX_ROUTING_BODY_BYTES UTF-8 bytes so
   * rejection work remains bounded; it is not a full-body digest.
   */
  bodyContentHash: string;
  rejection?: MarkerParseRejection;
}

export interface RoutingCandidateRecord {
  rank: number;
  taskId: string;
  bucketId: string;
  /** Derived from the candidate Bucket; never guessed independently. */
  projectId: string | null;
  matchScore: number;
  authorizationTrust: AuthorizationTrust;
  reasons: string[];
}

export type RoutingSessionStatus = "active" | "consumed" | "expired" | "transferred";

export type RoutingActorKind = "human" | "service";

export interface RoutingSessionInput {
  id: RoutingSessionId | string;
  repoId: string;
  actorId: string;
  actorKind: RoutingActorKind;
  baseBranch: string;
  sourceBranch: string;
  headSha: string | null;
  status: RoutingSessionStatus;
  absoluteExpiresAt: string;
  idleExpiresAt: string;
}

export interface RoutingSessionRecord extends RoutingSessionInput {
  createdAt?: string;
  lastActivityAt?: string;
  consumedAt?: string | null;
  consumedProposalId?: string | null;
}

export type RoutingProposalState =
  | "provisional"
  | "action_required"
  | "resolved"
  | "rejected"
  | "expired"
  | "degraded";

export type RoutingFailureReason =
  | "sync_stale"
  | "sync_conflict"
  | "repo_not_operationally_onboarded"
  | "session_expired"
  | "session_consumed"
  | "unauthorized"
  | "malformed_evidence"
  | "body_too_large"
  | "replay_conflict"
  | "unknown"
  | null;

export interface RoutingProposalInput {
  id: string;
  repoId: string;
  changeId: string;
  sessionId: string | null;
  state: RoutingProposalState;
  title: string | null;
  bodyContentHash: string | null;
  markers: ParsedRoutingMarker[];
  derivedProjectId: string | null;
  failureReason: RoutingFailureReason;
}

export interface RoutingProposalRecord extends RoutingProposalInput {
  selectedTaskId?: string | null;
  selectedBucketId?: string | null;
  resolvedAt?: string | null;
  detailExpiresAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface RoutingRevisionInput {
  id: string;
  proposalId: string;
  headSha: string;
  policyVersion: string;
  evidenceMeta: RoutingEvidenceMeta;
  candidates: RoutingCandidateRecord[];
}

export interface RoutingRevisionRecord {
  id: string;
  proposalId: string;
  headSha: string;
  policyVersion: string;
  evidenceMeta: RoutingEvidenceMeta;
  candidates: RoutingCandidateRecord[];
  createdAt?: string;
}

export type RoutingDecisionKind =
  | "accept_existing"
  | "reject"
  | "override"
  | "create_task"
  | "transfer";

export interface RoutingDecisionInput {
  id: string;
  proposalId: string;
  revisionId: string | null;
  decisionKind: RoutingDecisionKind;
  taskId: string | null;
  bucketId: string | null;
  projectId: string | null;
  actorId: string;
  actorKind: RoutingActorKind;
  overrideReason: string | null;
  rejectionReason: string | null;
  policyVersion: string;
}

export type WorkLinkType = "related" | "delivery";

export interface WorkLinkInput {
  id: string;
  proposalId: string | null;
  taskId: string;
  linkType: WorkLinkType;
  repoId: string;
  changeId: string;
  headSha: string | null;
  mergeSha: string | null;
  evidence: Record<string, unknown>;
  createdBy: string;
}

export interface CreationIntentRecord {
  id: string;
  proposalId: string;
  creationIntentHash: string;
  taskId: string;
}
