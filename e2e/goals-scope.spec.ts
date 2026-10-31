import { expect, test, type Page } from "@playwright/test";

import { formatAmount, formatDollars } from "../src/lib/reporting/goals/money";
import { goalsPage } from "../tests/reporting-goals-helpers";
import { waitForHydration } from "./helpers";
import { gotoGoals, mockGoalsApi } from "./helpers/goals";

// The manufacturing-customers filter on Goals & Production (Progress Huddle
// 2026-10-23): a "Customers" switch beside the rate switch, kept in the URL as
// scope=mfg, switches the Revenue card's headline to every class but Exclusive
// Distribution; How it adds up (TASK-4373) shows the distribution left out. The goal stays.

const scopeGroup = (page: Page) => page.getByRole("group", { name: "Customers" });
const all = (page: Page) => scopeGroup(page).getByRole("button", { name: "All", exact: true });
const mfg = (page: Page) => scopeGroup(page).getByRole("button", { name: "Manufacturing customers" });
const mfgLine = (page: Page) => page.getByTestId("goals-revenue-mfg");
const headline = (page: Page) => page.getByTestId("goals-card-revenue").locator(".gp-big .v");
const ledger = (page: Page) => page.getByTestId("goals-revenue-ledger");
const exact = (c: number) => `$${formatAmount(c)}`;

test.describe("goals customer scope", () => {
  test("opens on all customers; manufacturing customers adds the card line and the URL, and back", async ({ page }) => {
    const scoped = goalsPage().revenueScope;
    expect(scoped).not.toBeNull();
    await mockGoalsApi(page);
    await gotoGoals(page);
    await expect(all(page)).toHaveAttribute("aria-pressed", "true");
    await expect(mfgLine(page)).toHaveCount(0);
    const total = scoped!.totalCadCents + scoped!.excludedCadCents;
    await expect(headline(page)).toHaveText(formatDollars(goalsPage().revenueGoal!.goalCadCents));
    const goal = await page.getByTestId("goals-card-revenue").locator(".gp-big .of").textContent();

    await mfg(page).click();
    await expect(page).toHaveURL(/[?&]scope=mfg\b/);
    await expect(mfg(page)).toHaveAttribute("aria-pressed", "true");
    await expect(headline(page)).toHaveText(formatDollars(scoped!.goalCadCents));
    await expect(mfgLine(page)).toContainText("Exclusive Distribution");
    await expect(mfgLine(page)).toContainText(exact(scoped!.excludedCadCents));
    await expect(ledger(page).getByRole("row").filter({ hasText: "All customers, charges included" })).toContainText(exact(total));
    await expect(page.getByTestId("goals-card-revenue").locator(".gp-big .of")).toHaveText(goal!);

    await expect(page.getByTestId("goals-revenue-charges")).toContainText(exact(scoped!.chargesCadCents));
    await expect(ledger(page).locator("tfoot")).toContainText(exact(scoped!.goalCadCents));

    await all(page).click();
    await expect(page).not.toHaveURL(/scope=mfg/);
    await expect(mfgLine(page)).toHaveCount(0);
    await expect(headline(page)).toHaveText(formatDollars(goalsPage().revenueGoal!.goalCadCents));
  });

  test("freight & other charges are out of the headline, and the currency line adds up to the all-in total (TASK-3952)", async ({ page }) => {
    const p = goalsPage();
    const goal = p.revenueGoal!;
    const rev = p.model!.revenue;
    await mockGoalsApi(page);
    await gotoGoals(page);
    await expect(headline(page)).toHaveText(formatDollars(goal.goalCadCents));
    const charges = page.getByTestId("goals-revenue-charges");
    await expect(charges).toContainText("Freight & other charges");
    await expect(charges).toContainText(exact(goal.chargesCadCents));
    await expect(ledger(page).getByRole("row").filter({ hasText: "Invoiced, charges included" })).toContainText(exact(rev.totalCents));
    const currency = page.getByTestId("goals-revenue-currency");
    await expect(currency.locator("tfoot")).toContainText(exact(rev.totalCents));
    expect(rev.cad.cents + rev.usd.cadCents + rev.byHandCents).toBe(rev.totalCents);
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
