// Goals & Production report barrel — the module boundary. Import through here,
// not the internal files (module contract: docs/modules/reporting-goals/README.md).
// The pure rules and the view are safe anywhere; refresh, store, loader, source-db
// and access are server-only (client components use `import type` only).

export type {
  BatchHistoryRow,
  BatchRow,
  CustomerRow,
  Cutoffs,
  DailyRow,
  Datasets,
  EntryStatus,
  EntryType,
  FtlCustomer,
  FxRate,
  FxSource,
  GoalSettings,
  GoalSummaryRow,
  IsoDate,
  ManualEntry,
  ReferenceKind,
  ReferenceRow,
  RefreshRun,
  RefreshTrigger,
  RevenueRow,
  RunStatus,
  ShipmentRow,
  SnapshotData,
  TruckloadRow,
} from "./types";

export {
  REPORT_TIME_ZONE,
  addDays,
  eachDay,
  isWorkingDay,
  isoWeekday,
  monthEnd,
  monthLabel,
  monthStart,
  ontarioStatutoryHolidays,
  previousMonthStart,
  torontoDate,
  torontoHour,
  workingDaysBetween,
} from "./calendar";
export type { Holiday } from "./calendar";

export { centsToDecimal, convertCents, formatDollars, invertCents, prorateCents, toCents } from "./money";

export {
  ENTRY_STATUS_LABELS,
  SIZE_BANDS,
  classifyLoad,
  computeGoals,
  coveredThrough,
  entryStatus,
  isBehind,
  isQcReleased,
  latestRateOnOrBefore,
  normalizeName,
  normalizeRef,
  pacePer20,
  rateOn,
  sizeBand,
  takeaway,
  truckloadCustomerFor,
} from "./rules";
export type {
  BandCount,
  BandTile,
  BatchListRow,
  BatchStage,
  CalendarDay,
  DailyPoint,
  EntryContext,
  EvaluatedEntry,
  GoalStatus,
  GoalsInput,
  GoalsModel,
  HistoryMonth,
  LoadCounts,
  LoadKind,
  LoadTally,
  SizeBand,
  TruckloadCustomerRow,
} from "./rules";

export { DATASET_QUERIES, SECTION_QUERIES, buildGoalsView } from "./view";
export type { DatasetQuery, GoalsView, GoalsViewInput, GoalsViewState } from "./view";

export { FX_SERIES, fetchUsdCadRates } from "./fx";
export type { FetchRates } from "./fx";

export { ATTEMPT_TIMEOUT_MS } from "./source-db";

export {
  REFRESH_BUDGET_MS,
  RETRY_BACKOFF_MS,
  RefreshFailure,
  isTransient,
  readDatasets,
  runRefresh,
  startRefresh,
} from "./refresh";
export type { RefreshDeps, RefreshStep } from "./refresh";

export {
  LIST_RETENTION_RUNS,
  RATE_LIMIT_SECONDS,
  RETENTION_DAYS,
  STALE_RUN_MINUTES,
  getRun,
  latestRuns,
  listEntries,
  loadConfig,
} from "./store";
export type { ClaimOutcome, GoalsConfig } from "./store";

export { loadGoalsView } from "./loader";

export {
  GOALS_EDITOR_ROLE,
  GOALS_VIEWER_ROLE,
  goalsRolesFromClaims,
  requireGoalsRole,
  resolveGoalsActor,
} from "./access";
export type { GoalsActor, GoalsRole } from "./access";
