import { expect, test } from "@playwright/test";

import { gotoProject } from "./helpers/project";

// The Due filter beside the task filter on the project overview (TASK-4392).
// The fixture project's tasks are due Jun 15, so today they are overdue.

test.describe("project due filter", () => {
  test("filters the overview by due date, with counts, and composes with the task filter", async ({ page }) => {
    await gotoProject(page);
    const due = page.getByTestId("project-due-filter");
    await expect(due).toHaveValue("any");
    await expect(due.locator("option")).toHaveText([/^Any date$/, /^Overdue · \d+$/, /^This week · \d+$/, /^Next 14 days · \d+$/, /^No due date · \d+$/]);
    const rows = page.locator(".mc .pv-roll .pv-sec:not(.closed) .pv-trow");
    const before = await rows.count();
    expect(before).toBeGreaterThan(0);

    await due.selectOption("overdue");
    await expect(page.locator(".mc .pv-duefilter")).toHaveClass(/\bon\b/);
    const overdue = Number((await due.locator("option[value=overdue]").textContent())!.split("· ")[1]);
    expect(overdue).toBeGreaterThan(0);

    // The status filter still applies: Outstanding plus Overdue shows exactly the overdue count.
    await expect(rows).toHaveCount(Math.min(overdue, before));

    await due.selectOption("none");
    const none = Number((await due.locator("option[value=none]").textContent())!.split("· ")[1]);
    if (none === 0) {
      await expect(rows).toHaveCount(0);
      // An initiative the filters leave empty starts collapsed, as with the task filter.
      await expect(page.locator(".mc .pv-roll .pv-sec:not(.closed)")).toHaveCount(0);
    }

    await due.selectOption("any");
    await expect(page.locator(".mc .pv-duefilter")).not.toHaveClass(/\bon\b/);
    await expect(rows).toHaveCount(before);
  });
});
