// Goals & Production report barrel — the module boundary. Import through here,
// not the internal files (module contract: docs/modules/reporting-goals/README.md).
// The pure rules and the view are safe anywhere; refresh, store, loader, source-db
// and access are server-only. Client components use `import type` from here and
// take pure runtime helpers from ./money (as screens do with mc-data/insights).

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
  IsoDate,
  ManualEntry,
  ReferenceKind,
  ReferenceRow,
  RefreshRun,
  RefreshTrigger,
  RevenueRateBasis,
  RevenueRow,
  RunStatus,
  ShipmentLineKind,
  ShipmentLineRow,
  CreditNoteRow,
  PendingShipmentRow,
  PendingShipmentsDataset,
  CreditNotesAccess,
  CreditNotesDataset,
  ShipmentLinesAccess,
  ShipmentLinesDataset,
  ShipmentLinesSummary,
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

export {
  allocateCents,
  allocateConvertedCents,
  centsToDecimal,
  convertCents,
  formatAmount,
  formatDollars,
  invertCents,
  prorateCents,
  sumToCents,
  toCents,
  usableRate,
} from "./money";

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

export {
  AMBER_FILL,
  AMBER_FONT,
  COUNT_FORMAT,
  DOLLAR_FORMAT,
  ENTRIES_SHEET,
  ENTRY_COLUMNS,
  ENTRY_CURRENCIES,
  ENTRY_FIRST_ROW,
  ENTRY_HEADER_ROW,
  ENTRY_LAST_FORMATTED_ROW,
  ENTRY_TYPES,
  FONT_NAME,
  FONT_SIZE,
  HEADER_FILL,
  IGNORED_ON_IMPORT,
  MAX_IMPORT_ROWS,
  TITLE_SIZE,
  WORKBOOK_SHEETS,
  workbookFileName,
} from "./excel/layout";
export type { EntryColumnKey, WorkbookSheet } from "./excel/layout";

// Workbook export (TASK-2898): its exports go below this line.
export { XLSX_CONTENT_TYPE, buildGoalsWorkbook } from "./excel/export";
export type { GoalsWorkbookInput } from "./excel/export";
export { loadGoalsExport } from "./loader";
export type { GoalsExportData } from "./loader";

// Manual entries and import (TASK-2897): their exports go below this line.
export {
  ENTRY_DATE_MAX,
  ENTRY_DATE_MIN,
  ENTRY_FIELDS,
  ENTRY_FIELD_LABELS,
  ENTRY_TEXT_LIMITS,
  MAX_IMPORT_BYTES,
  changedFields,
  entryValuesOf,
  plainDecimal,
  validateEntry,
} from "./entry-input";
export type {
  DraftValue,
  EntryCurrency,
  EntryDraft,
  EntryField,
  EntryFields,
  EntryValidation,
  EntryValues,
  FieldError,
} from "./entry-input";
export { ImportFileError, planImport, readEntriesSheet, rowErrorsMessage } from "./excel/import";
export type {
  ImportFileErrorCode,
  ImportPlan,
  PlanResult,
  PlannedAdd,
  PlannedChange,
  PlannedRemoval,
  RowError,
  SheetRow,
} from "./excel/import";
export {
  CONFIRM_BODY,
  ENTRY_BODY,
  ENTRY_PATCH,
  IMPORT_BODY,
  confirmImport,
  createEntry,
  deleteEntry,
  latestCustomers,
  liveEntries,
  previewImport,
  updateEntry,
} from "./entries";
export type { EntryBody, ImportPreview, ImportResult } from "./entries";

// Shipments list (TASK-3143): its exports go below this line.
export { buildShipmentList, filterShipments, shipmentTotals } from "./shipment-list";
export type { ShipmentFilter, ShipmentListInput, ShipmentListRow, ShipmentTotals } from "./shipment-list";
// What shipped, the invoices' lines (TASK-3144): its exports go below this line.
// shipment-lines.ts is pure; client components take its runtime helpers from ./shipment-lines directly.
export { invoiceLines, linesMismatch, linesSearchText, shipmentLinesView } from "./shipment-lines";
export type { InvoiceHeader, InvoiceLines, LinesCheck, ShipmentLinesView } from "./shipment-lines";
export { SHIPMENT_LINE_COLUMNS } from "./queries/shipment-lines";
export { CREDIT_NOTE_COLUMNS } from "./queries/credit-notes";
export { PENDING_SHIPMENT_COLUMNS, pendingShipmentsQuery } from "./queries/pending-shipments";
export { pendingShipmentsByClass, pendingShipmentsEnabled } from "./pending-shipments";
export type { PendingClassTotals, PendingShipmentsByClass } from "./pending-shipments";

export { DATASET_QUERIES, SECTION_QUERIES, buildGoalsView, revenueBasisParam } from "./view";
export type { DatasetQuery, GoalsPage, GoalsView, GoalsViewInput, GoalsViewState, GoalsViewer } from "./view";

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
  DEFAULT_SAGE_USD_CAD_RATE,
  LIST_RETENTION_RUNS,
  RATE_LIMIT_SECONDS,
  RETENTION_DAYS,
  SAGE_RATE_KEY,
  STALE_RUN_MINUTES,
  getRun,
  latestRuns,
  listEntries,
  loadConfig,
  loadShipmentLines,
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

// Revenue forecast (TASK-3151): its exports go below this line. forecast.ts is
// pure but holds the customer roster; client components take its runtime
// helpers from ./forecast-list directly, never from ./forecast or this barrel.
export {
  CHANNELS,
  CUSTOMER_CLASSES,
  FORECAST_BUCKETS,
  FORECAST_BUCKET_LABELS,
  FORECAST_FILTERS,
  HIT_RATE_MONTHS,
  MANUFACTURING_CATEGORIES,
  aoQtyInLineUnit,
  aoStage,
  bucketFor,
  buildForecast,
  channelOf,
  customerClassOf,
  filterForecastRows,
  fixOeNumber,
  forecastCadCents,
  activeCategoryFilter,
  bucketTotals,
  filteredForecastKpis,
  forecastCategoryOptions,
  forecastKpis,
  forecastRows,
  forecastSummary,
  hitRateMonths,
  isBulkMade,
  isCaseUnit,
  linkedOrderNumber,
  oeNumbersFromList,
  orderItemKey,
  otherCurrencyTotals,
  productionWithoutOrders,
} from "./forecast";
export type {
  AoStage,
  Channel,
  CustomerClass,
  ForecastBucket,
  ForecastBucketTotals,
  ForecastCategoryFilter,
  ForecastClassFilter,
  ForecastFilter,
  ForecastInput,
  ForecastKpiBasis,
  ForecastKpiFilter,
  ForecastKpis,
  ForecastListFilters,
  ForecastReady,
  ForecastRow,
  ForecastRunPoint,
  ForecastSnapshot,
  ForecastSummary,
  ForecastView,
  HitRateMonth,
} from "./forecast";
export type { ForecastAccess, ForecastAoRow, ForecastDatasets, ForecastLineRow } from "./types";
export { FORECAST_CATEGORY_COLUMNS, FORECAST_COLUMNS } from "./queries/forecast-access";

// Revenue by customer class (TASK-3781): its exports go below this line. Server-only (it reads the customer roster).
export { revenueByClass } from "./revenue-by-class";
export type { ClassRevenueRow, ClassRevenueTotals, RevenueByClass } from "./revenue-by-class";
export {
  BUSINESS_LINES,
  businessLineOf,
  businessLinePlus,
  businessLineSum,
  countedShipmentRefs,
  isServiceItem,
  normalizeItemCode,
  applyServiceCharges,
  pendingProductsOf,
  revenueByBusinessLine,
} from "./business-line";
export type {
  BusinessLine,
  BusinessLineAmounts,
  BusinessLineInput,
  BusinessLineScope,
  PendingProduct,
  PendingProductLine,
  RevenueByBusinessLine,
} from "./business-line";
export { revenueScope, SCOPE_EXCLUDES } from "./revenue-scope";
export { addWorkingDays, BATCH_LEAD_WORKING_DAYS, customerRevenue, searchCustomers, weekOf } from "./customer-revenue";
export type { CustomerRanking, CustomerRevenue, CustomerRevenueRow, UnpricedProduction } from "./customer-revenue";
export type { RevenueScope, RevenueScopeView } from "./revenue-scope";
