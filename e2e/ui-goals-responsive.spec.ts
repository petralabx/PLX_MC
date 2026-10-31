import { expect, test, type Page } from "@playwright/test";

import { gotoGoals, mockGoalsApi, openGoalsTab } from "./helpers/goals";
import { expectSurfaceNoHorizontalOverflow } from "./helpers/ui-loop-surfaces";

// G3 for Goals & Production (TASK-2896): no sideways scrolling at the desktop,
// tablet and phone widths (393 px is under the brief's 400), light and dark.
// Wide tables scroll inside their own region, never the page.

const SHOT_DIR = ".orchestrator/mc-brand-ui/goals";

/** The whole document, not only the screen: absolutely placed text can widen it from inside a scroller. */
async function expectNoPageOverflow(page: Page, label: string) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, `${label}: page scrollWidth ${scrollWidth} > ${clientWidth}`).toBeLessThanOrEqual(clientWidth + 2);
}

test.describe("goals responsive (G3)", () => {
  test.beforeEach(async ({ page }) => {
    await mockGoalsApi(page);
    await gotoGoals(page);
    await expect(page.getByTestId("goals-card-line1")).toBeVisible();
  });

  test("goals: no horizontal overflow, light and dark", async ({ page }, testInfo) => {
    await openGoalsTab(page, "Batches: Day by day");
    await page.getByText("Day-by-day numbers").click();
    await page.screenshot({ path: `${SHOT_DIR}/${testInfo.project.name}.png`, fullPage: true });
    await expectSurfaceNoHorizontalOverflow(page, "goals-screen", `goals/${testInfo.project.name}`);
    await expectNoPageOverflow(page, `goals/${testInfo.project.name}`);
    await page.locator(".mc").first().evaluate((el) => el.classList.add("dark"));
    await page.screenshot({ path: `${SHOT_DIR}/${testInfo.project.name}-dark.png`, fullPage: true });
    await expectSurfaceNoHorizontalOverflow(page, "goals-screen", `goals/${testInfo.project.name}/dark`);
  });

  test("shipments list: the table scrolls inside its region, never the page, and the totals fit, light and dark", async ({ page }, testInfo) => {
    await openGoalsTab(page, "Revenue: Shipments");
    const section = page.getByTestId("goals-shipments");
    await section.getByRole("button", { name: /^USD/ }).click();
    await expect(section.getByText("Showing 14 of 72 shipments")).toBeVisible();
    const totals = section.getByRole("region", { name: "Shipment totals" });
    for (const mode of ["light", "dark"]) {
      if (mode === "dark") await page.locator(".mc").first().evaluate((el) => el.classList.add("dark"));
      const label = `goals-shipments/${testInfo.project.name}/${mode}`;
      await expectSurfaceNoHorizontalOverflow(page, "goals-shipments", label);
      await expectNoPageOverflow(page, label);
      // Each total sits beside its label: the totals never need scrolling sideways.
      const { scrollWidth, clientWidth } = await totals.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
      expect(scrollWidth, `${label}: totals scrollWidth ${scrollWidth} > ${clientWidth}`).toBeLessThanOrEqual(clientWidth + 2);
    }
  });

  test("shipment lines: opened invoices stay inside the list's region, never widening the page, light and dark", async ({ page }, testInfo) => {
    await openGoalsTab(page, "Revenue: Shipments");
    const list = page.getByTestId("goals-shipments").getByRole("region", { name: "Shipment list" });
    for (const invoice of ["IN1000180398", "IN1000180368", "IN1000180353"]) {
      await list.getByRole("button", { name: `Lines of invoice ${invoice}` }).click();
    }
    await expect(list.locator("tr.gp-lines-row")).toHaveCount(3);
    await expect(list.locator("tr.gp-lines-row table")).toHaveCount(2);
    for (const mode of ["light", "dark"]) {
      if (mode === "dark") await page.locator(".mc").first().evaluate((el) => el.classList.add("dark"));
      const label = `goals-shipment-lines/${testInfo.project.name}/${mode}`;
      await expectSurfaceNoHorizontalOverflow(page, "goals-shipments", label);
      await expectNoPageOverflow(page, label);
    }
  });
});
