import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { XLSX_CONTENT_TYPE } from "../src/lib/reporting/goals/excel/export";
import { formatDollars } from "../src/lib/reporting/goals/money";
import { salesGoalsPage } from "../tests/reporting-goals-helpers";
import { waitForHydration } from "./helpers";
import { mockGoalsApi } from "./helpers/goals";

// The salesperson (account manager) filter on Goals & Production (TASK-4277):
// pick one or more Sage salespeople beside the Customers switch; the choice
// goes in the URL as sales=, the page model is read again for it (served here
// from the fixture's roster, tests/reporting-goals-helpers.ts), the Revenue
// card is set against every customer's, and the workbook follows.

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const picker = (page: Page) => page.getByTestId("goals-salespeople");
const summary = (page: Page) => page.getByTestId("goals-salespeople-summary");
const headline = (page: Page) => page.getByTestId("goals-card-revenue").locator(".gp-big .v");
const of = (page: Page) => page.getByTestId("goals-card-revenue").locator(".gp-big .of");

/** Serves GET /api/reporting/goals?…sales=… narrowed to what it asks for; says what was asked, in order. */
async function serveSales(page: Page): Promise<string[]> {
  const asked: string[] = [];
  await page.route(/\/api\/reporting\/goals\?(?:.*&)?sales=/, (route) => {
    const sales = new URL(route.request().url()).searchParams.get("sales") ?? "";
    asked.push(sales);
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: salesGoalsPage(sales.split(",")) }) });
  });
  return asked;
}

test.describe("goals salesperson filter", () => {
  test("opens on every customer; picking salespeople narrows the page and the URL, and Show every customer goes back", async ({ page }) => {
    const whole = salesGoalsPage([]);
    const bb = salesGoalsPage(["BB"]);
    await mockGoalsApi(page, whole);
    const asked = await serveSales(page);
    await page.goto("/?screen=goals");
    await waitForHydration(page);
    await expect(summary(page)).toHaveText("All salespeople");
    await expect(headline(page)).toHaveText(formatDollars(whole.revenueGoal!.goalCadCents));

    await summary(page).click();
    await picker(page).getByRole("checkbox", { name: /Bravo Rep/ }).check();
    await expect(page).toHaveURL(/[?&]sales=BB(&|$)/);
    await expect(summary(page)).toHaveText("Bravo Rep (BB)");
    await expect(headline(page)).toHaveText(formatDollars(bb.revenueGoal!.goalCadCents));
    await expect(of(page)).toHaveText(`of ${formatDollars(whole.revenueGoal!.goalCadCents)} for every customer`);
    await expect(page.getByTestId("goals-card-revenue").locator(".pv-chip")).toHaveCount(0);
    await expect(page.getByTestId("goals-salespeople-note")).toContainText("Showing only the customers of Bravo Rep (BB)");
    await expect(page.getByTestId("goals-line1-every-customer")).toBeVisible();

    // A second pick adds to the first; the picker stays open for it.
    await picker(page).getByRole("checkbox", { name: /No salesperson/ }).check();
    await expect(page).toHaveURL(/sales=BB(%2C|,)none/);
    await expect(summary(page)).toHaveText("Bravo Rep (BB), No salesperson");
    expect(asked).toEqual(["BB", "BB,none"]);

    await page.getByTestId("goals-salespeople-clear").click();
    await expect(page).not.toHaveURL(/sales=/);
    await expect(summary(page)).toHaveText("All salespeople");
    await expect(headline(page)).toHaveText(formatDollars(whole.revenueGoal!.goalCadCents));
    await expect(page.getByTestId("goals-salespeople-note")).toHaveCount(0);
  });

  test("the list view: search, Pick all shown, Done and Escape, and the picked open first (TASK-4385)", async ({ page }) => {
    await mockGoalsApi(page, salesGoalsPage([]));
    const asked = await serveSales(page);
    await page.goto("/?screen=goals");
    await waitForHydration(page);
    const details = picker(page).locator("details");
    const rows = picker(page).locator(".gp-pick-list .gp-check");
    const search = page.getByTestId("goals-salespeople-search");

    await summary(page).click();
    await expect(rows).toHaveCount(4);
    await expect(page.getByTestId("goals-salespeople-menu-clear")).toBeDisabled();
    // Every row picked would be every customer, so Pick all shown waits for a search.
    await expect(page.getByTestId("goals-salespeople-pick-shown")).toHaveCount(0);
    await search.fill("rep");
    await expect(rows).toHaveCount(3);
    await page.getByTestId("goals-salespeople-pick-shown").click();
    await expect(page).toHaveURL(/[?&]sales=AA(%2C|,)BB(%2C|,)CC(&|$)/);
    await expect(summary(page)).toHaveText("3 picked");
    await expect(picker(page).locator(".gp-pick-foot")).toContainText("3 picked");
    await search.fill("zzz");
    await expect(rows).toHaveCount(0);
    await expect(picker(page)).toContainText("No salesperson matches “zzz”.");

    await page.getByTestId("goals-salespeople-menu-clear").click();
    await expect(page).not.toHaveURL(/sales=/);
    await search.fill("");
    await picker(page).getByRole("checkbox", { name: /No salesperson/ }).check();
    await expect(page).toHaveURL(/[?&]sales=none(&|$)/);
    // Ticking doesn't move rows while the list is open.
    await expect(rows.last()).toContainText("No salesperson");
    await page.getByTestId("goals-salespeople-done").click();
    await expect(details).toHaveJSProperty("open", false);
    await expect(summary(page)).toBeFocused();

    // Reopened: the search is empty and the picked row comes first.
    await summary(page).click();
    await expect(search).toHaveValue("");
    await expect(rows.first()).toContainText("No salesperson");
    await search.focus();
    await page.keyboard.press("Escape");
    await expect(details).toHaveJSProperty("open", false);
    await expect(summary(page)).toBeFocused();
    expect(asked).toEqual(["AA,BB,CC", "none"]);
  });

  test("a sales= link opens narrowed and exports for those salespeople", async ({ page }) => {
    await mockGoalsApi(page, salesGoalsPage([]));
    const asked = await serveSales(page);
    let exported = "";
    await page.route(/\/api\/reporting\/goals\/export/, (route) => {
      exported = route.request().url();
      return route.fulfill({
        status: 200,
        headers: { "content-type": XLSX_CONTENT_TYPE, "content-disposition": 'attachment; filename="PLX goals and production 2026-10-14 (BB).xlsx"' },
        body: "xlsx",
      });
    });
    await page.goto("/?screen=goals&sales=BB");
    await waitForHydration(page);
    await expect(summary(page)).toHaveText("Bravo Rep (BB)");
    expect(asked[0]).toBe("BB");

    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export to Excel" }).click();
    expect((await downloading).suggestedFilename()).toBe("PLX goals and production 2026-10-14 (BB).xlsx");
    expect(new URL(exported).searchParams.get("sales")).toBe("BB");
  });

  test("the open picker has no axe violations, light and dark", async ({ page }) => {
    await mockGoalsApi(page, salesGoalsPage([]));
    await serveSales(page);
    await page.goto("/?screen=goals&sales=AA");
    await waitForHydration(page);
    await summary(page).click();
    await expect(picker(page).getByRole("checkbox", { name: /Alpha Rep/ })).toBeChecked();
    for (const mode of ["light", "dark"]) {
      if (mode === "dark") await page.locator(".mc").first().evaluate((el) => el.classList.add("dark"));
      const results = await new AxeBuilder({ page }).include('[data-testid="goals-salespeople"]').withTags(TAGS).analyze();
      expect(results.violations, mode).toEqual([]);
    }
  });
});
