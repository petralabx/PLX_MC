import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import type { GoalsPage } from "../src/lib/reporting/goals";
import { waitForHydration } from "./helpers";
import { goalsPage, gotoGoals, mockGoalsApi } from "./helpers/goals";

// Revenue forecast on Goals & Production (TASK-3151), against the 2026-10-14
// fixture with M1–M7 entered: the section sits last, before the rules; its
// chips and search change the rows and the totals; and it says when it is
// waiting for read access. Axe-clean in light and dark, with numbers and while
// waiting. No sideways scrolling at desktop, tablet and phone widths is checked
// on the whole screen, this section included, by e2e/ui-goals-responsive.spec.ts.

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const section = (page: Page) => page.getByTestId("goals-forecast");

const WAITING: GoalsPage = goalsPage({}, undefined, {
  data: {
    access: "missing",
    missing: ["sage.oe_order_header.type", "sage.oe_order_header.expdate", "public.assembly_order.qtytotal"],
    categoryMissing: [],
    lines: [],
    aos: [],
  },
  history: [],
});

test.describe("goals revenue forecast", () => {
  test("sits at the bottom, after the batch list and before the rules, with its four numbers", async ({ page }) => {
    await mockGoalsApi(page);
    await gotoGoals(page);
    await expect(section(page)).toBeVisible();
    const order = await page
      .locator("[data-testid='goals-screen'] section.gp-sec")
      .evaluateAll((els) => els.map((el) => el.getAttribute("data-testid")));
    expect(order.slice(-2)).toEqual(["goals-forecast", "goals-rules"]);
    expect(order.indexOf("goals-forecast")).toBeGreaterThan(order.indexOf("goals-batches"));

    const numbers = section(page).getByTestId("goals-forecast-numbers");
    await expect(numbers.locator("li")).toHaveCount(4);
    await expect(numbers.locator("li").nth(0)).toContainText("Theoretical$527,018of $1,000,000");
    await expect(numbers.locator("li").nth(1)).toContainText("At risk$40,703");
    await expect(numbers.locator("li").nth(2)).toContainText("Realistic$503,340");
    await expect(numbers.locator("li").nth(2)).toContainText("80.0% hit rate, measured over September 2026");
    await expect(numbers.locator("li").nth(3)).toContainText("Pace$953,466");
    await expect(section(page)).toContainText("2 assembly orders scheduled this month (8,400 pieces) have no open Sage order behind them");
    await expect(section(page)).toContainText("From queries revenue-by-currency, forecast-orders, forecast-assembly-orders · run #41");
    await expect(page.getByTestId("goals-rules")).toContainText("Revenue forecast takes every open Sage order line");
  });

  test("bucket chips and the search change the rows and the totals", async ({ page }) => {
    await mockGoalsApi(page);
    await gotoGoals(page);
    const list = section(page).getByRole("region", { name: "Open orders this month" });
    const status = section(page).locator(".gp-count");
    const search = section(page).getByLabel("Search open orders");
    await expect(list.locator("tbody tr")).toHaveCount(18);
    await expect(status).toHaveText("Showing 18 of 18 rows · 159,093.58 CAD (and EUR 2,100.00, not converted)");

    await section(page).getByRole("button", { name: /^Late/ }).click();
    await expect(section(page).getByRole("button", { name: /^Late/ })).toHaveAttribute("aria-pressed", "true");
    await expect(list.locator("tbody tr")).toHaveCount(3);
    await expect(status).toHaveText("Showing 3 of 18 rows · 27,917.55 CAD");
    await expect(list.locator("tfoot")).toContainText("27,917.55");

    await section(page).getByRole("button", { name: /^All/ }).click();
    await search.fill("a1 american");
    await expect(list.locator("tbody tr")).toHaveCount(5);
    await expect(status).toHaveText("Showing 5 of 18 rows · 54,743.15 CAD");
    await section(page).getByRole("button", { name: /^Ready/ }).click();
    await expect(list.locator("tbody tr")).toHaveCount(1);
    await expect(list.locator("tbody tr")).toContainText("AO-26275G");
    await expect(status).toHaveText("Showing 1 of 18 rows · 17,062.80 CAD");

    await search.fill("nothing like this");
    await expect(section(page).getByText("No open orders match these filters.")).toBeVisible();
    await expect(status).toHaveText("Showing 0 of 18 rows · 0.00 CAD");
  });

  test("the customer class and item category filters change the rows, the chips and the totals (TASK-3177)", async ({ page }) => {
    await mockGoalsApi(page);
    await gotoGoals(page);
    const list = section(page).getByRole("region", { name: "Open orders this month" });
    const status = section(page).locator(".gp-count");
    await section(page).getByLabel("Customer class").selectOption("Exclusive Manufacturing");
    await expect(list.locator("tbody tr")).toHaveCount(12);
    await expect(status).toHaveText("Showing 12 of 18 rows · 133,177.93 CAD");
    await section(page).getByLabel("Item category").selectOption("channel:Distribution");
    await expect(list.locator("tbody tr")).toHaveCount(7);
    await expect(section(page).getByRole("button", { name: /^Planned in time/ })).toContainText("2");
    await section(page).getByRole("button", { name: /^Planned in time/ }).click();
    await expect(status).toHaveText("Showing 2 of 18 rows · 35,831.88 CAD");
    await section(page).getByLabel("Customer class").selectOption("all");
    await section(page).getByRole("button", { name: /^All/ }).click();
    await section(page).getByLabel("Item category").selectOption("none");
    await expect(list.locator("tbody tr")).toHaveCount(1);
    await expect(list.locator("tbody tr")).toContainText("FP-1414");
    // The four numbers follow the class and category filters (TASK-3190): FP-1414's $1,000 alone is at risk.
    const numbers = section(page).getByTestId("goals-forecast-numbers").locator("li");
    await expect(numbers.nth(1)).toContainText("At risk$1,000");
    await section(page).getByLabel("Item category").selectOption("all");
    await expect(numbers.nth(1)).toContainText("At risk$40,703");
  });

  test("the four numbers follow the class and category filters, never the chips or the search (TASK-3190)", async ({ page }) => {
    await mockGoalsApi(page);
    await gotoGoals(page);
    const numbers = section(page).getByTestId("goals-forecast-numbers").locator("li");
    const caption = section(page).getByTestId("goals-forecast-filtered");
    await expect(caption).toHaveCount(0);
    await expect(numbers.nth(0)).toContainText("Theoretical$527,018of $1,000,000");

    await section(page).getByLabel("Customer class").selectOption("Exclusive Manufacturing");
    await expect(caption).toHaveText("For Exclusive Manufacturing customers only. The target and the hit rate are for all customers.");
    await expect(numbers.nth(0)).toContainText("Theoretical$215,787of $1,000,000 (all customers)Invoiced $118,593 + ready $53,763 + planned in time $43,432");
    await expect(numbers.nth(1)).toContainText("At risk$35,983");
    await expect(numbers.nth(2)).toContainText("Realistic$196,348");
    await expect(numbers.nth(3)).toContainText("Pace$276,716");
    await expect(section(page).getByText("Invoiced for Exclusive Manufacturing customers is $118,593 of the Revenue card’s $408,628")).toBeVisible();
    // The chips and the search change the list only.
    await section(page).getByRole("button", { name: /^Late/ }).click();
    await section(page).getByRole("searchbox", { name: "Search open orders" }).fill("a1 american");
    await expect(numbers.nth(0)).toContainText("Theoretical$215,787");

    await section(page).getByLabel("Customer class").selectOption("all");
    await section(page).getByLabel("Item category").selectOption("channel:Distribution");
    await expect(caption).toContainText("For Distribution items only. Invoices aren’t split by item category yet");
    await expect(numbers.nth(0)).toContainText("Theoretical$57,395Open orders only: ready $19,563 + planned in time $37,832");
    await expect(numbers.nth(3)).toContainText("Pace—Needs invoices split by item category (not available yet)");

    await section(page).getByLabel("Item category").selectOption("all");
    await expect(caption).toHaveCount(0);
    await expect(numbers.nth(0)).toContainText("Theoretical$527,018of $1,000,000Invoiced $408,628");
  });

  test("while the login can't read the orders it says so, names what's missing, and the rest of the page stays", async ({ page }) => {
    await mockGoalsApi(page, WAITING);
    await gotoGoals(page);
    const waiting = section(page).getByTestId("goals-forecast-waiting");
    await expect(waiting).toContainText("Waiting for read access to Sage orders and FileMaker assembly orders.");
    await expect(waiting).toContainText("sage.oe_order_header: type, expdate");
    await expect(waiting).toContainText("public.assembly_order: qtytotal");
    await expect(section(page).getByRole("region", { name: "Open orders this month" })).toHaveCount(0);
    await expect(page.getByTestId("goals-card-revenue")).toContainText("$408,628 of $1,000,000");
  });

  for (const mode of ["light", "dark"] as const) {
    test(`has no axe violations in ${mode} mode, with numbers and while waiting`, async ({ page }) => {
      const scan = async () => {
        if (mode === "dark") await page.locator(".mc").first().evaluate((el) => el.classList.add("dark"));
        const results = await new AxeBuilder({ page }).include('[data-testid="goals-forecast"]').withTags(TAGS).analyze();
        expect(results.violations).toEqual([]);
      };
      await mockGoalsApi(page);
      await gotoGoals(page);
      await section(page).getByRole("button", { name: /^Not planned/ }).click();
      await expect(section(page).locator("tbody tr")).toHaveCount(5);
      await scan();

      await page.unrouteAll({ behavior: "ignoreErrors" });
      await mockGoalsApi(page, WAITING);
      await page.reload();
      await waitForHydration(page);
      await expect(section(page).getByTestId("goals-forecast-waiting")).toBeVisible();
      await scan();
    });
  }
});
