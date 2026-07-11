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
    test(`overview rollup renders and is usable at ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await gotoProject(page);

      // Default lens: Overview — initiative sections with task tables.
      const sections = page.locator(".mc .pv-sec");
      await expect(sections.first()).toBeVisible();
      expect(await sections.count()).toBeGreaterThan(0);
      await expect(page.locator(".mc .pv-trow").first()).toBeVisible();

      await page.screenshot({ path: `${SHOT_DIR}/overview-${vp.name}.png`, fullPage: true });
      await expectSurfaceNoHorizontalOverflow(page, "project-screen", `project-overview/${vp.name}`);

      // A task row navigates to task detail (the "/ TaskRecord" kicker).
      await page.locator(".mc .pv-trow").first().click();
      await expect(page.locator(".mc .kk", { hasText: "TaskRecord" }).first()).toBeVisible();
    });

    test(`initiative card grid renders and is usable at ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await gotoProject(page);

      // Switch to the Initiatives lens (the P1 card grid).
      await page.locator(".mc .ph .pv-seg button", { hasText: "Initiatives" }).click();
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
