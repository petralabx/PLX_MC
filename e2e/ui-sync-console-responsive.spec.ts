import { expect, test } from "@playwright/test";

import { gotoSyncConsole } from "./helpers";
import { expectSurfaceNoHorizontalOverflow } from "./helpers/ui-loop-surfaces";

const SHOT_DIR = ".orchestrator/mc-brand-ui/sync-console";

test.describe("sync console responsive (G3)", () => {
  test.beforeEach(async ({ page }) => {
    await gotoSyncConsole(page);
  });

  test("sync console: no horizontal overflow", async ({ page }, testInfo) => {
    await expect(page.getByRole("heading", { name: /Sync console/i })).toBeVisible();
    await page.screenshot({ path: `${SHOT_DIR}/${testInfo.project.name}.png`, fullPage: true });
    await expectSurfaceNoHorizontalOverflow(page, "sync-console-screen", `sync/${testInfo.project.name}`);
  });
});
