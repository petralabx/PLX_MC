import { expect, test } from "@playwright/test";

import { OPERATOR_ID, TASKS } from "../src/lib/mc-data/data";
import { waitForHydration } from "./helpers";

// SPEC §6 #6 + #5a — My Tasks reachability and scoping.
//   • Reachable via the sidebar entry, the ⌘K palette command, and the `g m`
//     view chord.
//   • Shows only the current user's tasks (assignee / co-assignee / reporter).
//   • Is bucket-agnostic and SUPPRESSES the bucket pill (it must not display a
//     bucket scope it isn't honoring).

// The fixture's "mine" set (reporter/assignee/coassignee == OPERATOR_ID): the
// e2e server runs dormant (no OIDC), so GET /api/viewer names the operator.
const MINE = TASKS.filter(
  (t) => t.assignee === OPERATOR_ID || t.coassignees.includes(OPERATOR_ID) || t.reporter === OPERATOR_ID
);

async function expectOnMyTasks(page: import("@playwright/test").Page) {
  // The page kicker + heading identify the screen.
  await expect(page.locator(".mc-main .ph .kk")).toContainText("My Tasks");
  await expect(page.locator(".mc-main .ph h1")).toContainText("My");
  await expect(page.locator(".mc-main .ph .sub")).toContainText(/Assigned to, co-owned by, or reported by you/i);
}

test.describe("My Tasks view", () => {
  test("reachable via the sidebar entry", async ({ page }) => {
    await page.goto("/");
    await waitForHydration(page);
    await page.locator("nav.mc-side button", { hasText: "My Tasks" }).click();
    await expectOnMyTasks(page);
  });

  test("reachable via the ⌘K command palette", async ({ page }) => {
    await page.goto("/");
    await waitForHydration(page);
    await page.keyboard.press("ControlOrMeta+k");
    const palette = page.locator(".mc-cmdk");
    await expect(palette).toBeVisible();
    await palette.locator("input").fill("My Tasks");
    await palette.getByText("Go to My Tasks").click();
    await expectOnMyTasks(page);
  });

  test("reachable via the `g m` view chord", async ({ page }) => {
    await page.goto("/");
    await waitForHydration(page);
    // Ensure focus is on a neutral, non-interactive element (the page heading,
    // NOT an inbox row) so the bare-key chord fires and isn't typed into a field.
    await page.locator(".mc-main .ph h1").click();
    await page.keyboard.press("g");
    await page.keyboard.press("m");
    await expectOnMyTasks(page);
  });

  test("shows only the current user's tasks, is bucket-agnostic, and suppresses the bucket pill", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForHydration(page);
    await page.locator("nav.mc-side button", { hasText: "My Tasks" }).click();
    await expectOnMyTasks(page);

    // My Tasks defaults to the List lens grouped by Initiative (SPEC §5 D1).
    // Count the user's tasks across every initiative — bucket-agnostic.
    const rows = page.locator(".mc .list .lrow:not(.head)");
    await expect(rows).toHaveCount(MINE.length);

    // Every visible row is one of the user's tasks (by id).
    const mineIds = new Set(MINE.map((t) => t.id));
    for (const idCell of await rows.locator(".id").all()) {
      const id = (await idCell.textContent())?.trim() ?? "";
      expect(mineIds.has(id)).toBe(true);
    }

    // Bucket pill is suppressed: no ".pill.muted" bucket-scope chip in the header.
    await expect(page.locator(".mc-main .ph .pill.muted")).toHaveCount(0);

    // It spans multiple initiatives (cross-bucket): more than one List group
    // header is present (the seed plan covers 8 initiatives).
    await expect(page.locator(".mc .list .grouphd").first()).toBeVisible();
    expect(await page.locator(".mc .list .grouphd").count()).toBeGreaterThan(1);
  });
});
