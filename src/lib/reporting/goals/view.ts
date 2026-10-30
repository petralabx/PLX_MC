// The Goals & Production page model: the latest good snapshot combined with the
// live manual entries (rules.computeGoals), plus the run it came from and the
// query behind each section, so every figure can name its query and run. Pure.
// USD revenue converts at the run's Bank of Canada rate, or at the fixed Sage
// rate when the page asks for it (TASK-3780); truckloads stay on the Bank of Canada rate.
// Narrowed to some salespeople's customers (TASK-4277), it is built again from
// the run filterRunBySalespeople keeps, so every figure follows by the same rules.

import { applyServiceCharges, pendingProductsOf, revenueByBusinessLine, type BusinessLineScope, type RevenueByBusinessLine } from "./business-line";
import { customerRevenue, type CustomerRevenue } from "./customer-revenue";
import { buildForecast, type CustomerClass, type ForecastSnapshot, type ForecastView } from "./forecast";
import { prorateCents } from "./money";
import { countedManualShipmentRefs, pendingShipmentsByClass, pendingShipmentsNotEnteredByHand } from "./pending-shipments";
import { revenueByClass, type RevenueByClass } from "./revenue-by-class";
import { revenueScope, type RevenueScopePace, type RevenueScopeView } from "./revenue-scope";
import { computeGoals, salespeopleTakeaway, type GoalsModel } from "./rules";
import {
  canonicalSales,
  filterRunBySalespeople,
  NO_SALESPERSON,
  runCustomerCodes,
  salespeopleLabel,
  salespeopleScope,
  type SalespeopleRun,
  type SalespersonLookup,
} from "./salesperson-filter";
import { buildShipmentList, type ShipmentListRow } from "./shipment-list";
import { shipmentLinesView, type ShipmentLinesView } from "./shipment-lines";
import type {
  FtlCustomer,
  FxRate,
  FxSource,
  GoalSettings,
  IsoDate,
  ManualEntry,
  RefreshRun,
  RevenueRateBasis,
  CreditNotesAccess,
  ShipmentLineRow,
  ShipmentLinesSummary,
  SnapshotData,
} from "./types";

/** Dataset query names — the names tooltips show. One per report_snap_* table (report_snap_goal_summary is retired). */
export const DATASET_QUERIES = {
  cutoffs: "cutoffs",
  daily: "daily",
  truckloads: "truckloads",
  revenue: "revenue-by-currency",
  shipments: "shipments",
  shipmentLines: "shipment-lines",
  creditNotes: "credit-notes",
  pendingShipments: "pending-shipments",
  batches: "batches",
  batchHistory: "batch-history",
  references: "references",
  customers: "customers",
  forecastOrders: "forecast-orders",
  forecastAos: "forecast-assembly-orders",
} as const;

export type DatasetQuery = (typeof DATASET_QUERIES)[keyof typeof DATASET_QUERIES];

/** Which queries each page section is built from (manual entries are live, not snapshotted). */
export const SECTION_QUERIES: Record<string, readonly DatasetQuery[]> = {
  freshness: [DATASET_QUERIES.cutoffs],
  line1: [DATASET_QUERIES.batches],
  truckloads: [DATASET_QUERIES.truckloads],
  revenue: [DATASET_QUERIES.revenue, DATASET_QUERIES.creditNotes],
  classes: [DATASET_QUERIES.shipments, DATASET_QUERIES.creditNotes],
  daily: [DATASET_QUERIES.daily, DATASET_QUERIES.batches],
  entries: [DATASET_QUERIES.references, DATASET_QUERIES.batches],
  sizes: [DATASET_QUERIES.batches, DATASET_QUERIES.batchHistory],
  batches: [DATASET_QUERIES.batches],
  shipments: [DATASET_QUERIES.shipments, DATASET_QUERIES.truckloads, DATASET_QUERIES.shipmentLines],
  forecast: [DATASET_QUERIES.revenue, DATASET_QUERIES.forecastOrders, DATASET_QUERIES.forecastAos],
  customers: [DATASET_QUERIES.shipments, DATASET_QUERIES.batches, DATASET_QUERIES.forecastOrders, DATASET_QUERIES.forecastAos],
};

export type GoalsViewState = "ready" | "not_configured" | "no_data";

/** A Goals request's `fx` (TASK-3780): absent or boc, the run's Bank of Canada rate; sage, the fixed Sage rate; anything else null (the routes answer 400). */
export function revenueBasisParam(value: string | null): RevenueRateBasis | null {
  if (value === null || value === "boc") return "boc";
  return value === "sage" ? "sage" : null;
}

export interface GoalsView {
  /** not_configured: no reporting database and no stored run; no_data: configured but nothing has refreshed yet. */
  state: GoalsViewState;
  /** The latest successful run — every figure on the page comes from it. */
  run: RefreshRun | null;
  /** The newest run when it is not `run` (running now, or failed after the last good one). */
  latestAttempt: RefreshRun | null;
  fx: { rate: string; date: IsoDate | null; source: FxSource; stale: boolean } | null;
  model: GoalsModel | null;
  /** This month's shipments list (shipment-list.ts), from the same snapshot and entries as the model; empty without one. */
  shipments: ShipmentListRow[];
  /** The Revenue card's month by customer class (TASK-3781), from the shipments list; null without a model. */
  revenueByClass: RevenueByClass | null;
  /** The Revenue card's month for manufacturing customers (every class but Exclusive Distribution), read from revenueByClass; the card's headline, status and pace at `scope=mfg`. */
  revenueScope: RevenueScopeView | null;
  /** The Revenue card's month for every customer, freight and other charges left out (TASK-3952): the card's headline, status and pace at `scope=all`. */
  revenueGoal: RevenueScopeView | null;
  /**
   * The headline split into Manufacturing, Distribution and Services. null
   * without a model. `pending` on each scope is the shipped-not-invoiced
   * estimate. The headline includes that estimate. A stored shipment total
   * has no item lines, so it sits in Distribution; item amounts use the
   * finished-good and 3PL rules. The three lines add to the headline.
   */
  revenueByBusinessLine: RevenueByBusinessLine | null;
  /**
   * Whether the run read this month's credit notes (TASK-3987), which the
   * Revenue card subtracts: read (notes: how many), or missing (the columns the
   * login lacked, so returns aren't deducted). null without a model, or for a
   * run stored before migration 051.
   */
  creditNotes: { access: CreditNotesAccess; missing: string[]; notes: number } | null;
  /**
   * INTERIM (TASK-3992): whether the run read Sage's posted shipments not yet
   * invoiced, which the Revenue card adds as an estimate. null without a model,
   * for a run before migration 052, or with GOALS_PENDING_SHIPMENTS=off.
   */
  pendingShipments: {
    access: "read" | "missing";
    missing: string[];
    shipments: number;
    otherCurrencies: { currency: string; shipments: number; cents: number }[];
  } | null;
  /** Whether the run has its invoices' lines (TASK-3144); the page fetches them on demand. null without a model. */
  shipmentLines: ShipmentLinesView | null;
  /** The goal settings the model was built with (the page's definitions and rules text quote them). */
  settings: GoalSettings | null;
  sections: Record<string, readonly DatasetQuery[]>;
  /** The revenue forecast (TASK-3151); null when the page has no model. */
  forecast: ForecastView | null;
  /** Potential and realized revenue by customer (customer-revenue.ts); null without a model. */
  customerRevenue: CustomerRevenue | null;
  /** The salesperson filter (TASK-4277); null without a model, or when the loader didn't look salespeople up. */
  salespeople: SalespeopleView | null;
}

/** One salesperson the page can be narrowed to (TASK-4277). */
export interface SalespersonOption {
  code: string;
  /** Sage's name for the code; null when it has none. */
  name: string | null;
  /** This run's customers with this salesperson on their Sage record. */
  customers: number;
}

/** The salesperson filter (TASK-4277): who the page can be narrowed to, and whether it is. */
export interface SalespeopleView {
  /** ready: this run's customers' salespeople were read. waiting_for_access: the login lacks `missing`. unavailable: the replica couldn't be read. */
  state: SalespersonLookup["state"];
  missing: string[];
  /** The salespeople on this run's customers, by name then code, and any asked for that aren't on them. */
  options: SalespersonOption[];
  /** This run's customers with no salesperson on their Sage record, or not in Sage: what `none` picks, with the hand entries that name no Sage customer. */
  unassigned: number;
  /** This run's customers with more than one salesperson: each counts in full under every one of them. */
  shared: number;
  /** The codes asked for (`sales`), sorted, `none` last; empty: every customer. */
  selected: string[];
  /** `selected` in words, e.g. "Glenn (GGC) and Sam (SM)"; "" when empty. */
  label: string;
  /** Whether the figures follow `selected`: false when nothing is picked, or when the salespeople couldn't be read (the figures are every customer's). */
  applied: boolean;
  /** Every customer's Revenue headlines (all, and manufacturing customers) and invoiced total, which the narrowed ones are set against; null unless applied. */
  everyCustomer: { revenueGoalCadCents: number | null; revenueScopeGoalCadCents: number | null; revenueTotalCents: number } | null;
}

/** What the signed-in viewer may do on the page (from the Entra app roles). */
export interface GoalsViewer {
  editor: boolean;
}

/** GET /api/reporting/goals: the page model plus the viewer's permissions. */
export type GoalsPage = GoalsView & { viewer: GoalsViewer };

export interface GoalsViewInput {
  configured: boolean;
  run: RefreshRun | null;
  latestRun: RefreshRun | null;
  snapshot: SnapshotData | null;
  entries: readonly ManualEntry[];
  filemakerRefs: ReadonlySet<string>;
  sageRefs: ReadonlySet<string>;
  settings: GoalSettings;
  ftlCustomers: readonly FtlCustomer[];
  holidays: ReadonlySet<IsoDate>;
  rates: readonly FxRate[];
  /** The run's forecast and hit-rate history; null or absent when the run predates the forecast. */
  forecast?: ForecastSnapshot | null;
  /** The run's stored summary of its invoice lines; null or absent when the run predates them. */
  shipmentLines?: ShipmentLinesSummary | null;
  /** Those lines, when the loader has them. The page model keeps only the split. */
  shipmentLineRows?: readonly ShipmentLineRow[] | null;
  /** Finished-good codes read from the MRP. null: not read. An empty set was read. */
  finishedGoodCodes?: ReadonlySet<string> | null;
  /** The rate USD revenue converts at (TASK-3780); absent, the run's Bank of Canada rate. */
  revenueBasis?: RevenueRateBasis;
  /** The salesperson filter (TASK-4277): the live lookup of this run's customers and the codes asked for; absent, the page has none. */
  salespeople?: { lookup: SalespersonLookup; selected: readonly string[] } | null;
}

/**
 * 3PL miscellaneous charges are already inside the figure from
 * applyServiceCharges. That rebuild drops the shipped-not-invoiced estimate,
 * so this adds it back. A stored shipment total has no item lines and counts
 * as Distribution; the three lines then add to this headline to the cent.
 */
function headlineAfterServiceCharges(
  scope: RevenueScopeView,
  line: BusinessLineScope,
  targetCents: number,
  pace: RevenueScopePace,
): RevenueScopeView {
  const moved = applyServiceCharges(scope, line, targetCents, pace);
  const goalCadCents = moved.goalCadCents + moved.pendingCadCents;
  return {
    ...moved,
    invoicedProductCadCents: moved.totalCadCents - moved.chargesCadCents,
    goalCadCents,
    progress: targetCents > 0 ? goalCadCents / targetCents : null,
    status: goalCadCents >= pace.dueSoFarCents ? "on_track" : "behind",
    neededPerDayCents:
      pace.remaining > 0 ? prorateCents(Math.max(0, targetCents - goalCadCents), 1, pace.remaining) : 0,
  };
}

export function buildGoalsView(input: GoalsViewInput): GoalsView {
  return buildGoalsViewAndRun(input).view;
}

/**
 * The page model and the run it was built from: narrowed to the picked
 * salespeople's customers when the filter applies (TASK-4277), which is what
 * the workbook's rows must come from.
 */
export function buildGoalsViewAndRun(input: GoalsViewInput): { view: GoalsView; run: GoalsViewInput } {
  const whole = buildView(input);
  const sales = input.salespeople;
  if (!sales || !whole.model) return { view: { ...whole, salespeople: null }, run: input };
  const filter = salespeopleView(input, sales.lookup, canonicalSales(sales.selected));
  if (filter.selected.length === 0 || sales.lookup.state !== "ready") return { view: { ...whole, salespeople: filter }, run: input };
  const run = filterRunBySalespeople(input, salespeopleScope(sales.lookup, filter.selected));
  const view = buildView(run, {
    revenueCoveredThrough: whole.model.coveredThrough.revenue,
    // A Sage shipment a hand entry stands for stays out of the estimate whoever the entry was typed for, so the pages add up to the whole.
    countedRefs: countedManualShipmentRefs(whole.model.entries),
  });
  if (view.model) view.model.takeaway = salespeopleTakeaway(view.model, `For ${filter.label}`, whole.model.revenue.totalCents);
  const everyCustomer = {
    revenueGoalCadCents: whole.revenueGoal?.goalCadCents ?? null,
    revenueScopeGoalCadCents: whole.revenueScope?.goalCadCents ?? null,
    revenueTotalCents: whole.model.revenue.totalCents,
  };
  return { view: { ...view, salespeople: { ...filter, applied: true, everyCustomer } }, run };
}

/** Who the page can be narrowed to: this run's customers' salespeople, with how many of its customers each has. */
function salespeopleView(run: SalespeopleRun, lookup: SalespersonLookup, selected: string[]): SalespeopleView {
  const names = lookup.state === "ready" ? lookup.names : {};
  const counts = new Map<string, number>();
  let unassigned = 0;
  let shared = 0;
  if (lookup.state === "ready") {
    for (const code of runCustomerCodes(run)) {
      const own = lookup.customers[code] ?? [];
      if (own.length === 0) unassigned += 1;
      if (own.length > 1) shared += 1;
      for (const s of own) counts.set(s, (counts.get(s) ?? 0) + 1);
    }
  }
  for (const code of selected) if (code !== NO_SALESPERSON && !counts.has(code)) counts.set(code, 0);
  const options = [...counts]
    .map(([code, customers]) => ({ code, name: names[code] ?? null, customers }))
    .sort((a, b) => (a.name ?? a.code).localeCompare(b.name ?? b.code, "en", { sensitivity: "base" }) || (a.code < b.code ? -1 : 1));
  return {
    state: lookup.state,
    missing: lookup.state === "waiting_for_access" ? lookup.missing : [],
    options,
    unassigned,
    shared,
    selected,
    label: salespeopleLabel(selected, names),
    applied: false,
    everyCustomer: null,
  };
}

/**
 * The page model from `input`. `narrowed` (TASK-4277): a page narrowed to some
 * salespeople's customers keeps the whole page's revenue covered-through date
 * and counted hand shipments, and leaves last month's revenue out.
 */
function buildView(
  input: GoalsViewInput,
  narrowed?: { revenueCoveredThrough: IsoDate; countedRefs: ReadonlySet<string> }
): Omit<GoalsView, "salespeople"> {
  const { run, latestRun } = input;
  const latestAttempt = latestRun && (!run || latestRun.id !== run.id) ? latestRun : null;
  if (!run || !input.snapshot || !run.fxRate) {
    return {
      state: input.configured ? "no_data" : "not_configured",
      run: null,
      latestAttempt,
      fx: null,
      model: null,
      shipments: [],
      revenueByClass: null,
      revenueScope: null,
      revenueGoal: null,
      revenueByBusinessLine: null,
      creditNotes: null,
    pendingShipments: null,
      shipmentLines: null,
      settings: null,
      sections: SECTION_QUERIES,
      forecast: null,
      customerRevenue: null,
    };
  }
  const basis = input.revenueBasis ?? "boc";
  const revenueRate = basis === "sage" ? input.settings.sageUsdCadRate : run.fxRate;
  // The loader refuses a Sage-rate read without a usable rate; this guards direct callers.
  if (!revenueRate) throw new RangeError("report_goal_setting.sage_usd_cad_rate is not a usable USD/CAD rate");
  const model = computeGoals({
    today: run.today,
    holidays: input.holidays,
    settings: input.settings,
    ftlCustomers: input.ftlCustomers,
    rate: run.fxRate,
    revenueRate,
    revenueBasis: basis,
    rates: input.rates,
    data: input.snapshot,
    entries: input.entries,
    filemakerRefs: input.filemakerRefs,
    sageRefs: input.sageRefs,
    ...(narrowed ? { revenueCoveredThrough: narrowed.revenueCoveredThrough, lastMonthRevenue: false } : {}),
  });
  const fxSource = run.fxSource ?? "boc";
  const shipments = buildShipmentList({
    shipments: input.snapshot.shipments,
    truckloads: input.snapshot.truckloads,
    entries: model.entries,
    rate: model.revenue.rate,
    truckloadRate: model.truckloads.rate,
    rates: input.rates,
    settings: input.settings,
    ftlCustomers: input.ftlCustomers,
  });
  const notes = input.snapshot.creditNotes ?? null;
  const byClass = revenueByClass(shipments, model, input.ftlCustomers, notes?.access === "read" ? notes.notes : []);
  const pace = { dueSoFarCents: model.revenue.dueSoFarCents, remaining: model.calendar.remaining };
  // INTERIM (TASK-3992): shipped, not yet invoiced, added to the card as an estimate.
  const pendingData = input.snapshot.pendingShipments ?? null;
  const countedRefs = narrowed?.countedRefs ?? countedManualShipmentRefs(model.entries);
  const pendingRows =
    pendingData?.access === "read"
      ? pendingShipmentsNotEnteredByHand(pendingData.shipments, countedRefs)
      : [];
  const pending = pendingData?.access === "read" ? pendingShipmentsByClass(pendingRows, model.revenue.rate) : null;
  const invoicedByClass = Object.fromEntries(byClass.rows.map((r) => [r.customerClass, r.totalCadCents])) as Record<CustomerClass, number>;
  const forecast = buildForecast({
    snapshot: input.forecast ?? null,
    model,
    settings: input.settings,
    rate: model.revenue.rate,
    invoicedByClass,
    invoicedByClassMatchesCard: byClass.matchesCard,
    aoQtyUnreadable: run.rowCounts.forecastAoQtyUnreadable ?? null,
  });
  const businessLine = revenueByBusinessLine({
    shipments,
    lines: input.shipmentLineRows ?? null,
    linesSummary: input.shipmentLines ?? null,
    finishedGoodCodes: input.finishedGoodCodes ?? null,
    creditNotes: notes?.access === "read" ? notes.notes : [],
    ftlCustomers: input.ftlCustomers,
    rate: model.revenue.rate,
    byClass,
    // Same hand-entry skip as the headline. No item lines: Distribution.
    pending: pendingProductsOf(input.snapshot, countedRefs),
  });
  const mfgScope = revenueScope(byClass, "mfg", model.revenue.targetCents, pace, pending);
  const allScope = revenueScope(byClass, "all", model.revenue.targetCents, pace, pending);
  // 3PL miscellaneous charges move into the headline only once the lines are readable.
  const linesReady = businessLine.state === "ready";
  return {
    state: "ready",
    run,
    latestAttempt,
    fx: { rate: run.fxRate, date: run.fxRateDate, source: fxSource, stale: fxSource === "stored" },
    model,
    shipments,
    revenueByClass: byClass,
    revenueScope: linesReady ? headlineAfterServiceCharges(mfgScope, businessLine.mfg, model.revenue.targetCents, pace) : mfgScope,
    revenueGoal: linesReady ? headlineAfterServiceCharges(allScope, businessLine.all, model.revenue.targetCents, pace) : allScope,
    revenueByBusinessLine: businessLine,
    pendingShipments: pendingData
      ? { access: pendingData.access, missing: pendingData.missing, shipments: pendingData.shipments.length, otherCurrencies: pending?.otherCurrencies ?? [] }
      : null,
    creditNotes: notes ? { access: notes.access, missing: notes.missing, notes: notes.notes.length } : null,
    shipmentLines: shipmentLinesView(input.shipmentLines ?? null),
    settings: input.settings,
    sections: SECTION_QUERIES,
    forecast,
    customerRevenue: customerRevenue({
      today: run.today,
      holidays: input.holidays,
      forecastRows: forecast.state === "ready" ? forecast.rows : [],
      aos: forecast.state === "ready" ? (input.forecast?.data.aos ?? []) : [],
      batches: input.snapshot.batches,
      shipments,
      rate: model.revenue.rate,
      cardTotalCents: model.revenue.totalCents,
    }),
  };
}
