// Loads the page model: the latest successful snapshot, the live manual entries
// and the references they match, then hands them to the pure view builder.

import { databaseConfigured, reportingDatabaseConfigured } from "@/lib/secrets";

import { previousMonthStart } from "./calendar";
import { normalizeRef } from "./rules";
import { latestRuns, listEntries, loadConfig, loadRates, loadReferenceMatches, loadSnapshot } from "./store";
import { buildGoalsView, type GoalsView } from "./view";

const EMPTY_SETTINGS = {
  largeBatchesPerWorkingDay: 0,
  largeBatchMinKg: 0,
  fullTruckloadMinUsdCents: 0,
  revenueTargetCadCents: 0,
  fullTruckloadsPerMonth: null,
};

export async function loadGoalsView(): Promise<GoalsView> {
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
  // Without Mission Control's own database there is nothing stored to show.
  if (!databaseConfigured()) return buildGoalsView({ ...empty, run: null, latestRun: null, snapshot: null });
  const { succeeded, latest } = await latestRuns();
  if (!succeeded) return buildGoalsView({ ...empty, run: null, latestRun: latest, snapshot: null });
  // Sequential on purpose: Mission Control's pool is small (5).
  const config = await loadConfig();
  const snapshot = await loadSnapshot(succeeded);
  const entries = await listEntries();
  const rates = await loadRates(previousMonthStart(succeeded.today), succeeded.today);
  const refs = await loadReferenceMatches(
    succeeded.id,
    entries.map((e) => normalizeRef(e.reference))
  );
  return buildGoalsView({
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
  });
}
