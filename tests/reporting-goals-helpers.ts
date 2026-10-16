// Shared fixtures for the Goals & Production tests (2026-10-14, USD/CAD 1.4219).
// Not a test file (no .test.ts): vitest only collects tests/**/*.test.ts.

import { ontarioStatutoryHolidays } from "@/lib/reporting/goals/calendar";
import { normalizeRef, type GoalsInput } from "@/lib/reporting/goals/rules";
import type { Datasets, FtlCustomer, GoalSettings, ManualEntry, RefreshRun } from "@/lib/reporting/goals/types";
import { buildGoalsView, type GoalsPage } from "@/lib/reporting/goals/view";

import datasetsJson from "./fixtures/reporting-goals/2026-10-14/datasets.json";
import entriesJson from "./fixtures/reporting-goals/2026-10-14/entries.json";
import expectedJson from "./fixtures/reporting-goals/2026-10-14/expected.json";

export const TODAY = "2026-10-14";
export const RATE = "1.4219";

export const DATASETS = datasetsJson as unknown as Datasets & { today: string };
export const EXPECTED = expectedJson;

/** The goal settings migrations 039 and 042 seed (042's Line 1 settings replaced the large-batch ones). */
export const SETTINGS: GoalSettings = {
  line1KgPerWorkingDay: 20_000,
  line1MinKg: 5_000,
  fullTruckloadMinUsdCents: 1_800_000,
  revenueTargetCadCents: 100_000_000,
  fullTruckloadsPerMonth: null,
};

/** The truckload customers migration 039 seeds. */
export const FTL_CUSTOMERS: FtlCustomer[] = [
  { code: "A1TEXT11", displayName: "A1 American", namePatterns: ["a1 american", "tiger hospitality"], sortOrder: 1 },
  { code: "PETSUP10", displayName: "Pet Supplies Plus", namePatterns: ["pet supplies plus"], sortOrder: 2 },
  { code: "DIVE11", displayName: "Diversified Hospitality", namePatterns: ["diversified"], sortOrder: 3 },
  { code: "1SHOP11", displayName: "1-Shoppe", namePatterns: ["1-shoppe", "1 shoppe"], sortOrder: 4 },
  { code: "SOAP11", displayName: "Soapbox", namePatterns: ["soapbox", "soap box"], sortOrder: 5 },
];

export const HOLIDAYS = new Set(
  [2026, 2027, 2028].flatMap((year) => ontarioStatutoryHolidays(year).map((h) => h.day))
);

type EntryFixture = Partial<ManualEntry> & { entryId: string; type: string };

export function manualEntry(fields: EntryFixture): ManualEntry {
  return {
    date: null,
    reference: null,
    customer: null,
    customerCode: null,
    product: null,
    kg: null,
    productValue: null,
    freight: null,
    currency: null,
    note: null,
    enteredBy: "vince@petrasoap.com",
    enteredAt: "2026-10-14T13:00:00.000Z",
    updatedBy: "vince@petrasoap.com",
    updatedAt: "2026-10-14T13:00:00.000Z",
    source: "ui",
    ...fields,
  };
}

/** M1–M7 from the brief. */
export const ENTRIES: ManualEntry[] = (entriesJson as EntryFixture[]).map(manualEntry);

export function refsOf(kind: "filemaker" | "sage"): Set<string> {
  return new Set(DATASETS.references.filter((r) => r.kind === kind).map((r) => normalizeRef(r.ref)));
}

/** The 06:00 refresh that produced the fixture (run #41, at the prototype's rate). */
export const RUN: RefreshRun = {
  id: 41,
  trigger: "cron",
  requestedBy: "cron",
  today: TODAY,
  status: "succeeded",
  step: null,
  startedAt: "2026-10-14T10:00:02.000Z",
  finishedAt: "2026-10-14T10:00:31.000Z",
  error: null,
  productionCutoff: TODAY,
  sageCutoff: TODAY,
  fxRate: "1.421900",
  fxRateDate: "2026-10-13",
  fxSource: "boc",
  rowCounts: {},
};

/** What GET /api/reporting/goals returns for the fixture with M1–M7 entered (the page tests use it). */
export function goalsPage(overrides: Partial<GoalsPage> = {}, entries: ManualEntry[] = ENTRIES): GoalsPage {
  const view = buildGoalsView({
    configured: true,
    run: RUN,
    latestRun: RUN,
    snapshot: DATASETS,
    entries,
    filemakerRefs: refsOf("filemaker"),
    sageRefs: refsOf("sage"),
    settings: SETTINGS,
    ftlCustomers: FTL_CUSTOMERS,
    holidays: HOLIDAYS,
    rates: [{ date: TODAY, rate: RATE }],
  });
  return { ...view, viewer: { editor: true }, ...overrides };
}

export function goalsInput(overrides: Partial<GoalsInput> = {}): GoalsInput {
  return {
    today: TODAY,
    holidays: HOLIDAYS,
    settings: SETTINGS,
    ftlCustomers: FTL_CUSTOMERS,
    rate: RATE,
    rates: [{ date: TODAY, rate: RATE }],
    data: DATASETS,
    entries: [],
    filemakerRefs: refsOf("filemaker"),
    sageRefs: refsOf("sage"),
    ...overrides,
  };
}
