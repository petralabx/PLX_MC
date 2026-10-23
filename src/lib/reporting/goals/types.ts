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
/**
 * The rate USD revenue converts to CAD at on the page (TASK-3780): boc, the
 * run's Bank of Canada rate; sage, the fixed Sage rate (GoalSettings.sageUsdCadRate).
 * Truckload tests and every stored figure stay on the Bank of Canada rate.
 */
export type RevenueRateBasis = "boc" | "sage";

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
  /** The lines of this month's Sage invoices (TASK-3144), when the login can read them. */
  shipmentLines: ShipmentLinesDataset;
  forecast: ForecastDatasets;
}

/** The datasets the page needs (references, customers, the invoice lines and the forecast are looked up separately). */
export type SnapshotData = Omit<Datasets, "references" | "customers" | "shipmentLines" | "forecast">;

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
  /**
   * The fixed Sage USD/CAD rate the page can show revenue at (TASK-3780):
   * report_goal_setting.sage_usd_cad_rate, else 1.25. null when that row is
   * set but isn't a usable rate; only a request for the Sage rate fails on it.
   */
  sageUsdCadRate: string | null;
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

// ─── Revenue forecast datasets (TASK-3151) ──────────────────────────────────

/** An open Sage order line expected to ship by month end (queries/forecast-orders.ts). */
export interface ForecastLineRow {
  orderNo: string;
  lineNo: number | null;
  customerCode: string | null;
  customer: string | null;
  po: string | null;
  item: string;
  description: string | null;
  /** The line's expected ship date, else the order's. */
  expected: IsoDate;
  /** Still to ship, in the line's order unit. */
  qty: string;
  unit: string | null;
  /** Per order unit, in the order's currency. */
  unitPrice: string;
  currency: string;
  /** Sage's item category on the line (PLABEL, AMEN…); null when blank or not readable (TASK-3177). */
  category: string | null;
  /** Still to ship on the order's open lines of the same item due after month end or undated (the AO output they need isn't shipped yet). */
  laterQty: string;
}

/** A FileMaker assembly order linked to a due line, or scheduled this month (queries/forecast-assembly-orders.ts). */
export interface ForecastAoRow {
  id: string;
  /** The AO number (nameamo_c), e.g. AO-26279A. */
  ao: string | null;
  status: string | null;
  scheduled: IsoDate | null;
  /** The finished product's Sage item code. */
  item: string | null;
  /** The free-text order list (oelist_c), else the orders linked in FileMaker's order entry. */
  oeList: string | null;
  /** Pieces. */
  qty: string | null;
  /**
   * FileMaker's qtytotal is set but isn't a number (TASK-3791): the AO covers
   * nothing. Only the refresh's read knows it; the run keeps the count
   * (row_counts.forecastAoQtyUnreadable), the stored rows don't.
   */
  qtyUnreadable?: boolean;
  unitsPerBox: string | null;
  /** The bulk batch it packs from, and that batch's status. */
  batch: string | null;
  batchStatus: string | null;
  /** Its order and item match an open Sage order line of any date. */
  openOrder: boolean;
}

/** read: both datasets were read; missing: the login lacks SELECT on these columns (schema.table.column), so neither was. */
export type ForecastAccess = "read" | "missing";

export interface ForecastDatasets {
  access: ForecastAccess;
  missing: string[];
  /** The item category columns the login lacked (none: lines carry their category); null for a run stored before categories (TASK-3177). */
  categoryMissing: string[] | null;
  lines: ForecastLineRow[];
  aos: ForecastAoRow[];
}

// ─── Shipment lines: what shipped (TASK-3144) ───────────────────────────────

/** item: Sage line type 1 (or blank); charge: line type 2, a miscellaneous charge such as freight. */
export type ShipmentLineKind = "item" | "charge";

/** One line of a Sage invoice shipped this month (queries/shipment-lines.ts), as Sage keeps it. */
export interface ShipmentLineRow {
  /** Its invoice's number: the shipments list keys that invoice's row by it ("sage:<invoice>"). */
  invoice: string;
  /** Sage's line number (32, 64, …): the lines' order. */
  lineNo: number | null;
  kind: ShipmentLineKind;
  /** The item's code, or the charge's. */
  code: string | null;
  description: string | null;
  /** Quantity shipped, in `unit`. */
  qty: string;
  unit: string | null;
  /** Per `unit`, in the invoice's currency. */
  unitPrice: string;
  /** Sage's extended amount, in the invoice's currency: the item's quantity × price as invoiced, or the charge. */
  amount: string;
  /** The line's discount, in the invoice's currency. */
  discount: string;
}

/** read: the lines were read; missing: the login lacks SELECT on these columns (schema.table.column), so they weren't. */
export type ShipmentLinesAccess = "read" | "missing";

export interface ShipmentLinesDataset {
  access: ShipmentLinesAccess;
  missing: string[];
  lines: ShipmentLineRow[];
}

/** What a run stored about its invoice lines (report_snap_shipment_line_summary): the page model reads only this. */
export interface ShipmentLinesSummary {
  access: ShipmentLinesAccess;
  missing: string[];
  lines: number;
}
