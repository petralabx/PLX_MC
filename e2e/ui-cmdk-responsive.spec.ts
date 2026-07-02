import { expect, test } from "@playwright/test";

import { openCommandPalette } from "./helpers";
import { expectSurfaceNoHorizontalOverflow } from "./helpers/ui-loop-surfaces";

const SHOT_DIR = ".orchestrator/mc-brand-ui/cmdk";

test.describe("command palette responsive (G3)", () => {
  test.beforeEach(async ({ page }) => {
    await openCommandPalette(page);
  });

  test("palette overlay: no horizontal overflow", async ({ page }, testInfo) => {
    await expect(page.getByPlaceholder(/Create a task/i)).toBeVisible();
    await page.screenshot({ path: `${SHOT_DIR}/${testInfo.project.name}.png` });
    await expectSurfaceNoHorizontalOverflow(page, "cmdk", `cmdk/${testInfo.project.name}`);
    // The palette itself must also fit the viewport width.
    const box = await page.locator("[data-testid='cmdk']").boundingBox();
    const viewport = page.viewportSize();
    expect(box, "palette bounding box").not.toBeNull();
    if (box && viewport) {
      expect(box.x, "palette clipped at left edge").toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, "palette clipped at right edge").toBeLessThanOrEqual(viewport.width + 2);
    }
  });
});
