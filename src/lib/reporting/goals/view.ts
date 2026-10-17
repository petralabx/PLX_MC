// The Goals & Production page model: the latest good snapshot combined with the
// live manual entries (rules.computeGoals), plus the run it came from and the
// query behind each section, so every figure can name its query and run. Pure.

import { buildForecast, type ForecastSnapshot, type ForecastView } from "./forecast";
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
  daily: [DATASET_QUERIES.daily, DATASET_QUERIES.batches],
  entries: [DATASET_QUERIES.references, DATASET_QUERIES.batches],
  sizes: [DATASET_QUERIES.batches, DATASET_QUERIES.batchHistory],
  batches: [DATASET_QUERIES.batches],
  shipments: [DATASET_QUERIES.shipments, DATASET_QUERIES.truckloads, DATASET_QUERIES.shipmentLines],
  forecast: [DATASET_QUERIES.revenue, DATASET_QUERIES.forecastOrders, DATASET_QUERIES.forecastAos],
};

export type GoalsViewState = "ready" | "not_configured" | "no_data";

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
  /** Whether the run has its invoices' lines (TASK-3144); the page fetches them on demand. null without a model. */
  shipmentLines: ShipmentLinesView | null;
  /** The goal settings the model was built with (the page's definitions and rules text quote them). */
  settings: GoalSettings | null;
  sections: Record<string, readonly DatasetQuery[]>;
  /** The revenue forecast (TASK-3151); null when the page has no model. */
  forecast: ForecastView | null;
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
      shipmentLines: null,
      settings: null,
      sections: SECTION_QUERIES,
      forecast: null,
    };
  }
  const model = computeGoals({
    today: run.today,
    holidays: input.holidays,
    settings: input.settings,
    ftlCustomers: input.ftlCustomers,
    rate: run.fxRate,
    rates: input.rates,
    data: input.snapshot,
    entries: input.entries,
    filemakerRefs: input.filemakerRefs,
    sageRefs: input.sageRefs,
  });
  const fxSource = run.fxSource ?? "boc";
  return {
    state: "ready",
    run,
    latestAttempt,
    fx: { rate: run.fxRate, date: run.fxRateDate, source: fxSource, stale: fxSource === "stored" },
    model,
    shipments: buildShipmentList({
      shipments: input.snapshot.shipments,
      truckloads: input.snapshot.truckloads,
      entries: model.entries,
      rate: run.fxRate,
      rates: input.rates,
      settings: input.settings,
      ftlCustomers: input.ftlCustomers,
    }),
    shipmentLines: shipmentLinesView(input.shipmentLines ?? null),
    settings: input.settings,
    sections: SECTION_QUERIES,
    forecast: buildForecast({ snapshot: input.forecast ?? null, model, settings: input.settings, rate: run.fxRate }),
  };
}
