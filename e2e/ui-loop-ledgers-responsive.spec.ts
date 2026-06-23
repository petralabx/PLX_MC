import { expect, test } from "@playwright/test";

import { mockLoopLedgers, openLoopLedgers } from "./helpers/loop-ledgers-fixtures";

// G3 — responsive integrity (ui-ux-design-loop). Runs across the desktop/tablet/
// mobile project matrix (playwright.config.ts) and asserts no horizontal overflow
// (the classic table/stat-grid breakpoint failure), plus captures a per-viewport
// screenshot for the evidence bundle. Screenshots are evidence, not baselines —
// the hard gate is the overflow + visibility assertions.

const SHOT_DIR = ".orchestrator/loop-ledgers-ui/screenshots";

// A small allowance for sub-pixel rounding / scrollbar gutters.
const OVERFLOW_TOLERANCE_PX = 2;

// Measure the loop-ledgers SURFACE (not the whole document) — this gate owns the
// loop-ledgers screen, not the shared MC shell chrome (topbar/sidebar), whose
// responsive behavior is a separate, pre-existing concern out of this loop's scope.
async function expectNoHorizontalOverflow(page: Parameters<typeof mockLoopLedgers>[0], label: string): Promise<void> {
  const overflow = await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>("[data-testid='ll-screen']");
    if (!el) return { scrollWidth: 0, clientWidth: 1 };
    return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
  });
  expect(
    overflow.scrollWidth,
    `${label}: loop-ledgers surface overflows — scrollWidth ${overflow.scrollWidth} > clientWidth ${overflow.clientWidth}`
  ).toBeLessThanOrEqual(overflow.clientWidth + OVERFLOW_TOLERANCE_PX);
}

test.describe("loop-ledgers responsive (G3)", () => {
  test.beforeEach(async ({ page }) => {
    await mockLoopLedgers(page);
    await openLoopLedgers(page);
    await expect(page.locator("[data-testid='ll-screen']")).toBeVisible();
  });

  test("cross-repo index: no horizontal overflow", async ({ page }, testInfo) => {
    await expect(page.locator("[data-testid='ll-index-table']")).toBeVisible();
    await page.screenshot({ path: `${SHOT_DIR}/index-${testInfo.project.name}.png`, fullPage: true });
    await expectNoHorizontalOverflow(page, `index/${testInfo.project.name}`);
  });

  test("module detail: no horizontal overflow", async ({ page }, testInfo) => {
    await page.locator("[data-testid='ll-row']").nth(2).click();
    await expect(page.locator("[data-testid='ll-detail-view']")).toBeVisible();
    await page.screenshot({ path: `${SHOT_DIR}/detail-${testInfo.project.name}.png`, fullPage: true });
    await expectNoHorizontalOverflow(page, `detail/${testInfo.project.name}`);
  });

  test("degraded gallery: no horizontal overflow", async ({ page }, testInfo) => {
    await page.locator(".ll-tab", { hasText: "Degraded gallery" }).click();
    await expect(page.locator("[data-testid='ll-gallery']")).toBeVisible();
    await page.screenshot({ path: `${SHOT_DIR}/gallery-${testInfo.project.name}.png`, fullPage: true });
    await expectNoHorizontalOverflow(page, `gallery/${testInfo.project.name}`);
  });
});
