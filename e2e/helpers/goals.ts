import type { Page, Route } from "@playwright/test";
import { expect } from "@playwright/test";

import type { GoalsPage, RefreshRun, ShipmentLinesDataset } from "../../src/lib/reporting/goals";
import { RUN, SHIPMENT_LINES, goalsPage } from "../../tests/reporting-goals-helpers";

import { waitForHydration } from "../helpers";

// The Goals & Production page model for 2026-10-14 with M1–M7 entered, built
// by the same rules the unit tests check (tests/reporting-goals-helpers.ts), so
// the browser specs and the unit specs can never disagree about the numbers.

export { RUN, SHIPMENT_LINES, goalsPage };

const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

type ErrorEnvelope = { status: number; code: string; message: string };

/**
 * Serve GET /api/reporting/goals (a page model, or an error envelope), and each
 * run's invoice lines from GET …/runs/[id]/shipment-lines (TASK-3144; the
 * fixture's by default). Says how many times the lines were fetched.
 */
export async function mockGoalsApi(
  page: Page,
  view: GoalsPage | ErrorEnvelope = goalsPage(),
  lines: ShipmentLinesDataset | ErrorEnvelope = { access: "read", missing: [], lines: SHIPMENT_LINES }
): Promise<{ linesFetched: () => number }> {
  await page.route("**/api/reporting/goals", (route) => {
    if (route.request().method() !== "GET") return route.fulfill({ status: 405, body: "Method Not Allowed" });
    if ("code" in view) return json(route, view.status, { error: { code: view.code, message: view.message } });
    return json(route, 200, { data: view });
  });
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

export async function gotoGoals(page: Page): Promise<void> {
  await page.goto("/?screen=goals");
  await waitForHydration(page);
  await expect(page.locator("[data-testid='goals-screen']")).toBeVisible();
}
