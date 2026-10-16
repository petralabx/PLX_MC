// The Goals & Production page model: the latest good snapshot combined with the
// live manual entries (rules.computeGoals), plus the run it came from and the
// query behind each section, so every figure can name its query and run. Pure.

import { computeGoals, type GoalsModel } from "./rules";
import { buildShipmentList, type ShipmentListRow } from "./shipment-list";
import type { FtlCustomer, FxRate, FxSource, GoalSettings, IsoDate, ManualEntry, RefreshRun, SnapshotData } from "./types";

/** Dataset query names — the names tooltips show. One per report_snap_* table. */
export const DATASET_QUERIES = {
  cutoffs: "cutoffs",
  goalSummary: "goal-summary",
  daily: "daily",
  truckloads: "truckloads",
  revenue: "revenue-by-currency",
  shipments: "shipments",
  batches: "batches",
  batchHistory: "batch-history",
  references: "references",
  customers: "customers",
} as const;

export type DatasetQuery = (typeof DATASET_QUERIES)[keyof typeof DATASET_QUERIES];

/** Which queries each page section is built from (manual entries are live, not snapshotted). */
export const SECTION_QUERIES: Record<string, readonly DatasetQuery[]> = {
  freshness: [DATASET_QUERIES.cutoffs],
  largeBatches: [DATASET_QUERIES.goalSummary, DATASET_QUERIES.batches],
  truckloads: [DATASET_QUERIES.truckloads],
  revenue: [DATASET_QUERIES.revenue],
  daily: [DATASET_QUERIES.daily],
  entries: [DATASET_QUERIES.references, DATASET_QUERIES.batches],
  sizes: [DATASET_QUERIES.batches, DATASET_QUERIES.batchHistory],
  batches: [DATASET_QUERIES.batches],
  shipments: [DATASET_QUERIES.shipments, DATASET_QUERIES.truckloads],
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
  /** The goal settings the model was built with (the page's definitions and rules text quote them). */
  settings: GoalSettings | null;
  sections: Record<string, readonly DatasetQuery[]>;
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
      settings: null,
      sections: SECTION_QUERIES,
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
    settings: input.settings,
    sections: SECTION_QUERIES,
  };
}
