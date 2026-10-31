import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { XLSX_CONTENT_TYPE } from "../src/lib/reporting/goals/excel/export";
import { formatDollars } from "../src/lib/reporting/goals/money";
import { datesGoalsPage, goalsPage } from "../tests/reporting-goals-helpers";
import { waitForHydration } from "./helpers";
import { mockGoalsApi, openGoalsTab } from "./helpers/goals";

// The dates filter on Goals & Production (TASK-4391): pick month to date, this
// week, the last 7 days or some days; the choice goes in the URL as dates=, the
// page model is read again for it (served here from the fixture,
// tests/reporting-goals-helpers.ts), the cards drop their status and pace, and
// the salespeople and the section tab keep it.

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const picker = (page: Page) => page.getByTestId("goals-dates");
const summary = (page: Page) => page.getByTestId("goals-dates-summary");
const headline = (page: Page) => page.getByTestId("goals-card-revenue").locator(".gp-big .v");
const of = (page: Page) => page.getByTestId("goals-card-revenue").locator(".gp-big .of");

/** Serves GET /api/reporting/goals?…sales=…&dates=… for what it asks; says what was asked, in order. */
async function serveFilters(page: Page): Promise<{ sales: string; dates: string }[]> {
  const asked: { sales: string; dates: string }[] = [];
  await page.route(/\/api\/reporting\/goals\?/, (route) => {
    const params = new URL(route.request().url()).searchParams;
    const sales = params.get("sales") ?? "";
    const dates = params.get("dates") ?? "";
    asked.push({ sales, dates });
    const data = datesGoalsPage(dates || null, sales ? sales.split(",") : undefined);
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data }) });
  });
  return asked;
}

test.describe("goals dates filter", () => {
  test("opens on the whole month; This week narrows the page and the URL, and Show the whole month goes back", async ({ page }) => {
    const whole = goalsPage();
    const week = datesGoalsPage("week");
    await mockGoalsApi(page, whole);
    const asked = await serveFilters(page);
    await page.goto("/?screen=goals");
    await waitForHydration(page);
    await expect(summary(page)).toHaveText("This month");
    await expect(headline(page)).toHaveText(formatDollars(whole.revenueGoal!.goalCadCents));
    await expect(page.getByTestId("goals-card-revenue").locator(".pv-chip")).toHaveCount(1);

    await summary(page).click();
    await picker(page).getByRole("radio", { name: /This week/ }).check();
    await expect(page).toHaveURL(/[?&]dates=week(&|$)/);
    await expect(summary(page)).toHaveText("This week, Oct 12 to Oct 18");
    await expect(headline(page)).toHaveText(formatDollars(week.revenueGoal!.goalCadCents));
    expect(week.revenueGoal!.goalCadCents).not.toBe(whole.revenueGoal!.goalCadCents);
    await expect(of(page)).toHaveText("in Oct 12 to Oct 18");
    await expect(page.locator("[data-testid^='goals-card-'] .pv-chip")).toHaveCount(0);
    await expect(page.getByTestId("goals-dates-note")).toContainText("Showing Oct 12 to Oct 18 only (4 working days)");
    await expect(page.getByRole("heading", { name: "This week, Oct 12 to Oct 18" })).toBeVisible();
    await expect(page.locator(".gp-takeaway")).toHaveText(week.model!.takeaway);

    await page.getByTestId("goals-dates-clear").click();
    await expect(page).not.toHaveURL(/dates=/);
    await expect(summary(page)).toHaveText("This month");
    await expect(headline(page)).toHaveText(formatDollars(whole.revenueGoal!.goalCadCents));
    await expect(page.getByTestId("goals-dates-note")).toHaveCount(0);
    expect(asked).toEqual([{ sales: "", dates: "week" }]);
  });

  test("a custom range applies, and Show these dates waits for from on or before to", async ({ page }) => {
    const first = datesGoalsPage("2026-10-01..2026-10-07");
    await mockGoalsApi(page, goalsPage());
    const asked = await serveFilters(page);
    await page.goto("/?screen=goals");
    await waitForHydration(page);
    await summary(page).click();
    const from = page.getByTestId("goals-dates-from");
    const to = page.getByTestId("goals-dates-to");
    await expect(from).toHaveValue("2026-10-01");
    await expect(to).toHaveValue("2026-10-31");
    await from.fill("2026-10-08");
    await to.fill("2026-10-03");
    await expect(page.getByTestId("goals-dates-apply")).toBeDisabled();
    await from.fill("2026-10-01");
    await to.fill("2026-10-07");
    await page.getByTestId("goals-dates-apply").click();
    await expect(page).toHaveURL(/[?&]dates=2026-10-01\.\.2026-10-07(&|$)/);
    await expect(summary(page)).toHaveText("Oct 1 to Oct 7");
    await expect(headline(page)).toHaveText(formatDollars(first.revenueGoal!.goalCadCents));
    await expect(page.getByTestId("goals-dates-status")).toHaveText("");
    expect(asked).toEqual([{ sales: "", dates: "2026-10-01..2026-10-07" }]);
  });

  test("sales= and dates= both reach the API, survive a tab switch and go to the export", async ({ page }) => {
    const both = datesGoalsPage("week", ["BB"]);
    const every = datesGoalsPage("week");
    await mockGoalsApi(page, goalsPage());
    const asked = await serveFilters(page);
    let exported = "";
    await page.route(/\/api\/reporting\/goals\/export/, (route) => {
      exported = route.request().url();
      return route.fulfill({
        status: 200,
        headers: {
          "content-type": XLSX_CONTENT_TYPE,
          "content-disposition": 'attachment; filename="PLX goals and production 2026-10-14 (2026-10-12 to 2026-10-18) (BB).xlsx"',
        },
        body: "xlsx",
      });
    });
    await page.goto("/?screen=goals&sales=BB&dates=week");
    await waitForHydration(page);
    await expect(summary(page)).toHaveText("This week, Oct 12 to Oct 18");
    await expect(page.getByTestId("goals-salespeople-summary")).toHaveText("Bravo Rep (BB)");
    expect(asked[0]).toEqual({ sales: "BB", dates: "week" });
    await expect(headline(page)).toHaveText(formatDollars(both.revenueGoal!.goalCadCents));
    await expect(of(page)).toHaveText(`of ${formatDollars(every.revenueGoal!.goalCadCents)} for every customer in these dates`);

    await openGoalsTab(page, "Revenue: Shipments");
    await expect(page).toHaveURL(/[?&]tab=shipments\b/);
    await expect(page).toHaveURL(/[?&]sales=BB\b/);
    await expect(page).toHaveURL(/[?&]dates=week\b/);
    await expect(page.getByRole("heading", { name: "Shipments in these dates" })).toBeVisible();

    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export to Excel" }).click();
    expect((await downloading).suggestedFilename()).toBe("PLX goals and production 2026-10-14 (2026-10-12 to 2026-10-18) (BB).xlsx");
    const params = new URL(exported).searchParams;
    expect([params.get("sales"), params.get("dates")]).toEqual(["BB", "week"]);
  });

  test("the open picker has no axe violations, light and dark", async ({ page }) => {
    await mockGoalsApi(page, goalsPage());
    await serveFilters(page);
    await page.goto("/?screen=goals&dates=mtd");
    await waitForHydration(page);
    await summary(page).click();
    await expect(picker(page).getByRole("radio", { name: /Month to date/ })).toBeChecked();
    for (const mode of ["light", "dark"]) {
      if (mode === "dark") await page.locator(".mc").first().evaluate((el) => el.classList.add("dark"));
      const results = await new AxeBuilder({ page }).include('[data-testid="goals-dates"]').withTags(TAGS).analyze();
      expect(results.violations, mode).toEqual([]);
    }
  });

  test("a link with dates the page can't read shows the whole month and offers to clear them", async ({ page }) => {
    await mockGoalsApi(page, goalsPage());
    await serveFilters(page);
    // From after to: the right shape for the URL, but no days.
    await page.goto("/?screen=goals&dates=2026-10-20..2026-10-10");
    await waitForHydration(page);
    await expect(summary(page)).toHaveText(/This month/);
    await page.getByTestId("goals-dates-clear").click();
    await expect(page).not.toHaveURL(/dates=/);
    await expect(page.getByTestId("goals-dates-clear")).toHaveCount(0);
  });
});
