import { expect, test } from "@playwright/test";

import { gotoInsights } from "./helpers";
import { expectSurfaceNoHorizontalOverflow } from "./helpers/ui-loop-surfaces";

const SHOT_DIR = ".orchestrator/mc-brand-ui/insights";

test.describe("insights responsive (G3)", () => {
  test.beforeEach(async ({ page }) => {
    await gotoInsights(page);
  });

  test("insights view: no horizontal overflow", async ({ page }, testInfo) => {
    await expect(page.getByRole("heading", { name: /A read on the/i })).toBeVisible();
    await page.screenshot({ path: `${SHOT_DIR}/${testInfo.project.name}.png`, fullPage: true });
    await expectSurfaceNoHorizontalOverflow(page, "insights-screen", `insights/${testInfo.project.name}`);
  });
});
