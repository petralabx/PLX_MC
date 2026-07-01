import { expect, test } from "@playwright/test";

import { gotoSkillsDirectory } from "./helpers";
import { expectSurfaceNoHorizontalOverflow, mockSkillsDirectoryApi } from "./helpers/ui-loop-surfaces";

const SHOT_DIR = ".orchestrator/mc-brand-ui/skills";

test.describe("skills directory responsive (G3)", () => {
  test.beforeEach(async ({ page }) => {
    await mockSkillsDirectoryApi(page);
    await gotoSkillsDirectory(page);
  });

  test("skills catalog: no horizontal overflow", async ({ page }, testInfo) => {
    await expect(page.locator("[data-testid='sk-index-table']")).toBeVisible();
    await page.screenshot({ path: `${SHOT_DIR}/${testInfo.project.name}.png`, fullPage: true });
    await expectSurfaceNoHorizontalOverflow(page, "sk-screen", `skills/${testInfo.project.name}`);
  });
});
