import { expect, test } from "@playwright/test";

import { gotoBoard } from "./helpers";
import { expectSurfaceNoHorizontalOverflow } from "./helpers/ui-loop-surfaces";

const SHOT_DIR = ".orchestrator/mc-brand-ui/board";

test.describe("board responsive (G3)", () => {
  test.beforeEach(async ({ page }) => {
    await gotoBoard(page);
  });

  test("board view: no horizontal overflow", async ({ page }, testInfo) => {
    await expect(page.getByText("Group by")).toBeVisible();
    await page.screenshot({ path: `${SHOT_DIR}/${testInfo.project.name}.png`, fullPage: true });
    await expectSurfaceNoHorizontalOverflow(page, "board-screen", `board/${testInfo.project.name}`);
  });
});
