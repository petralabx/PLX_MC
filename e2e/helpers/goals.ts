import type { Page, Route } from "@playwright/test";
import { expect } from "@playwright/test";

import type { GoalsPage, RefreshRun, ShipmentLinesDataset } from "../../src/lib/reporting/goals";
import { ENTRIES, FORECAST, RUN, SHIPMENT_LINES, SHIPMENT_LINES_SUMMARY, goalsPage } from "../../tests/reporting-goals-helpers";

import { waitForHydration } from "../helpers";

// The Goals & Production page model for 2026-10-14 with M1–M7 entered, built
// by the same rules the unit tests check (tests/reporting-goals-helpers.ts), so
// the browser specs and the unit specs can never disagree about the numbers.

export { RUN, SHIPMENT_LINES, goalsPage };

/** The same page model at the Sage rate (`?fx=sage`, TASK-3780). */
export const sageGoalsPage = (): GoalsPage => goalsPage({}, ENTRIES, FORECAST, SHIPMENT_LINES_SUMMARY, "sage");

const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

type ErrorEnvelope = { status: number; code: string; message: string };

/**
 * Serve GET /api/reporting/goals (a page model, or an error envelope) and, at
 * the Sage rate, GET /api/reporting/goals?fx=sage (TASK-3780; the fixture at
 * 1.25 by default), and each run's invoice lines from GET
 * …/runs/[id]/shipment-lines (TASK-3144; the fixture's by default). Says how
 * many times the lines were fetched.
 */
export async function mockGoalsApi(
  page: Page,
  view: GoalsPage | ErrorEnvelope = goalsPage(),
  lines: ShipmentLinesDataset | ErrorEnvelope = { access: "read", missing: [], lines: SHIPMENT_LINES },
  sage: GoalsPage | ErrorEnvelope = sageGoalsPage()
): Promise<{ linesFetched: () => number }> {
  for (const [pattern, served] of [
    ["**/api/reporting/goals", view],
    ["**/api/reporting/goals?fx=sage", sage],
  ] as const) {
    await page.route(pattern, (route) => {
      if (route.request().method() !== "GET") return route.fulfill({ status: 405, body: "Method Not Allowed" });
      if ("code" in served) return json(route, served.status, { error: { code: served.code, message: served.message } });
      return json(route, 200, { data: served });
    });
  }
  let fetched = 0;
  await page.route("**/api/reporting/goals/runs/*/shipment-lines", (route) => {
    fetched += 1;
    if ("code" in lines) return json(route, lines.status, { error: { code: lines.code, message: lines.message } });
    return json(route, 200, { data: lines });
  });
  return { linesFetched: () => fetched };
}

/** A run as the refresh and run endpoints return it. */
export function runAt(over: Partial<RefreshRun>): RefreshRun {
  return { ...RUN, ...over };
}

/** Open a Goals section. `name` is the tab's accessible name, e.g. "Revenue: Shipments". */
export async function openGoalsTab(page: Page, name: string): Promise<void> {
  const tab = page.getByRole("tab", { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) });
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
}

export async function gotoGoals(page: Page, tab?: string): Promise<void> {
  await page.goto("/?screen=goals");
  await waitForHydration(page);
  await expect(page.locator("[data-testid='goals-screen']")).toBeVisible();
  if (tab) await openGoalsTab(page, tab);
}
