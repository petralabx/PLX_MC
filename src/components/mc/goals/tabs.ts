// Goals report sections (TASK-4094). One tab per section, grouped so related
// sections sit together. The default (Revenue → By class) stays out of the URL,
// so an existing `/?screen=goals` link still opens the report.

export const GOALS_TABS = [
  { id: "classes", group: "Revenue", label: "By class" },
  { id: "shipments", group: "Revenue", label: "Shipments" },
  { id: "customers", group: "Revenue", label: "By customer" },
  { id: "forecast", group: "Revenue", label: "Forecast" },
  { id: "daily", group: "Batches", label: "Day by day" },
  { id: "sizes", group: "Batches", label: "By size" },
  { id: "scheduled", group: "Batches", label: "Scheduled" },
  { id: "batches", group: "Batches", label: "Batch list" },
  { id: "truckloads", group: "Truckloads", label: "By customer" },
  { id: "entries", group: "Entries", label: "By hand" },
  { id: "rules", group: "Rules", label: "Rules" },
] as const;

export type GoalsTab = (typeof GOALS_TABS)[number]["id"];

/** Revenue → By class. Omitted from the URL. */
export const DEFAULT_GOALS_TAB: GoalsTab = "classes";

const GOALS_TAB_IDS: readonly string[] = GOALS_TABS.map((tab) => tab.id);

export function isGoalsTab(value: string | null | undefined): value is GoalsTab {
  return !!value && GOALS_TAB_IDS.includes(value);
}

/** The section a route shows. An unknown or absent value opens the default. */
export function activeGoalsTab(tab: string | undefined): GoalsTab {
  return isGoalsTab(tab) ? tab : DEFAULT_GOALS_TAB;
}

/** Accessible name, unique across groups ("Revenue: By customer"). */
export function goalsTabName(tab: (typeof GOALS_TABS)[number]): string {
  return `${tab.group}: ${tab.label}`;
}
