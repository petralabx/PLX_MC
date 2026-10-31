import { expect, test } from "@playwright/test";

import creditNotesJson from "../tests/fixtures/reporting-goals/2026-10-14/credit-notes.json";
import { formatAmount, formatDollars } from "../src/lib/reporting/goals/money";
import type { CreditNotesDataset } from "../src/lib/reporting/goals/types";
import { DATASETS, ENTRIES, FORECAST, SHIPMENT_LINES_SUMMARY, goalsPage } from "../tests/reporting-goals-helpers";
import { gotoGoals, mockGoalsApi } from "./helpers/goals";

// Returns (TASK-3987): Sage credit notes dated this month come off the
// Revenue card's headline. How it adds up (TASK-4373) shows them as the
// "− Returns, N credit notes" row, to the cent.

const CREDIT_NOTES = creditNotesJson as unknown as CreditNotesDataset;
const pageWith = (creditNotes: CreditNotesDataset) =>
  goalsPage({}, ENTRIES, FORECAST, SHIPMENT_LINES_SUMMARY, "boc", { ...DATASETS, creditNotes });
const headline = (page: import("@playwright/test").Page) => page.getByTestId("goals-card-revenue").locator(".gp-big .v");
const exact = (c: number) => `$${formatAmount(c)}`;

test.describe("goals returns", () => {
  test("deducts credit notes from the headline and shows the returns line", async ({ page }) => {
    const view = pageWith(CREDIT_NOTES);
    await mockGoalsApi(page, view);
    await gotoGoals(page);
    await expect(headline(page)).toHaveText(formatDollars(view.revenueGoal!.goalCadCents));
    const line = page.getByTestId("goals-revenue-returns");
    await expect(line).toContainText("Returns");
    await expect(line).toContainText("3 credit notes");
    await expect(line).toContainText(exact(view.revenueGoal!.returnsCadCents));
    await page.getByTestId("goals-revenue-breakdown").screenshot({ path: "test-results/goals-returns.png" });
  });

  test("scope=mfg leaves Exclusive Distribution's returns out", async ({ page }) => {
    const view = pageWith(CREDIT_NOTES);
    await mockGoalsApi(page, view);
    await page.goto("/?screen=goals&scope=mfg");
    await expect(headline(page)).toHaveText(formatDollars(view.revenueScope!.goalCadCents));
    await expect(page.getByTestId("goals-revenue-returns")).toContainText("2 credit notes");
    await expect(page.getByTestId("goals-revenue-returns")).toContainText(exact(view.revenueScope!.returnsCadCents));
  });

  test("says returns aren't deducted when credit notes can't be read", async ({ page }) => {
    await mockGoalsApi(page, pageWith({ access: "missing", missing: ["sage.oe_crdh"], notes: [] }));
    await gotoGoals(page);
    await expect(page.getByTestId("goals-revenue-returns")).toContainText("Returns not deducted");
  });

  test("shows no returns line for a run stored before credit notes", async ({ page }) => {
    await mockGoalsApi(page);
    await gotoGoals(page);
    await expect(page.getByTestId("goals-revenue-returns")).toHaveCount(0);
  });
});
