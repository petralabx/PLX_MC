import { expect, test } from "@playwright/test";

import { waitForHydration } from "./helpers";

// EN-005 — buckets are flexible: the operator can create a new initiative from
// the sidebar, it lands optimistically, the app routes to its detail, and it
// shows up in the sidebar bucket list (the single dynamic source of truth).
test.describe("create a new initiative (EN-005)", () => {
  test("the New initiative modal creates a bucket that opens its detail + appears in the sidebar", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForHydration(page);

    // Open the modal from the sidebar "+ New initiative" affordance.
    await page.locator("nav.mc-side button", { hasText: "New initiative" }).click();
    const dialog = page.locator(".ntm[role='dialog']");
    await expect(dialog).toBeVisible();

    const name = "E2E Test Initiative";
    await dialog.locator(".ntm-title").fill(name);
    await dialog.getByRole("button", { name: /Create initiative/ }).click();

    // Routes to the new bucket's detail view (header h1 = the name).
    await expect(page.locator(".mc-main .ph h1")).toContainText(name);

    // …and the initiative is now a live row in the sidebar bucket list.
    await expect(
      page.locator("nav.mc-side button .nm", { hasText: name })
    ).toBeVisible();
  });
});
