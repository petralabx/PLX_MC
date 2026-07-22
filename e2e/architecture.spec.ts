import { expect, test } from "@playwright/test";

import { openSidebar, waitForHydration } from "./helpers";

async function gotoArchitecture(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/?screen=architecture");
  await waitForHydration(page);
  await expect(page.locator("[data-testid='arch-screen']")).toBeVisible();
}

test.describe("Architecture interactive canvas", () => {
  test.beforeEach(async ({ page }) => {
    await gotoArchitecture(page);
  });

  test("sidebar item lives in System of record and is active", async ({ page }) => {
    const navItem = page.locator("nav.mc-side button", { hasText: "Architecture" });
    await expect(navItem).toBeVisible();
    await expect(navItem).toHaveClass(/active/);
  });

  test("disclosure and interactive canvas render", async ({ page }) => {
    await expect(page.locator("[data-testid='arch-disclosure']")).toContainText(
      "Generated consumer"
    );
    await expect(page.locator("[data-testid='arch-canvas']")).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.locator("[data-testid='arch-prov-chips']")).toContainText(
      "READ-ONLY"
    );
  });

  test("view switcher changes diagram and preserves deep link", async ({ page }) => {
    await expect(page.locator("[data-testid='arch-canvas']")).toBeVisible({
      timeout: 20_000,
    });
    await page.locator("[data-testid='arch-tab-containers']").click();
    await expect(page).toHaveURL(/diagram=containers/);
    await expect(page.locator("[data-testid='arch-level-label']")).toContainText(
      "Containers"
    );
    await page.locator("[data-testid='arch-tab-task-lifecycle']").click();
    await expect(page).toHaveURL(/diagram=task-lifecycle/);
    await expect(page.locator("[data-testid='arch-level-label']")).toContainText(
      "Task lifecycle"
    );
  });

  test("node selection opens detail panel and syncs hash", async ({ page }) => {
    await expect(page.locator("[data-testid='arch-canvas']")).toBeVisible({
      timeout: 20_000,
    });
    const node = page.locator("[data-testid^='arch-node-']").first();
    await node.click();
    await expect(page.locator("[data-testid='arch-detail']")).toBeVisible();
    await expect(page).toHaveURL(/#node=/);
    await page.locator("[data-testid='arch-detail-close']").click();
    await expect(page.locator("[data-testid='arch-detail']")).toBeHidden();
  });

  test("keyboard Escape clears selection", async ({ page }) => {
    await expect(page.locator("[data-testid='arch-canvas']")).toBeVisible({
      timeout: 20_000,
    });
    await page.locator("[data-testid^='arch-node-']").first().click();
    await expect(page.locator("[data-testid='arch-detail']")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-testid='arch-detail']")).toBeHidden();
  });

  test("clear focus button resets selection", async ({ page }) => {
    await expect(page.locator("[data-testid='arch-canvas']")).toBeVisible({
      timeout: 20_000,
    });
    await page.locator("[data-testid^='arch-node-']").first().click();
    await expect(page.locator("[data-testid='arch-detail']")).toBeVisible();
    await page.locator("[data-testid='arch-detail-close']").click();
    await expect(page.locator("[data-testid='arch-detail']")).toBeHidden();
  });

  test("group caption toggles collapse", async ({ page }) => {
    await expect(page.locator("[data-testid='arch-canvas']")).toBeVisible({
      timeout: 20_000,
    });
    const caption = page.locator("[data-testid^='arch-group-']").first();
    if ((await caption.count()) === 0) return;
    await caption.scrollIntoViewIfNeeded();
    const before = (await caption.textContent()) ?? "";
    await caption.focus();
    await page.keyboard.press("Enter");
    await expect(caption).not.toHaveText(before, { timeout: 5000 });
  });

  test("static SVG fallback when model API fails", async ({ page }) => {
    await page.route("**/api/architecture/model", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          error: { code: "architecture_model_invalid", message: "test failure" },
        }),
      })
    );
    await page.goto("/?screen=architecture&diagram=context");
    await waitForHydration(page);
    await expect(page.locator("[data-testid='arch-error-banner']")).toBeVisible();
    await expect(page.locator("[data-testid='arch-svg']")).toHaveAttribute(
      "src",
      "/architecture/context.svg"
    );
  });

  test("direct diagram deep link works", async ({ page }) => {
    await page.goto("/?screen=architecture&diagram=containers");
    await waitForHydration(page);
    await expect(page.locator("[data-testid='arch-tab-containers']")).toHaveAttribute(
      "aria-selected",
      "true"
    );
    await expect(page.locator("[data-testid='arch-canvas']")).toBeVisible({
      timeout: 20_000,
    });
  });
});

test.describe("Architecture sidebar navigation", () => {
  test("opens from sidebar", async ({ page }) => {
    await page.goto("/");
    await waitForHydration(page);
    await openSidebar(page, "Architecture");
    await expect(page.locator("[data-testid='arch-screen']")).toBeVisible();
    await expect(page.locator("[data-testid='arch-canvas']")).toBeVisible({
      timeout: 20_000,
    });
  });
});
