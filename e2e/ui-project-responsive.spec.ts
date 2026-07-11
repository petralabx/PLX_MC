import { expect, test } from "@playwright/test";

import { gotoProject } from "./helpers/project";
import { expectSurfaceNoHorizontalOverflow } from "./helpers/ui-loop-surfaces";

const SHOT_DIR = ".orchestrator/design-projects/project";

// The tablet/mobile Playwright projects run a fixed testMatch list in
// playwright.config.ts, which is outside this phase's ownership — so this spec
// walks the same three configured viewport widths itself. Register the file in
// that testMatch at integration and this loop can collapse to one assertion.
const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 720 },
  { name: "tablet", width: 820, height: 1180 },
  { name: "mobile", width: 393, height: 851 },
] as const;

test.describe("project responsive (G3)", () => {
  for (const vp of VIEWPORTS) {
    test(`initiative card grid renders and is usable at ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await gotoProject(page);

      const cards = page.locator(".mc .init-grid .init-card");
      await expect(cards.first()).toBeVisible();
      expect(await cards.count()).toBeGreaterThan(0);

      await page.screenshot({ path: `${SHOT_DIR}/${vp.name}.png`, fullPage: true });
      await expectSurfaceNoHorizontalOverflow(page, "project-screen", `project/${vp.name}`);

      // Click affordance: a card navigates to its bucket's detail screen.
      await cards.first().click();
      await expect(page.locator(".mc .ph .kk", { hasText: "Initiative ·" })).toBeVisible();
    });
  }
});
