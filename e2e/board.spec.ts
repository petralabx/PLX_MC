import { expect, test } from "@playwright/test";

import { boardColumns, cardById, gotoBoard } from "./helpers";

// SPEC §6 — Board renders the bucket/stage columns + task cards; a card opens
// the detail. The default axis is `band` (To do / In progress / Done / Cancelled); we also
// confirm the lifecycle stage axis renders its 10 columns (the 9-stage product
// spine plus the Cancelled end stage, TASK-2529).
test.describe("board renders and a card opens the detail", () => {
  test.beforeEach(async ({ page }) => {
    await gotoBoard(page);
  });

  test("default band board shows the four bands as columns with cards", async ({ page }) => {
    // Default group-by = band → exactly the four bands, in order (Cancelled last).
    await expect(boardColumns(page)).toHaveCount(4);
    await expect(page.locator(".mc .board .bcol .bhead .nm")).toHaveText([
      /To do/,
      /In progress/,
      /Done/,
      /Cancelled/,
    ]);

    // The fixture seeds 15 go-live tasks; at least one card is on the board.
    await expect(page.locator(".mc .tcard").first()).toBeVisible();
    await expect(await page.locator(".mc .tcard").count()).toBeGreaterThan(0);
  });

  test("switching to the stage axis renders the 9-stage lifecycle plus the Cancelled column", async ({ page }) => {
    await page.locator(".tb .seg").first().locator("button", { hasText: /^Stage$/ }).click();
    // The 9 gated lifecycle stages (Backlog … Verified) plus the Cancelled end stage.
    await expect(boardColumns(page)).toHaveCount(10);
    await expect(page.locator(".mc .board .bcol .bhead .nm").first()).toContainText("Backlog");
    await expect(page.locator(".mc .board .bcol .bhead .nm").last()).toContainText("Cancelled");
  });

  test("clicking a task card opens its detail view", async ({ page }) => {
    // TASK-221 (WMS integration) is in the seed plan.
    const card = cardById(page, "TASK-221").first();
    await expect(card).toBeVisible();
    await card.click();

    // The detail view shows the Back affordance and the task id in its header.
    await expect(page.getByRole("button", { name: /← Back/ })).toBeVisible();
    await expect(page.locator(".mc .td .thead .kk")).toContainText("TASK-221");
    await expect(page.locator(".mc .td h1")).toContainText("WMS integration");
  });
});
