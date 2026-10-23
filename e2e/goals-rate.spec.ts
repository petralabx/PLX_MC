import { expect, test, type Page } from "@playwright/test";

import type { Datasets } from "../src/lib/reporting/goals";
import { XLSX_CONTENT_TYPE } from "../src/lib/reporting/goals/excel/export";
import { DATASETS, ENTRIES, FORECAST, SHIPMENT_LINES_SUMMARY } from "../tests/reporting-goals-helpers";
import { waitForHydration } from "./helpers";
import { goalsPage, gotoGoals, mockGoalsApi } from "./helpers/goals";

// The revenue rate switch on Goals & Production (TASK-3780) and revenue by
// customer class (TASK-3781), against the 2026-10-14 fixture with M1–M7
// entered: the run's Bank of Canada rate 1.4219 by default, the fixed Sage
// rate 1.25 on the switch, kept in the URL, followed by the Revenue card, the
// class table and the export. The fixture's run is from Oct 14, an earlier day
// than any test run, so the Bank of Canada choice reads "Bank of Canada", not
// "Today's rate" (tests/reporting-goals-revenue-rate.test.ts covers both).

const rateGroup = (page: Page) => page.getByRole("group", { name: "US dollars at" });
const boc = (page: Page) => rateGroup(page).getByRole("button", { name: /^Bank of Canada/ });
const sage = (page: Page) => rateGroup(page).getByRole("button", { name: /^Sage rate/ });
const rateStatus = (page: Page) => page.getByTestId("goals-rate-status");
const revenueCard = (page: Page) => page.getByTestId("goals-card-revenue");
const classes = (page: Page) => page.getByRole("region", { name: "Revenue by customer class" });
const CONFIG_ERROR = {
  status: 500,
  code: "config_error",
  message: "The Sage rate isn’t set up: report_goal_setting.sage_usd_cad_rate must be a positive rate with at most 6 decimals.",
};

test.describe("goals revenue rate", () => {
  test("opens on the Bank of Canada rate, and the Sage rate moves every revenue figure and the URL", async ({ page }) => {
    await mockGoalsApi(page);
    await gotoGoals(page);
    await expect(boc(page)).toHaveAttribute("aria-pressed", "true");
    await expect(boc(page)).toContainText("1.4219");
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

    await page.goBack();
    await expect(boc(page)).toHaveAttribute("aria-pressed", "true");
    await expect(revenueCard(page)).toContainText("= $245,176 at 1.4219 (Bank of Canada, Oct 13)");
  });

  test("the full truckload test stays on the Bank of Canada rate at the Sage rate", async ({ page }) => {
    // CAD 24,000 to A1 American on Oct 5, a day with no stored rate: US$16,878.82 at 1.4219, a partial load.
    // At 1.25 it would be US$19,200, a full one, so the card would change if the test followed the switch.
    const snapshot: Datasets = {
      ...DATASETS,
      truckloads: [
        ...DATASETS.truckloads,
        { code: "A1TEXT11", shipment: "SH-CAD-1", shipDate: "2026-10-05", productUsd: "0", productCad: "24000.00", thisMonth: true },
      ],
    };
    const atBoc = goalsPage({}, ENTRIES, FORECAST, SHIPMENT_LINES_SUMMARY, "boc", snapshot);
    await mockGoalsApi(page, atBoc, undefined, goalsPage({}, ENTRIES, FORECAST, SHIPMENT_LINES_SUMMARY, "sage", snapshot));
    await gotoGoals(page);
    const card = page.getByTestId("goals-card-truckloads");
    // The CAD load counts as one more partial load than the fixture's own.
    expect(atBoc.model!.truckloads.partial.total).toBe(goalsPage().model!.truckloads.partial.total + 1);
    await expect(card).toContainText(`Partial loads: ${atBoc.model!.truckloads.partial.total}`);
    const before = await card.innerText();
    await sage(page).click();
    await expect(revenueCard(page)).toContainText("at 1.25 (Sage rate)");
    expect(await card.innerText()).toBe(before);
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

  test("when the Sage rate can't load, it says so, offers a retry, and the figures stay at the Bank of Canada rate", async ({ page }) => {
    await mockGoalsApi(page, goalsPage(), undefined, CONFIG_ERROR);
    await gotoGoals(page);
    await sage(page).click();
    await expect(rateStatus(page)).toHaveText(
      "Couldn’t load revenue at the Sage rate 1.25. The figures below are still at the Bank of Canada rate 1.4219 (Oct 13)."
    );
    await expect(revenueCard(page)).toContainText("= $245,176 at 1.4219 (Bank of Canada, Oct 13)");
    let retried = 0;
    page.on("request", (request) => {
      if (request.url().endsWith("/api/reporting/goals?fx=sage")) retried += 1;
    });
    await page.getByTestId("goals-rate-retry").click();
    await expect.poll(() => retried).toBe(1);
    await expect(rateStatus(page)).toContainText("Couldn’t load revenue at the Sage rate 1.25.");
    await boc(page).click();
    await expect(rateStatus(page)).toHaveText("");
    await expect(page.getByTestId("goals-rate-retry")).toHaveCount(0);
  });

  test("a link with fx=sage that can't load offers the way back to the Bank of Canada rate", async ({ page }) => {
    await mockGoalsApi(page, goalsPage(), undefined, CONFIG_ERROR);
    await page.goto("/?screen=goals&fx=sage");
    await waitForHydration(page);
    await expect(page.getByTestId("goals-rate")).toContainText("Couldn’t load revenue at the Sage rate.");
    await page.getByRole("button", { name: "Show the Bank of Canada rate" }).click();
    await expect(boc(page)).toHaveAttribute("aria-pressed", "true");
    await expect(revenueCard(page)).toContainText("= $245,176 at 1.4219 (Bank of Canada, Oct 13)");
    await expect(page).not.toHaveURL(/fx=sage/);
  });

  test("without a usable Sage rate the Sage choice is off", async ({ page }) => {
    const page0 = goalsPage();
    await mockGoalsApi(page, { ...page0, settings: { ...page0.settings!, sageUsdCadRate: null } });
    await gotoGoals(page);
    await expect(sage(page)).toBeDisabled();
    await expect(sage(page)).toContainText("not set");
  });
});
