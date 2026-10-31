import { expect, test } from "@playwright/test";

import pendingJson from "../tests/fixtures/reporting-goals/2026-10-14/pending-shipments.json";
import { formatAmount, formatDollars } from "../src/lib/reporting/goals/money";
import type { PendingShipmentsDataset } from "../src/lib/reporting/goals/types";
import { DATASETS, ENTRIES, FORECAST, SHIPMENT_LINES_SUMMARY, goalsPage } from "../tests/reporting-goals-helpers";
import { gotoGoals, mockGoalsApi } from "./helpers/goals";

// INTERIM (TASK-3992): posted Sage shipments not yet invoiced are added to the
// Revenue card as an estimate. How it adds up (TASK-4373) shows it as the
// "+ Shipped, not yet invoiced (estimate)" row after the invoiced product.

const PENDING = pendingJson as unknown as PendingShipmentsDataset;
const pageWith = (pendingShipments: PendingShipmentsDataset) =>
  goalsPage({}, ENTRIES, FORECAST, SHIPMENT_LINES_SUMMARY, "boc", { ...DATASETS, pendingShipments });
const headline = (page: import("@playwright/test").Page) => page.getByTestId("goals-card-revenue").locator(".gp-big .v");
const exact = (c: number) => `$${formatAmount(c)}`;

test.describe("goals shipped, not yet invoiced", () => {
  test("adds the estimate to the headline and shows the side line", async ({ page }) => {
    const view = pageWith(PENDING);
    const goal = view.revenueGoal!;
    await mockGoalsApi(page, view);
    await gotoGoals(page);
    await expect(headline(page)).toHaveText(formatDollars(goal.goalCadCents));
    const ledger = page.getByTestId("goals-revenue-ledger");
    await expect(ledger.getByRole("row").filter({ hasText: "Invoiced product" })).toContainText(exact(goal.invoicedProductCadCents));
    const line = page.getByTestId("goals-revenue-pending");
    await expect(line).toContainText("Shipped, not yet invoiced");
    await expect(line).toContainText("estimate, 3 shipments");
    await expect(line).toContainText(exact(goal.pendingCadCents));
    await expect(ledger.locator("tfoot")).toContainText(exact(goal.goalCadCents));
    await page.getByTestId("goals-revenue-breakdown").screenshot({ path: "test-results/goals-pending.png" });
  });

  test("scope=mfg leaves Exclusive Distribution's shipments out", async ({ page }) => {
    const view = pageWith(PENDING);
    await mockGoalsApi(page, view);
    await page.goto("/?screen=goals&scope=mfg");
    await expect(headline(page)).toHaveText(formatDollars(view.revenueScope!.goalCadCents));
    await expect(page.getByTestId("goals-revenue-pending")).toContainText("estimate, 2 shipments");
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
