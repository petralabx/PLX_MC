// Goals & Production — shared types. Datasets mirror the dataset queries
// (src/lib/reporting/goals/queries/) and the report_snap_* tables one-to-one.
// Amounts stay decimal strings exactly as the source summed them; the rules
// convert them to integer cents (money.ts).

/** A calendar day in America/Toronto, YYYY-MM-DD. */
export type IsoDate = string;

export type RefreshTrigger = "cron" | "user";
export type RunStatus = "running" | "succeeded" | "failed";
/** boc: fetched from the Bank of Canada during the run; stored: the fetch failed and the last stored rate was used. */
export type FxSource = "boc" | "stored";

export interface RefreshRun {
  id: number;
  trigger: RefreshTrigger;
  requestedBy: string;
  today: IsoDate;
  status: RunStatus;
  step: string | null;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
  productionCutoff: IsoDate | null;
  sageCutoff: IsoDate | null;
  fxRate: string | null;
  fxRateDate: IsoDate | null;
  fxSource: FxSource | null;
  rowCounts: Record<string, number>;
}

// ─── Datasets (one per query) ───────────────────────────────────────────────

export interface Cutoffs {
  productionCutoff: IsoDate | null;
  sageCutoff: IsoDate | null;
}

export interface DailyRow {
  day: IsoDate;
  cadThis: string;
  usdThis: string;
  cadLast: string;
  usdLast: string;
}

export interface TruckloadRow {
  code: string;
  shipment: string;
  shipDate: IsoDate;
  productUsd: string;
  productCad: string;
  thisMonth: boolean;
}

export interface RevenueRow {
  currency: string;
  thisMonth: boolean;
  invoices: number;
  netBeforeTax: string;
}

export interface ShipmentRow {
  invoice: string;
  shipment: string | null;
  orderNo: string | null;
  po: string | null;
  customerCode: string | null;
  customer: string | null;
  shipDate: IsoDate;
  currency: string;
  productValue: string;
  otherCharges: string;
  netBeforeTax: string;
}

export interface BatchRow {
  id: string;
  batch: string;
  product: string | null;
  status: string;
  statusQc: string | null;
  line: string | null;
  date: IsoDate;
  kg: string;
}

export interface BatchHistoryRow {
  id: string;
  batch: string;
  date: IsoDate;
  kg: string;
  statusQc: string | null;
}

export type ReferenceKind = "filemaker" | "sage";

export interface ReferenceRow {
  kind: ReferenceKind;
  ref: string;
}

export interface CustomerRow {
  code: string;
  name: string;
  currency: string | null;
}

/** Everything one refresh reads from the reporting database. */
export interface Datasets {
  cutoffs: Cutoffs;
  daily: DailyRow[];
  truckloads: TruckloadRow[];
  revenue: RevenueRow[];
  shipments: ShipmentRow[];
  batches: BatchRow[];
  batchHistory: BatchHistoryRow[];
  references: ReferenceRow[];
  customers: CustomerRow[];
}

/** The datasets the page needs (references and customers are looked up separately). */
export type SnapshotData = Omit<Datasets, "references" | "customers">;

// ─── Configuration ──────────────────────────────────────────────────────────

export interface GoalSettings {
  /** Line 1 bulk kg per working day (the goal). */
  line1KgPerWorkingDay: number;
  /** A batch of this many kg or more is assumed to run on Line 1 (FileMaker's line field is not used). */
  line1MinKg: number;
  fullTruckloadMinUsdCents: number;
  revenueTargetCadCents: number;
  /** null until the business sets a monthly full-truckload target. */
  fullTruckloadsPerMonth: number | null;
}

export interface FtlCustomer {
  code: string;
  displayName: string;
  /** Lower-case fragments matched against a manual entry's customer name. */
  namePatterns: string[];
  sortOrder: number;
}

export interface FxRate {
  date: IsoDate;
  rate: string;
}

// ─── Manual entries ─────────────────────────────────────────────────────────

export type EntryType = "Batch" | "Shipment";

export interface ManualEntry {
  entryId: string;
  type: string;
  date: IsoDate | null;
  reference: string | null;
  customer: string | null;
  customerCode: string | null;
  product: string | null;
  kg: string | null;
  productValue: string | null;
  freight: string | null;
  currency: string | null;
  note: string | null;
  enteredBy: string;
  enteredAt: string;
  updatedBy: string;
  updatedAt: string;
  source: string;
}

/** Computed at read time, never stored; the first match wins (rules.entryStatus). */
export type EntryStatus =
  | "in_filemaker"
  | "in_sage"
  | "needs_date"
  | "not_this_month"
  | "needs_kg"
  | "needs_value"
  | "bad_type"
  | "counted";
