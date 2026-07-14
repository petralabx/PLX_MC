// Loop Ledgers domain module barrel.
// All consumers must import through this file — not internal module files.

export type {
  Artifact,
  ArtifactStatus,
  ArtifactType,
  FreshnessConfig,
  FreshnessInfo,
  Freshness,
  HealthCode,
  LedgerRef,
  LedgerSummary,
  LedgerValidationResult,
  QualityLedger,
  RegistryConfig,
  RepoEntry,
  SafetyClass,
  Severity,
  ValidationError,
  ValidatorReasonCode,
} from "./types";

export {
  DEFAULT_FRESHNESS,
  computeFreshness,
  riskRank,
  scariestFirst,
  sortByScariest,
  validateLedgerJson,
  validateLedgerRaw,
} from "./validator";

export type { RegistryParseResult } from "./registry";
export { parseRegistryConfig, parseRegistryJson } from "./registry";

export type {
  BucketLedgerBinding,
  BucketLedgerMapConfig,
  BucketLedgerMapParseResult,
  BucketProjection,
  BucketProjectionSource,
} from "./projection";
export {
  bindingsForBucket,
  parseBucketLedgerMapJson,
  projectBucketFromRows,
  projectMilestones,
  projectTrace,
} from "./projection";

// ─── P2: Source adapters + loader ─────────────────────────────────────────────

export type {
  DiscoveredLedger,
  LedgerDetailResult,
  LedgerSource,
  LedgerSourceResult,
  SourceDegradedReason,
} from "./sources/source";
export { GithubApiSource } from "./sources/github-api";
export type { LocalFsOptions } from "./sources/local-fs";
export { LocalFsSource } from "./sources/local-fs";
export { createSource } from "./sources/index";

export type {
  DegradedSourceRow,
  LedgerRow,
  LoaderDetailResult,
  LoaderSummaryRow,
} from "./loader";
export { getLedgerDetail, listLedgerSummaries } from "./loader";
