export type {
  AuthorizationTrust,
  CreationIntentRecord,
  MarkerAuthority,
  MarkerKind,
  MarkerParseRejection,
  ParseRoutingMarkersResult,
  ParsedRoutingMarker,
  ProposalIdentity,
  RoutingActorKind,
  RoutingCandidateRecord,
  RoutingDecisionInput,
  RoutingDecisionKind,
  RoutingEvidenceMeta,
  RoutingFailureReason,
  RoutingProposalInput,
  RoutingProposalRecord,
  RoutingProposalState,
  RoutingRevisionInput,
  RoutingRevisionRecord,
  RoutingSessionId,
  RoutingSessionInput,
  RoutingSessionRecord,
  RoutingSessionStatus,
  WorkLinkInput,
  WorkLinkType,
} from "./types";

export type { RoutingQuery } from "./repo";

export {
  MAX_ROUTING_BODY_BYTES,
  hashRoutingBody,
  parseRoutingMarkers,
} from "./markers";

export {
  allocateNextTaskId,
  appendWorkLink,
  consumeRoutingSession,
  getProposalByIdentity,
  insertCreationIntent,
  lockProposalForUpdate,
  recordDecision,
  resolveProposal,
  upsertProposalRevision,
  upsertRoutingProposal,
  upsertRoutingSession,
} from "./repo";

export {
  confirmExistingTask,
  attachCheckoutLink,
  createConfirmedTask,
  type ConfirmExistingInput,
  type AttachCheckoutInput,
  type CreateRoutedTaskInput,
  type RoutingMutationResult,
} from "./service";

export {
  requireSessionActor,
  requireMcpActor,
  type AuthorizedActor,
} from "./mutations/actors";

export {
  routingConfirmEnabled,
  assertMutableTrust,
  creationIntentHash,
} from "./mutations/preconditions";

export {
  MC_TASK_ID_SEQUENCE,
  ROUTING_POLICY_VERSION,
  ROUTING_TABLES,
  formatTaskId,
} from "./persistence";

export {
  loadRolloutConfig,
  listPilotDescriptors,
  getPilotByCohortId,
  getPilotByRepo,
  evaluateCohortMetrics,
  evaluateRollingWindow,
  resolveCohortRuntimeState,
  demoteBreachedCohorts,
  isFuzzyAutoLinkAllowedForRollout,
  wilsonLowerBound,
  shadowEnabled,
  suggestEnabled,
  confirmEnabled,
  proposalsEnabled,
  metadataEnabled,
  inboxEnabled,
  maintenanceEnabled,
  killSwitchSnapshot,
  rolloutHealth,
  type RolloutMode,
  type RolloutConfig,
  type PilotDescriptor,
  type CohortMetrics,
  type RollingDecision,
  type CohortRuntimeState,
  type ThresholdEvaluation,
} from "./rollout";

export {
  planRetentionActions,
  applyRetentionPlan,
  summarizeRetentionPlan,
  retentionConfig,
  slaAgeHours,
  slaBreachBand,
  type RetentionRecord,
  type RetentionPlanItem,
  type RetentionRunResult,
} from "./retention";
