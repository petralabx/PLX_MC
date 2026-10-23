import { expect, test } from "@playwright/test";

import { formatAmount } from "../src/lib/reporting/goals/money";
import { goalsPage } from "../tests/reporting-goals-helpers";
import { gotoGoals, mockGoalsApi } from "./helpers/goals";

// Revenue by customer on Goals & Production (Progress Huddle 2026-10-23): a
// search box over the potential and realized rankings, with weekly columns.

test.describe("goals revenue by customer", () => {
  test("shows both rankings, filters them by search and counts unpriced production", async ({ page }) => {
    const data = goalsPage().customerRevenue!;
    await mockGoalsApi(page);
    await gotoGoals(page);
    const section = page.getByTestId("goals-customers");
    await section.scrollIntoViewIfNeeded();
    const realized = page.getByTestId("goals-realized");
    await expect(realized).toBeVisible();
    await expect(realized.locator("tfoot")).toContainText(formatAmount(data.realized.totalCadCents));
    await expect(page.getByTestId("goals-unpriced")).toContainText("Unpriced:");
    if (data.potential.customers.length > 0) {
      await expect(page.getByTestId("goals-potential").locator("tfoot")).toContainText(formatAmount(data.potential.totalCadCents));
    }

    const top = data.realized.customers[0];
    const search = section.getByRole("searchbox", { name: "Search customers" });
    await search.fill(top.customerCode ?? top.customer ?? top.key);
    await expect(realized.locator("tbody tr")).toHaveCount(
      data.realized.customers.filter((c) =>
        `${c.customerCode ?? ""} ${c.customer ?? ""}`.toLowerCase().includes((top.customerCode ?? top.customer ?? top.key).toLowerCase())
      ).length
    );
    await search.fill("zz-no-such-customer");
    await expect(realized.locator("tbody")).toContainText("No customer matches");
  });
});