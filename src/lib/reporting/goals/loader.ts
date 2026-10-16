// Loads the page model: the latest successful snapshot, the live manual entries
// and the references they match, then hands them to the pure view builder. The
// export also gets that snapshot's invoices and truckload shipments.

import { databaseConfigured, reportingDatabaseConfigured } from "@/lib/secrets";

import { previousMonthStart } from "./calendar";
import { loadForecast } from "./forecast-store";
import { normalizeRef } from "./rules";
import { latestRuns, listEntries, loadConfig, loadRates, loadReferenceMatches, loadSnapshot } from "./store";
import type { FxRate, ShipmentRow, SnapshotData, TruckloadRow } from "./types";
import { buildGoalsView, type GoalsView } from "./view";

const EMPTY_SETTINGS = {
  largeBatchesPerWorkingDay: 0,
  largeBatchMinKg: 0,
  fullTruckloadMinUsdCents: 0,
  revenueTargetCadCents: 0,
  fullTruckloadsPerMonth: null,
};

export async function loadGoalsView(): Promise<GoalsView> {
  return (await loadGoals()).view;
}

/** The page model plus what the workbook adds, from the same run: its Sage invoices, truckload shipments and the stored rates. */
export interface GoalsExportData {
  view: GoalsView;
  shipments: ShipmentRow[];
  truckloads: TruckloadRow[];
  rates: FxRate[];
}

export async function loadGoalsExport(): Promise<GoalsExportData> {
  const { view, snapshot, rates } = await loadGoals();
  return { view, shipments: snapshot?.shipments ?? [], truckloads: snapshot?.truckloads ?? [], rates };
}

async function loadGoals(): Promise<{ view: GoalsView; snapshot: SnapshotData | null; rates: FxRate[] }> {
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
  const snapshot = await loadSnapshot(succeeded);
  const entries = await listEntries();
  const rates = await loadRates(previousMonthStart(succeeded.today), succeeded.today);
  const refs = await loadReferenceMatches(
    succeeded.id,
    entries.map((e) => normalizeRef(e.reference))
  );
  const forecast = await loadForecast(succeeded);
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
  });
  return { view, snapshot, rates };
}
