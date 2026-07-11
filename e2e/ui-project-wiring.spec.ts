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

    await page.locator(".mc .ph .tl-link", { hasText: "Edit" }).click();
    await page.getByLabel("Edit project description").fill("Hardening updated this project description.");
    await page.locator(".mc .ph .desc-edit-acts .btn", { hasText: "Save" }).click();
    await expect(page.locator(".mc .ph .sub")).toContainText("Hardening updated this project description.");

    await page.locator(".mc .ph .tl-link", { hasText: "Edit" }).click();
    await page.getByLabel("Edit project description").fill("Discard this draft.");
    await page.locator(".mc .ph .desc-edit-acts .btn", { hasText: "Cancel" }).click();
    await expect(page.locator(".mc .ph .sub")).toContainText("Hardening updated this project description.");

    await page.locator(".mc .init-grid .init-card").first().click();
    await expect(page.locator(".mc .ph .kk", { hasText: "Initiative ·" })).toBeVisible();
  });
});
