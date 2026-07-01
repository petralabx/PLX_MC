import { expect, test } from "@playwright/test";

import { waitForHydration } from "./helpers";

// G3 — inbox responsive integrity (ui-ux-design-loop). Default route (home/inbox).

const SHOT_DIR = ".orchestrator/mc-brand-ui/inbox";
const OVERFLOW_TOLERANCE_PX = 2;

async function expectNoHorizontalOverflow(page: import("@playwright/test").Page, label: string): Promise<void> {
  const overflow = await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>("[data-testid='inbox-screen']");
    if (!el) return { scrollWidth: 0, clientWidth: 1 };
    return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
  });
  expect(
    overflow.scrollWidth,
    `${label}: inbox surface overflows — scrollWidth ${overflow.scrollWidth} > clientWidth ${overflow.clientWidth}`
  ).toBeLessThanOrEqual(overflow.clientWidth + OVERFLOW_TOLERANCE_PX);
}

test.describe("inbox responsive (G3)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await waitForHydration(page);
    await expect(page.locator("[data-testid='inbox-screen']")).toBeVisible();
  });

  test("inbox home: no horizontal overflow", async ({ page }, testInfo) => {
    await expect(page.getByRole("heading", { name: /Mission control/i })).toBeVisible();
    await page.screenshot({ path: `${SHOT_DIR}/${testInfo.project.name}.png`, fullPage: true });
    await expectNoHorizontalOverflow(page, `inbox/${testInfo.project.name}`);
  });
});
