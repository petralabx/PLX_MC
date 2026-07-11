import { expect, test } from "@playwright/test";

import { gotoProject } from "./helpers/project";

test.describe("project wiring (G2)", () => {
  test("health, owner, target, description, and initiative navigation are wired", async ({ page }) => {
    await gotoProject(page);

    await page.getByLabel("Set project health").selectOption("risk");
    await expect(page.locator(".mc .ph .r .pill", { hasText: "At risk" })).toBeVisible();

    const ownerButton = page.locator(".mc .bkfacts .ntm-field-btn");
    await ownerButton.click();
    await page.locator(".ppick .pi", { hasText: "Stephen Alton" }).click();
    await expect(ownerButton).toContainText("Stephen Alton");

    await ownerButton.click();
    await page.locator(".ppick .pi.clear").click();
    await expect(page.locator(".mc .mc-notice .body").first()).toContainText(
      "Projects require a human accountable owner."
    );

    await page.getByLabel("Set target").fill("Dec 31");
    await page.getByLabel("Set target").press("Enter");
    await expect(page.getByLabel("Set target")).toHaveValue("Dec 31");

    await page.getByLabel("Set target").fill("");
    await page.getByLabel("Set target").press("Enter");
    await expect(page.getByLabel("Set target")).toHaveValue("—");

    // Description save: the e2e server runs DB-less, so the PATCH mirror fails
    // by design — the contract under test is optimistic apply → visible
    // (never silent) rollback notice → reverted text. Asserting persistence
    // here was a race against the rollback (flaked once the screen grew).
    await page.locator(".mc .ph .tl-link", { hasText: "Edit" }).click();
    await page.getByLabel("Edit project description").fill("Hardening updated this project description.");
    await page.locator(".mc .ph .desc-edit-acts .btn", { hasText: "Save" }).click();
    await expect(
      page.locator(".mc .mc-notice .body", { hasText: "rolled back" }).first()
    ).toBeVisible();
    await expect(page.locator(".mc .ph .sub")).toContainText(
      "Umbrella project for all PLX Portal go-live initiatives."
    );

    // Cancel discards the draft without touching the description.
    await page.locator(".mc .ph .tl-link", { hasText: "Edit" }).click();
    await page.getByLabel("Edit project description").fill("Discard this draft.");
    await page.locator(".mc .ph .desc-edit-acts .btn", { hasText: "Cancel" }).click();
    await expect(page.locator(".mc .ph .sub")).toContainText(
      "Umbrella project for all PLX Portal go-live initiatives."
    );

    // Overview lens (default): section collapse toggles, "Open →" reaches
    // bucket detail, and the lens switcher swaps to the card grid.
    const firstToggle = page.locator(".mc .pv-sec-toggle").first();
    await expect(firstToggle).toHaveAttribute("aria-expanded", "true");
    await firstToggle.click();
    await expect(firstToggle).toHaveAttribute("aria-expanded", "false");
    await firstToggle.click();
    await expect(firstToggle).toHaveAttribute("aria-expanded", "true");

    await page.locator(".mc .ph .pv-seg button", { hasText: "Initiatives" }).click();
    await page.locator(".mc .init-grid .init-card").first().click();
    await expect(page.locator(".mc .ph .kk", { hasText: "Initiative ·" })).toBeVisible();

    // Back on the project, the Overview "Open →" link reaches bucket detail too.
    await page.locator(".mc .ph .back").click();
    await page.locator(".mc .mc-side .grp button", { hasText: "PLX Portal Go-Live" }).click();
    // Dismiss any queued rollback toasts first — the notice host floats over
    // the section header rail and would intercept the click. Re-query each
    // pass: dismissing one removes it from the DOM, so a snapshot goes stale.
    while ((await page.locator(".mc .mc-notice .x").count()) > 0) {
      await page.locator(".mc .mc-notice .x").first().click();
    }
    await page.locator(".mc .pv-open").first().click();
    await expect(page.locator(".mc .ph .kk", { hasText: "Initiative ·" })).toBeVisible();
  });
});
