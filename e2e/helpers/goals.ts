import type { Page, Route } from "@playwright/test";
import { expect } from "@playwright/test";

import type { GoalsPage, RefreshRun } from "../../src/lib/reporting/goals";
import { RUN, goalsPage } from "../../tests/reporting-goals-helpers";

import { waitForHydration } from "../helpers";

// The Goals & Production page model for 2026-10-14 with M1–M7 entered, built
// by the same rules the unit tests check (tests/reporting-goals-helpers.ts), so
// the browser specs and the unit specs can never disagree about the numbers.

export { RUN, goalsPage };

const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

/** Serve GET /api/reporting/goals (a page model, or an error envelope). */
export async function mockGoalsApi(
  page: Page,
  view: GoalsPage | { status: number; code: string; message: string } = goalsPage()
): Promise<void> {
  await page.route("**/api/reporting/goals", (route) => {
    if (route.request().method() !== "GET") return route.fulfill({ status: 405, body: "Method Not Allowed" });
    if ("code" in view) return json(route, view.status, { error: { code: view.code, message: view.message } });
    return json(route, 200, { data: view });
  });
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
