import { expect, test } from "@playwright/test";

import { boardColumns, gotoBoard } from "./helpers";

// SPEC §6 #1 — Switching GroupBy re-pivots the board columns across all five
// axes (band/stage/bucket/priority/assignee); enabling swimlanes then moving to
// a non-{band,stage} axis RESETS swimlanes off (sub-lanes vanish, not just the
// toggle); and the 10-column stage axis introduces NO horizontal page overflow
// (the compact-column layout keeps it inside the board's own scroll region).

const groupBySegButton = (label: string) =>
  ({ hasText: new RegExp(`^${label}$`) });

test.describe("group-by re-pivots the board", () => {
  test.beforeEach(async ({ page }) => {
    await gotoBoard(page);
  });

  test("each axis relabels the columns and every task appears exactly once", async ({ page }) => {
    const seg = page.locator(".tb .seg").first();

    // band (default) → 4 columns (To do / In progress / Done / Cancelled).
    await expect(boardColumns(page)).toHaveCount(4);

    // The total card count is invariant across axes (single-cell partition:
    // each task lands in exactly one column on every axis).
    const total = await page.locator(".mc .tcard").count();
    expect(total).toBeGreaterThan(0);

    // stage → 9 lifecycle columns plus Cancelled.
    await seg.locator("button", groupBySegButton("Stage")).click();
    await expect(boardColumns(page)).toHaveCount(10);
    await expect(page.locator(".mc .tcard")).toHaveCount(total);

    // bucket ("Initiative") → 8 go-live initiatives.
    await seg.locator("button", groupBySegButton("Initiative")).click();
    await expect(boardColumns(page)).toHaveCount(8);
    await expect(page.locator(".mc .tcard")).toHaveCount(total);

    // priority → 4 priority columns (Urgent/High/Medium/Low).
    await seg.locator("button", groupBySegButton("Priority")).click();
    await expect(boardColumns(page)).toHaveCount(4);
    await expect(page.locator(".mc .board .bcol .bhead .nm").first()).toContainText("Urgent");
    await expect(page.locator(".mc .tcard")).toHaveCount(total);

    // assignee → the seed tasks are all unassigned, so the axis collapses to a
    // single "Unassigned" column (data-derived, no empty per-member columns).
    await seg.locator("button", groupBySegButton("Assignee")).click();
    await expect(boardColumns(page)).toHaveCount(1);
    await expect(page.locator(".mc .board .bcol .bhead .nm")).toContainText("Unassigned");
    await expect(page.locator(".mc .tcard")).toHaveCount(total);
  });

  test("enabling swimlanes then switching to a non-band/stage axis resets swimlanes off", async ({ page }) => {
    const seg = page.locator(".tb .seg").first();

    // Swimlanes toggle is only present on band/stage. Turn it on under band.
    const swimToggle = page.getByRole("button", { name: "Human · Agent" });
    await expect(swimToggle).toBeVisible();
    await swimToggle.click();

    // With swimlanes on, the board renders sub-lane labels (all seed tasks are
    // unassigned → an "Unassigned" sub-lane appears inside the columns).
    await expect(page.locator(".mc .board .swlabel").first()).toBeVisible();

    // Switch to a non-band/stage axis → swimlanes are FORCED off: the toggle is
    // gone AND the sub-lane labels disappear (not merely the control hidden).
    await seg.locator("button", groupBySegButton("Initiative")).click();
    await expect(page.getByRole("button", { name: "Human · Agent" })).toHaveCount(0);
    await expect(page.locator(".mc .board .swlabel")).toHaveCount(0);

    // Returning to band leaves swimlanes OFF (the reset persisted; it did not
    // silently re-enable).
    await seg.locator("button", groupBySegButton("Band")).click();
    await expect(page.locator(".mc .board .swlabel")).toHaveCount(0);
  });

  test("the 10-column stage axis introduces no horizontal page overflow", async ({ page }) => {
    await page.locator(".tb .seg").first().locator("button", groupBySegButton("Stage")).click();
    await expect(boardColumns(page)).toHaveCount(10);

    // The board absorbs its width via its own overflow-x:auto region; the PAGE
    // must not gain a horizontal scrollbar. Allow 1px for sub-pixel rounding.
    const overflow = await page.evaluate(() => {
      const doc = document.documentElement;
      return doc.scrollWidth - doc.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(1);

    // And the board's own track is the scroll container (overflow-x: auto),
    // confirming the columns live inside it rather than widening the layout.
    const boardOverflowX = await page.locator(".mc .board").evaluate(
      (el) => getComputedStyle(el).overflowX
    );
    expect(boardOverflowX).toBe("auto");
  });
});
