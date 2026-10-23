import { expect, test, type Page } from "@playwright/test";

import { XLSX_CONTENT_TYPE } from "../src/lib/reporting/goals/excel/export";
import { waitForHydration } from "./helpers";
import { goalsPage, gotoGoals, mockGoalsApi } from "./helpers/goals";

// The revenue rate switch on Goals & Production (TASK-3780) and revenue by
// customer class (TASK-3781), against the 2026-10-14 fixture with M1–M7
// entered: today's Bank of Canada rate 1.4219 by default, the fixed Sage rate
// 1.25 on the switch, kept in the URL, followed by the Revenue card, the class
// table and the export.

const rateGroup = (page: Page) => page.getByRole("group", { name: "US dollars at" });
const today = (page: Page) => rateGroup(page).getByRole("button", { name: /^Today’s rate/ });
const sage = (page: Page) => rateGroup(page).getByRole("button", { name: /^Sage rate/ });
const revenueCard = (page: Page) => page.getByTestId("goals-card-revenue");
const classes = (page: Page) => page.getByRole("region", { name: "Revenue by customer class" });

test.describe("goals revenue rate", () => {
  test("opens on today's rate, and the Sage rate moves every revenue figure and the URL", async ({ page }) => {
    await mockGoalsApi(page);
    await gotoGoals(page);
    await expect(today(page)).toHaveAttribute("aria-pressed", "true");
    await expect(today(page)).toContainText("1.4219");
    await expect(sage(page)).toHaveAttribute("aria-pressed", "false");
    await expect(revenueCard(page)).toContainText("= $245,176 at 1.4219 (Bank of Canada, Oct 13)");
    await expect(classes(page).locator("tfoot")).toContainText("408,628.08");
    await expect(classes(page).locator("tbody tr").first().locator("th, td")).toHaveText([
      "Exclusive Manufacturing",
      "2",
      "0.00",
      "57,654.32",
      "81,978.68",
      "36,613.92",
      "118,592.60",
      "29.0%",
    ]);

    await sage(page).click();
    await expect(page).toHaveURL(/[?&]fx=sage\b/);
    await expect(sage(page)).toHaveAttribute("aria-pressed", "true");
    await expect(revenueCard(page)).toContainText("$374,561");
    await expect(revenueCard(page)).toContainText("= $215,536 at 1.25 (Sage rate)");
    await expect(classes(page).locator("tfoot")).toContainText("374,561.16");
    await expect(page.getByTestId("goals-classes").getByText("US dollars at the Sage rate 1.25")).toBeVisible();
    await expect(page.getByTestId("goals-forecast").getByText("Amounts in CAD at the Sage rate 1.25.")).toBeVisible();
    // The full truckload test stays on the Bank of Canada rate.
    await expect(page.getByTestId("goals-card-truckloads")).toContainText("3");

    await page.goBack();
    await expect(today(page)).toHaveAttribute("aria-pressed", "true");
    await expect(revenueCard(page)).toContainText("= $245,176 at 1.4219 (Bank of Canada, Oct 13)");
  });

  test("a link with fx=sage opens at the Sage rate, and the export follows it", async ({ page }) => {
    await mockGoalsApi(page);
    let exported = "";
    await page.route("**/api/reporting/goals/export?fx=sage", async (route) => {
      exported = route.request().url();
      await route.fulfill({
        status: 200,
        headers: {
          "content-type": XLSX_CONTENT_TYPE,
          "content-disposition": 'attachment; filename="PLX goals and production 2026-10-14 (Sage rate).xlsx"',
        },
        body: Buffer.from("xlsx"),
      });
    });
    await page.goto("/?screen=goals&fx=sage");
    await waitForHydration(page);
    await expect(sage(page)).toHaveAttribute("aria-pressed", "true");
    await expect(revenueCard(page)).toContainText("= $215,536 at 1.25 (Sage rate)");
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export to Excel" }).click();
    expect((await downloading).suggestedFilename()).toBe("PLX goals and production 2026-10-14 (Sage rate).xlsx");
    expect(new URL(exported).search).toBe("?fx=sage");
  });

  test("when the Sage rate can't load, it says so and the figures stay at today's rate", async ({ page }) => {
    await mockGoalsApi(page, goalsPage(), undefined, {
      status: 500,
      code: "config_error",
      message: "The Sage rate isn’t set up: report_goal_setting.sage_usd_cad_rate must be a positive rate with at most 6 decimals.",
    });
    await gotoGoals(page);
    await sage(page).click();
    await expect(page.getByTestId("goals-rate-status")).toHaveText(
      "Couldn’t load revenue at the Sage rate 1.25. The figures below are still at today’s Bank of Canada rate 1.4219 (Oct 13)."
    );
    await expect(revenueCard(page)).toContainText("= $245,176 at 1.4219 (Bank of Canada, Oct 13)");
    await today(page).click();
    await expect(page.getByTestId("goals-rate-status")).toHaveText("");
  });
});
