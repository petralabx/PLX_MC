import { expect, test } from "@playwright/test";

// G3 — sign-in responsive integrity (ui-ux-design-loop). The sign-in surface
// is the brand threshold — scoped to [data-testid="signin-screen"].

const SHOT_DIR = ".orchestrator/mc-brand-ui/signin";
const OVERFLOW_TOLERANCE_PX = 2;

async function expectNoHorizontalOverflow(page: import("@playwright/test").Page, label: string): Promise<void> {
  const overflow = await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>("[data-testid='signin-screen']");
    if (!el) return { scrollWidth: 0, clientWidth: 1 };
    return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
  });
  expect(
    overflow.scrollWidth,
    `${label}: sign-in surface overflows — scrollWidth ${overflow.scrollWidth} > clientWidth ${overflow.clientWidth}`
  ).toBeLessThanOrEqual(overflow.clientWidth + OVERFLOW_TOLERANCE_PX);
}

test.describe("sign-in responsive (G3)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/signin");
    await expect(page.locator("[data-testid='signin-screen']")).toBeVisible();
  });

  test("brand card: no horizontal overflow", async ({ page }, testInfo) => {
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await page.screenshot({ path: `${SHOT_DIR}/${testInfo.project.name}.png`, fullPage: true });
    await expectNoHorizontalOverflow(page, `signin/${testInfo.project.name}`);
  });
});
