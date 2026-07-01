import { expect, test } from "@playwright/test";

import { gotoRepos } from "./helpers";
import { expectSurfaceNoHorizontalOverflow } from "./helpers/ui-loop-surfaces";

const SHOT_DIR = ".orchestrator/mc-brand-ui/repos";

test.describe("repos responsive (G3)", () => {
  test.beforeEach(async ({ page }) => {
    await gotoRepos(page);
  });

  test("repos registry: no horizontal overflow", async ({ page }, testInfo) => {
    await expect(page.getByRole("heading", { name: "Repos" })).toBeVisible();
    await page.screenshot({ path: `${SHOT_DIR}/${testInfo.project.name}.png`, fullPage: true });
    await expectSurfaceNoHorizontalOverflow(page, "repos-screen", `repos/${testInfo.project.name}`);
  });
});
