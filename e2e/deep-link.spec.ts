import { expect, test } from "@playwright/test";

import { gotoBoard, openSidebar, waitForHydration } from "./helpers";

// P3 deep links — screens are URL-addressable: navigating updates the URL,
// a full reload restores the same screen, and browser back/forward replay
// screen history (popstate → route state). Navigation itself reuses the
// shell's sidebar exactly like every other spec (see helpers.ts).
test.describe("deep links: URL reflects the screen, survives reload, and back works", () => {
  test("navigating to Board writes the URL and a reload restores the Board", async ({ page }) => {
    await gotoBoard(page);
    await expect(page).toHaveURL(/[?&]screen=board/);

    await page.reload();
    await waitForHydration(page);
    // Same screen after a cold load of the deep link — not the home Inbox.
    await expect(page.locator("[data-testid='board-screen']")).toBeVisible();
    await expect(page).toHaveURL(/[?&]screen=board/);
  });

  test("a direct visit to a deep link lands on that screen", async ({ page }) => {
    await page.goto("/?screen=sync");
    await waitForHydration(page);
    await expect(page.locator("[data-testid='sync-console-screen']")).toBeVisible();
  });

  test("browser back returns to the previous screen", async ({ page }) => {
    await gotoBoard(page);
    await openSidebar(page, "Sync");
    await expect(page.locator("[data-testid='sync-console-screen']")).toBeVisible();
    await expect(page).toHaveURL(/[?&]screen=sync/);

    await page.goBack();
    await expect(page.locator("[data-testid='board-screen']")).toBeVisible();
    await expect(page).toHaveURL(/[?&]screen=board/);
  });

  test("an unknown screen param falls back to home instead of crashing", async ({ page }) => {
    await page.goto("/?screen=not-a-screen");
    await waitForHydration(page);
    // Home is the Inbox; the board surface must NOT be mounted.
    await expect(page.locator("[data-testid='board-screen']")).toHaveCount(0);
  });
});
