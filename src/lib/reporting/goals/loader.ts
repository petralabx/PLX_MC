// Loads the page model: the latest successful snapshot, the live manual entries
// and the references they match, then hands them to the pure view builder. The
// export also gets that snapshot's invoices, their lines and truckload shipments.

import { ApiError } from "@/lib/api/route";
import { databaseConfigured, reportingDatabaseConfigured } from "@/lib/secrets";

import { previousMonthStart } from "./calendar";
import { loadForecast } from "./forecast-store";
import { normalizeRef } from "./rules";
import {
  latestRuns,
  listEntries,
  loadConfig,
  loadRates,
  loadReferenceMatches,
  loadShipmentLineSummary,
  loadShipmentLines,
  loadSnapshot,
} from "./store";
import type { CreditNotesDataset, FxRate, RevenueRateBasis, ShipmentLinesDataset, ShipmentRow, SnapshotData, TruckloadRow } from "./types";
import { buildGoalsView, type GoalsView } from "./view";

const EMPTY_SETTINGS = {
  line1KgPerWorkingDay: 0,
  line1MinKg: 0,
  fullTruckloadMinUsdCents: 0,
  revenueTargetCadCents: 0,
  fullTruckloadsPerMonth: null,
  sageUsdCadRate: null,
};

/** The page model with USD revenue at `basis` (TASK-3780): the run's Bank of Canada rate, or the fixed Sage rate. */
export async function loadGoalsView(basis: RevenueRateBasis = "boc"): Promise<GoalsView> {
  return (await loadGoals(basis)).view;
}

/** The page model plus what the workbook adds, from the same run: its Sage invoices and their lines, truckload shipments and the stored rates. */
export interface GoalsExportData {
  view: GoalsView;
  shipments: ShipmentRow[];
  /** The run's invoice lines (TASK-3144); null before the first good refresh, or for a run stored without them. */
  shipmentLines: ShipmentLinesDataset | null;
  truckloads: TruckloadRow[];
  rates: FxRate[];
  /** The run's credit notes (TASK-3987); null for a run stored before them. */
  creditNotes?: CreditNotesDataset | null;
}

export async function loadGoalsExport(basis: RevenueRateBasis = "boc"): Promise<GoalsExportData> {
  const { view, snapshot, rates } = await loadGoals(basis);
  // Only the workbook reads them here; the page fetches them on demand (GET …/runs/[id]/shipment-lines).
  const shipmentLines = view.run ? await loadShipmentLines(view.run.id) : null;
  return {
    view,
    shipments: snapshot?.shipments ?? [],
    shipmentLines,
    truckloads: snapshot?.truckloads ?? [],
    rates,
    creditNotes: snapshot?.creditNotes ?? null,
  };
}

async function loadGoals(basis: RevenueRateBasis): Promise<{ view: GoalsView; snapshot: SnapshotData | null; rates: FxRate[] }> {
  const configured = reportingDatabaseConfigured();
  const empty = {
    configured,
    entries: [],
    filemakerRefs: new Set<string>(),
    sageRefs: new Set<string>(),
    settings: EMPTY_SETTINGS,
    ftlCustomers: [],
    holidays: new Set<string>(),
    rates: [],
  };
  const none = { snapshot: null, rates: [] };
  // Without Mission Control's own database there is nothing stored to show.
  if (!databaseConfigured()) return { ...none, view: buildGoalsView({ ...empty, run: null, latestRun: null, snapshot: null }) };
  const { succeeded, latest } = await latestRuns();
  if (!succeeded) return { ...none, view: buildGoalsView({ ...empty, run: null, latestRun: latest, snapshot: null }) };
  // Sequential on purpose: Mission Control's pool is small (5).
  const config = await loadConfig();
  if (basis === "sage" && !config.settings.sageUsdCadRate) {
    throw new ApiError(
      "config_error",
      "The Sage rate isn’t set up: report_goal_setting.sage_usd_cad_rate must be a positive rate with at most 6 decimals.",
      500
    );
  }
  const snapshot = await loadSnapshot(succeeded);
  const entries = await listEntries();
  const rates = await loadRates(previousMonthStart(succeeded.today), succeeded.today);
  const refs = await loadReferenceMatches(
    succeeded.id,
    entries.map((e) => normalizeRef(e.reference))
  );
  const forecast = await loadForecast(succeeded);
  const shipmentLines = await loadShipmentLineSummary(succeeded.id);
  const view = buildGoalsView({
    configured,
    run: succeeded,
    latestRun: latest,
    snapshot,
    entries,
    filemakerRefs: refs.filemaker,
    sageRefs: refs.sage,
    settings: config.settings,
    ftlCustomers: config.ftlCustomers,
    holidays: config.holidays,
    rates,
    forecast,
    shipmentLines,
    revenueBasis: basis,
  });
  return { view, snapshot, rates };
}
