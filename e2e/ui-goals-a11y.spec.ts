import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { gotoGoals, mockGoalsApi } from "./helpers/goals";

// G4 for Goals & Production (TASK-2896): zero axe violations on the screen,
// light and dark, with the chart tables open. No allowlist entry.

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

test.describe("goals a11y (G4)", () => {
  test.beforeEach(async ({ page }) => {
    await mockGoalsApi(page);
    await gotoGoals(page);
    await expect(page.getByTestId("goals-card-large-batches")).toBeVisible();
    await page.getByText("Day-by-day numbers").click();
    await page.getByText("Monthly numbers").click();
  });

  test("goals view has no axe violations", async ({ page }) => {
    const results = await new AxeBuilder({ page }).include('[data-testid="goals-screen"]').withTags(TAGS).analyze();
    expect(results.violations).toEqual([]);
  });

  test("goals view has no axe violations in dark mode", async ({ page }) => {
    await page.locator(".mc").first().evaluate((el) => el.classList.add("dark"));
    const results = await new AxeBuilder({ page }).include('[data-testid="goals-screen"]').withTags(TAGS).analyze();
    expect(results.violations).toEqual([]);
  });

  test("the shipments list has no axe violations with a filter and a search on, light and dark", async ({ page }) => {
    const section = page.getByTestId("goals-shipments");
    await section.getByRole("button", { name: /^Truckload customers/ }).click();
    await section.getByLabel("Search shipments").fill("a1");
    await expect(section.getByText("Showing 2 of 72 shipments")).toBeVisible();
    for (const mode of ["light", "dark"]) {
      if (mode === "dark") await page.locator(".mc").first().evaluate((el) => el.classList.add("dark"));
      const results = await new AxeBuilder({ page }).include('[data-testid="goals-shipments"]').withTags(TAGS).analyze();
      expect(results.violations, mode).toEqual([]);
    }
  });
});
