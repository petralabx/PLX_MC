import { expect, test } from "@playwright/test";

import { openSidebar, waitForHydration } from "./helpers";

test.describe("Architecture catalog", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await waitForHydration(page);
    await openSidebar(page, "Architecture");
    await expect(page.locator("[data-testid='arch-screen']")).toBeVisible();
  });

  test("sidebar item lives in System of record and is active", async ({ page }) => {
    const navItem = page.locator("nav.mc-side button", { hasText: "Architecture" });
    await expect(navItem).toBeVisible();
    await expect(navItem).toHaveClass(/active/);
  });

  test("disclosure and default context diagram render", async ({ page }) => {
    await expect(page.locator("[data-testid='arch-disclosure']")).toContainText(
      "Generated consumer"
    );
    await expect(page.locator("[data-testid='arch-svg']")).toHaveAttribute(
      "src",
      "/architecture/context.svg"
    );
  });

  test("view switcher swaps diagram assets", async ({ page }) => {
    await page.locator("[data-testid='arch-tab-containers']").click();
    await expect(page.locator("[data-testid='arch-svg']")).toHaveAttribute(
      "src",
      "/architecture/containers.svg"
    );
    await page.locator("[data-testid='arch-tab-task-lifecycle']").click();
    await expect(page.locator("[data-testid='arch-svg']")).toHaveAttribute(
      "src",
      "/architecture/task-lifecycle.svg"
    );
  });
});
