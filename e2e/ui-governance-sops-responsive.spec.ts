import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { openSidebar, waitForHydration } from "./helpers";

// G3 — responsive integrity (ui-ux-design-loop) for MC-SOP-Guide. Runs across the
// desktop/tablet/mobile project matrix (playwright.config.ts) and asserts the SOP
// surface never forces a page-level horizontal scroll (the classic table/stat-grid
// breakpoint failure), plus captures a per-viewport screenshot for the evidence
// bundle. Screenshots are evidence, not baselines — the hard gate is the overflow
// assertion. Uses the REAL API (the dev server reads the committed registry +
// docs/COLLABORATOR-SOP.md), so this is full-stack at every width.

const SHOT_DIR = ".orchestrator/governance-sops/screenshots";
const OVERFLOW_TOLERANCE_PX = 2;

// Measure the governance-sops SURFACE (not the whole document) — this gate owns
// the SOP screen, not the shared MC shell chrome (topbar/sidebar), whose
// responsive behavior is a separate, pre-existing concern out of this loop's scope.
async function expectNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>("[data-testid='gs-screen']");
    if (!el) return { scrollWidth: 0, clientWidth: 1 };
    return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
  });
  expect(
    overflow.scrollWidth,
    `${label}: SOP surface overflows — scrollWidth ${overflow.scrollWidth} > clientWidth ${overflow.clientWidth}`
  ).toBeLessThanOrEqual(overflow.clientWidth + OVERFLOW_TOLERANCE_PX);
}

test.describe("governance-sops responsive (G3)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await waitForHydration(page);
    await openSidebar(page, "SOP guide");
    await expect(page.locator("[data-testid='gs-screen']")).toBeVisible();
  });

  test("SOP index: no horizontal overflow", async ({ page }, testInfo) => {
    await expect(page.locator("[data-testid='gs-index-table']")).toBeVisible();
    await page.screenshot({ path: `${SHOT_DIR}/index-${testInfo.project.name}.png`, fullPage: true });
    await expectNoHorizontalOverflow(page, `index/${testInfo.project.name}`);
  });

  test("Collaborator SOP detail: no horizontal overflow", async ({ page }, testInfo) => {
    await page.locator("[data-testid='gs-row'][data-slug='mc-sop-collaborator']").click();
    await expect(page.locator("[data-testid='gs-detail-view']")).toBeVisible();
    await page.screenshot({ path: `${SHOT_DIR}/detail-${testInfo.project.name}.png`, fullPage: true });
    await expectNoHorizontalOverflow(page, `detail/${testInfo.project.name}`);
  });
});
