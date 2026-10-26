// The Goals & Production page model: the latest good snapshot combined with the
// live manual entries (rules.computeGoals), plus the run it came from and the
// query behind each section, so every figure can name its query and run. Pure.
// USD revenue converts at the run's Bank of Canada rate, or at the fixed Sage
// rate when the page asks for it (TASK-3780); truckloads stay on the Bank of Canada rate.

import { customerRevenue, type CustomerRevenue } from "./customer-revenue";
import { buildForecast, type CustomerClass, type ForecastSnapshot, type ForecastView } from "./forecast";
import { revenueByClass, type RevenueByClass } from "./revenue-by-class";
import { revenueScope, type RevenueScopeView } from "./revenue-scope";
import { computeGoals, type GoalsModel } from "./rules";
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
  revenue: [DATASET_QUERIES.revenue],
  classes: [DATASET_QUERIES.shipments],
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
  /** Whether the run has its invoices' lines (TASK-3144); the page fetches them on demand. null without a model. */
  shipmentLines: ShipmentLinesView | null;
  /** The goal settings the model was built with (the page's definitions and rules text quote them). */
  settings: GoalSettings | null;
  sections: Record<string, readonly DatasetQuery[]>;
  /** The revenue forecast (TASK-3151); null when the page has no model. */
  forecast: ForecastView | null;
  /** Potential and realized revenue by customer (customer-revenue.ts); null without a model. */
  customerRevenue: CustomerRevenue | null;
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
  /** The rate USD revenue converts at (TASK-3780); absent, the run's Bank of Canada rate. */
  revenueBasis?: RevenueRateBasis;
}

export function buildGoalsView(input: GoalsViewInput): GoalsView {
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
  const byClass = revenueByClass(shipments, model, input.ftlCustomers);
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
  return {
    state: "ready",
    run,
    latestAttempt,
    fx: { rate: run.fxRate, date: run.fxRateDate, source: fxSource, stale: fxSource === "stored" },
    model,
    shipments,
    revenueByClass: byClass,
    revenueScope: revenueScope(byClass, "mfg", model.revenue.targetCents, {
      dueSoFarCents: model.revenue.dueSoFarCents,
      remaining: model.calendar.remaining,
    }),
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
