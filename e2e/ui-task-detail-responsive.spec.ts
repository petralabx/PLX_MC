import { expect, test } from "@playwright/test";

import { gotoTaskDetail } from "./helpers";
import { expectSurfaceNoHorizontalOverflow } from "./helpers/ui-loop-surfaces";

const SHOT_DIR = ".orchestrator/mc-brand-ui/task-detail";

test.describe("task detail responsive (G3)", () => {
  test.beforeEach(async ({ page }) => {
    await gotoTaskDetail(page);
  });

  test("task detail: no horizontal overflow", async ({ page }, testInfo) => {
    await expect(page.locator(".mc .td h1")).toBeVisible();
    await page.screenshot({ path: `${SHOT_DIR}/${testInfo.project.name}.png`, fullPage: true });
    await expectSurfaceNoHorizontalOverflow(page, "task-detail-screen", `task-detail/${testInfo.project.name}`);
  });
});
