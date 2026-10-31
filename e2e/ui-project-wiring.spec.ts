import { expect, test } from "@playwright/test";

import { gotoProject } from "./helpers/project";

test.describe("project wiring (G2)", () => {
  test("health, owner, target, description, and initiative navigation are wired", async ({ page }) => {
    // The e2e server runs DB-less, so every project save fails and rolls back. Each save is held
    // here until the optimistic value has been checked, then let through (TASK-4393): otherwise a
    // fast failure rolls the field back before the check reads it.
    let hold = true;
    const held: Array<() => void> = [];
    await page.route("**/api/projects/**", async (route) => {
      if (route.request().method() !== "PATCH" || !hold) return route.fallback();
      await new Promise<void>((go) => held.push(go));
      return route.fallback();
    });
    const letSavesThrough = async () => {
      await expect.poll(() => held.length).toBeGreaterThan(0);
      held.splice(0).forEach((go) => go());
    };

    await gotoProject(page);

    await page.getByLabel("Set project health").selectOption("risk");
    await expect(page.locator(".mc .ph .r .pill", { hasText: "At risk" })).toBeVisible();
    await letSavesThrough();

    const ownerButton = page.locator(".mc .pv-strip .ntm-field-btn");
    await ownerButton.click();
    await page.locator(".ppick .pi", { hasText: "Stephen Alton" }).click();
    await expect(ownerButton).toContainText("Stephen Alton");
    await letSavesThrough();

    await ownerButton.click();
    await page.locator(".ppick .pi.clear").click();
    await expect(page.locator(".mc .mc-notice .body").first()).toContainText(
      "Projects require a human accountable owner."
    );

    const target = page.getByLabel("Set target");
    const prior = await target.inputValue();
    await target.fill("Dec 31");
    await target.press("Enter");
    await expect(target).toHaveValue("Dec 31");
    await letSavesThrough();
    // The failed save rolls back, and says so.
    await expect(target).toHaveValue(prior);
    await expect(page.locator(".mc .mc-notice .body", { hasText: "rolled back" }).first()).toBeVisible();

    await target.fill("");
    await target.press("Enter");
    await expect(target).toHaveValue("—");
    await letSavesThrough();
    await expect(target).toHaveValue(prior);
    hold = false;

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
    const firstToggle = page.locator(".mc .pv-sec-chev").first();
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
    await page.locator(".mc .mc-side .grp a", { hasText: "PLX Portal Go-Live" }).click();
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
