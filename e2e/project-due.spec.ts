import { expect, test } from "@playwright/test";

import { gotoProject } from "./helpers/project";

// The Due filter beside the task filter on the project overview (TASK-4392).
// The fixture project's 15 tasks are all outstanding, with due dates written
// without a year (Jun 15 to Oct 01). The clock is pinned to Tuesday 16 Jun
// 2026, so this week is Jun 15 to 21 and the counts never drift with the
// calendar: three tasks were due Jun 15, one each in WMS Integration,
// Decoupling API and Product Development.

test.describe("project due filter", () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-06-16T12:00:00Z"));
  });

  test("filters the overview by due date, with counts, and composes with the task filter", async ({ page }) => {
    await gotoProject(page);
    const due = page.getByTestId("project-due-filter");
    const control = page.locator(".mc .pv-duefilter");
    const openSections = page.locator(".mc .pv-roll .pv-sec:not(.closed)");
    const rows = openSections.locator(".pv-trow");

    await expect(due).toHaveValue("any");
    await expect(due.locator("option")).toHaveText(["Any date", "Overdue · 3", "This week · 3", "Next 14 days · 4", "No due date · 0"]);
    await expect(rows).toHaveCount(15);

    await due.selectOption("overdue");
    await expect(control).toHaveClass(/\bon\b/);
    await expect(rows).toHaveCount(3);
    await expect(rows.locator(".pv-due")).toHaveText(["Jun 15", "Jun 15", "Jun 15"]);
    // The initiatives the filters leave empty start collapsed, as with the task filter.
    await expect(openSections).toHaveCount(3);

    await due.selectOption("none");
    await expect(rows).toHaveCount(0);
    await expect(openSections).toHaveCount(0);
    // Opened by hand, an emptied initiative says the Due choice emptied it.
    await page.getByRole("button", { name: "Expand WMS Integration" }).click();
    await expect(page.locator(".mc .pv-sec .pv-empty")).toHaveText("Nothing here is missing a due date.");

    await due.selectOption("any");
    await expect(control).not.toHaveClass(/\bon\b/);
    await expect(rows).toHaveCount(15);
  });
});
