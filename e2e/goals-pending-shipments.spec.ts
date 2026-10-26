import { expect, test } from "@playwright/test";

import pendingJson from "../tests/fixtures/reporting-goals/2026-10-14/pending-shipments.json";
import { formatDollars } from "../src/lib/reporting/goals/money";
import type { PendingShipmentsDataset } from "../src/lib/reporting/goals/types";
import { DATASETS, ENTRIES, FORECAST, SHIPMENT_LINES_SUMMARY, goalsPage } from "../tests/reporting-goals-helpers";
import { gotoGoals, mockGoalsApi } from "./helpers/goals";

// INTERIM (TASK-3992): posted Sage shipments not yet invoiced are added to the
// Revenue card as an estimate, with a "$A invoiced + $B shipped, not yet
// invoiced (estimate)" side line.

const PENDING = pendingJson as unknown as PendingShipmentsDataset;
const pageWith = (pendingShipments: PendingShipmentsDataset) =>
  goalsPage({}, ENTRIES, FORECAST, SHIPMENT_LINES_SUMMARY, "boc", { ...DATASETS, pendingShipments });
const headline = (page: import("@playwright/test").Page) => page.getByTestId("goals-card-revenue").locator(".gp-big .v");

test.describe("goals shipped, not yet invoiced", () => {
  test("adds the estimate to the headline and shows the side line", async ({ page }) => {
    const view = pageWith(PENDING);
    const goal = view.revenueGoal!;
    await mockGoalsApi(page, view);
    await gotoGoals(page);
    await expect(headline(page)).toHaveText(formatDollars(goal.goalCadCents));
    const line = page.getByTestId("goals-revenue-pending");
    await expect(line).toContainText(`${formatDollars(goal.invoicedProductCadCents)} invoiced`);
    await expect(line).toContainText(`+ ${formatDollars(goal.pendingCadCents)} shipped, not yet invoiced (estimate, 3 shipments)`);
    await page.getByTestId("goals-card-revenue").screenshot({ path: "test-results/goals-pending.png" });
  });

  test("scope=mfg leaves Exclusive Distribution's shipments out", async ({ page }) => {
    const view = pageWith(PENDING);
    await mockGoalsApi(page, view);
    await page.goto("/?screen=goals&scope=mfg");
    await expect(headline(page)).toHaveText(formatDollars(view.revenueScope!.goalCadCents));
    await expect(page.getByTestId("goals-revenue-pending")).toContainText("(estimate, 2 shipments)");
  });

  test("says not included when the shipments can't be read", async ({ page }) => {
    await mockGoalsApi(page, pageWith({ access: "missing", missing: ["sage.oe_shipment_header.shidate"], shipments: [] }));
    await gotoGoals(page);
    await expect(page.getByTestId("goals-revenue-pending")).toHaveText("Shipped, not invoiced: not included (needs access)");
  });

  test("shows no line for a run without them", async ({ page }) => {
    await mockGoalsApi(page);
    await gotoGoals(page);
    await expect(page.getByTestId("goals-revenue-pending")).toHaveCount(0);
  });
});
