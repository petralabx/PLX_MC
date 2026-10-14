import { expect, test, type Page } from "@playwright/test";

import { gotoGoals, mockGoalsApi } from "./helpers/goals";
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
    await expect(page.getByTestId("goals-card-large-batches")).toBeVisible();
  });

  test("goals: no horizontal overflow, light and dark", async ({ page }, testInfo) => {
    await page.getByText("Day-by-day numbers").click();
    await page.screenshot({ path: `${SHOT_DIR}/${testInfo.project.name}.png`, fullPage: true });
    await expectSurfaceNoHorizontalOverflow(page, "goals-screen", `goals/${testInfo.project.name}`);
    await expectNoPageOverflow(page, `goals/${testInfo.project.name}`);
    await page.locator(".mc").first().evaluate((el) => el.classList.add("dark"));
    await page.screenshot({ path: `${SHOT_DIR}/${testInfo.project.name}-dark.png`, fullPage: true });
    await expectSurfaceNoHorizontalOverflow(page, "goals-screen", `goals/${testInfo.project.name}/dark`);
  });
});
