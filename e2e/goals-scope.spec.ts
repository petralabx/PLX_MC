import { expect, test, type Page } from "@playwright/test";

import { formatDollars } from "../src/lib/reporting/goals/money";
import { goalsPage } from "../tests/reporting-goals-helpers";
import { waitForHydration } from "./helpers";
import { gotoGoals, mockGoalsApi } from "./helpers/goals";

// The manufacturing-customers filter on Goals & Production (Progress Huddle
// 2026-10-23): a "Customers" switch beside the rate switch, kept in the URL as
// scope=mfg, adds a line to the Revenue card with every class but Exclusive
// Distribution. The card's headline and goal stay on all customers.

const scopeGroup = (page: Page) => page.getByRole("group", { name: "Customers" });
const all = (page: Page) => scopeGroup(page).getByRole("button", { name: "All", exact: true });
const mfg = (page: Page) => scopeGroup(page).getByRole("button", { name: "Manufacturing customers" });
const mfgLine = (page: Page) => page.getByTestId("goals-revenue-mfg");

test.describe("goals customer scope", () => {
  test("opens on all customers; manufacturing customers adds the card line and the URL, and back", async ({ page }) => {
    const scoped = goalsPage().revenueScope;
    expect(scoped).not.toBeNull();
    await mockGoalsApi(page);
    await gotoGoals(page);
    await expect(all(page)).toHaveAttribute("aria-pressed", "true");
    await expect(mfgLine(page)).toHaveCount(0);

    await mfg(page).click();
    await expect(page).toHaveURL(/[?&]scope=mfg\b/);
    await expect(mfg(page)).toHaveAttribute("aria-pressed", "true");
    await expect(mfgLine(page)).toContainText(`Manufacturing customers: ${formatDollars(scoped!.totalCadCents)}`);
    await expect(mfgLine(page)).toContainText(`leaving out ${formatDollars(scoped!.excludedCadCents)} from Exclusive`);

    await all(page).click();
    await expect(page).not.toHaveURL(/scope=mfg/);
    await expect(mfgLine(page)).toHaveCount(0);
  });

  test("a scope=mfg link keeps the Sage rate when the rate changes", async ({ page }) => {
    await mockGoalsApi(page);
    await page.goto("/?screen=goals&scope=mfg");
    await waitForHydration(page);
    await expect(mfgLine(page)).toBeVisible();
    await page.getByRole("group", { name: "US dollars at" }).getByRole("button", { name: /^Sage rate/ }).click();
    await expect(page).toHaveURL(/fx=sage/);
    await expect(page).toHaveURL(/scope=mfg/);
    await expect(mfgLine(page)).toBeVisible();
  });
});
