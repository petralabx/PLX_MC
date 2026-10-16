import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { entriesWorkbook, entryRow, excelDate } from "../tests/reporting-goals-workbook";
import { ENTRIES } from "../tests/reporting-goals-helpers";

import { gotoGoals } from "./helpers/goals";
import { EntriesApi } from "./helpers/goals-entries";

// G4 for Goals & Production entries by hand (TASK-2897): zero axe violations
// with the entry form open (showing its errors), the import preview open, and
// the delete confirmation open, light and dark. No allowlist entry.

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function expectNoViolations(page: Page) {
  for (const dark of [false, true]) {
    await page.locator(".mc").first().evaluate((el, on) => el.classList.toggle("dark", on), dark);
    const results = await new AxeBuilder({ page }).include('[data-testid="goals-screen"]').withTags(TAGS).analyze();
    expect(results.violations, dark ? "dark" : "light").toEqual([]);
  }
}

test.describe("goals entries a11y (G4)", () => {
  test.beforeEach(async ({ page }) => {
    await new EntriesApi().install(page);
    await gotoGoals(page);
    await expect(page.getByTestId("goals-card-line1")).toBeVisible();
  });

  test("the entry form, with its errors showing, has no axe violations", async ({ page }) => {
    await page.getByTestId("goals-add-entry").click();
    const dialog = page.getByRole("dialog", { name: "Add an entry" });
    await dialog.getByRole("radio", { name: "Shipment" }).check();
    await dialog.getByLabel("Product value").fill("-5");
    await dialog.getByRole("button", { name: "Add entry" }).click();
    await expect(dialog.getByRole("alert")).toContainText("Check these 3 fields:");
    await expectNoViolations(page);
  });

  test("the import preview has no axe violations", async ({ page }) => {
    const rows = ENTRIES.map((entry) => entryRow(entry));
    rows[6][7] = 6000;
    rows.splice(2, 1);
    rows.push([null, "Batch", excelDate("2026-10-14"), "BC-26299Z", null, null, 8000]);
    await page.getByTestId("goals-import").click();
    const dialog = page.getByRole("dialog", { name: "Import manual entries" });
    await dialog.getByLabel("Workbook (.xlsx, up to 2 MB)").setInputFiles({
      name: "goals.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: await entriesWorkbook(rows),
    });
    await expect(dialog.getByTestId("goals-import-preview")).toBeVisible();
    await expectNoViolations(page);
  });

  test("the delete confirmation has no axe violations", async ({ page }) => {
    await page.getByTestId("goals-entries").getByRole("button", { name: "Delete M004" }).click();
    await expect(page.getByRole("dialog", { name: "Delete entry M004?" })).toBeVisible();
    await expectNoViolations(page);
  });
});
