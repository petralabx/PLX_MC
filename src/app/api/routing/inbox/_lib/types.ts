/** Session API DTOs for the Routing Inbox (never include raw PR bodies). */

export type InboxScope = "personal" | "project" | "bucket" | "unrouted";

export interface InboxCandidateDto {
  rank: number;
  taskId: string;
  bucketId: string;
  projectId: string | null;
  matchScore: number;
  authorizationTrust: string;
  reasons: string[];
}

export interface InboxProposalSummary {
  id: string;
  repoId: string;
  changeId: string;
  title: string | null;
  state: string;
  failureReason: string | null;
  derivedProjectId: string | null;
  selectedBucketId: string | null;
  selectedTaskId: string | null;
  sessionId: string | null;
  accountableActorId: string | null;
  accountableActorKind: string | null;
  topCandidate: InboxCandidateDto | null;
  slaAgeHours: number;
  slaBreach: "none" | "alert_24h" | "expire_7d";
  createdAt: string;
  updatedAt: string;
}

export interface InboxProposalDetail extends InboxProposalSummary {
  markers: unknown[];
  hierarchy: {
    projectId: string | null;
    bucketId: string | null;
    taskId: string | null;
  };
  candidates: InboxCandidateDto[];
  revisionId: string | null;
  headSha: string | null;
  policyVersion: string | null;
  overrideAvailable: boolean;
}
