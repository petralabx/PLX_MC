import { expect, test } from "@playwright/test";

import { gotoAiSpend } from "./helpers";
import { expectSurfaceNoHorizontalOverflow } from "./helpers/ui-loop-surfaces";

const SHOT_DIR = ".orchestrator/mc-brand-ui/ai-spend";

test.describe("ai spend responsive (G3)", () => {
  test.beforeEach(async ({ page }) => {
    await gotoAiSpend(page);
  });

  test("ai spend placeholder: no horizontal overflow", async ({ page }, testInfo) => {
    await expect(page.getByRole("heading", { name: /AI\s+spend/i })).toBeVisible();
    await page.screenshot({ path: `${SHOT_DIR}/${testInfo.project.name}.png`, fullPage: true });
    await expectSurfaceNoHorizontalOverflow(page, "ai-spend-screen", `ai-spend/${testInfo.project.name}`);
  });
});
