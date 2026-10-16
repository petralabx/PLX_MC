import { expect, test, type Locator, type Page } from "@playwright/test";

import { entriesWorkbook, entryRow, excelDate } from "../tests/reporting-goals-workbook";
import { ENTRIES } from "../tests/reporting-goals-helpers";

import { gotoGoals } from "./helpers/goals";
import { EntriesApi } from "./helpers/goals-entries";
import { expectSurfaceNoHorizontalOverflow } from "./helpers/ui-loop-surfaces";

// G3 for Goals & Production entries by hand (TASK-2897): at desktop, tablet and
// phone widths (393 px), light and dark, the entry actions, the entry form and
// the import preview never scroll the page sideways, and each dialog fits the
// screen (wide tables scroll inside their own region).

const SHOT_DIR = ".orchestrator/mc-brand-ui/goals";

async function expectFits(page: Page, dialog: Locator, label: string) {
  const viewport = page.viewportSize()!;
  const box = (await dialog.boundingBox())!;
  expect(box.x, `${label}: dialog starts off screen`).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, `${label}: dialog wider than the screen`).toBeLessThanOrEqual(viewport.width);
  const inner = await dialog.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
  expect(inner.scrollWidth, `${label}: dialog content overflows sideways`).toBeLessThanOrEqual(inner.clientWidth + 2);
  const page_ = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(page_.scrollWidth, `${label}: page scrolls sideways`).toBeLessThanOrEqual(page_.clientWidth + 2);
}

async function bothThemes(page: Page, dialog: Locator, label: string, shot: string) {
  for (const dark of [false, true]) {
    await page.locator(".mc").first().evaluate((el, on) => el.classList.toggle("dark", on), dark);
    await page.screenshot({ path: `${SHOT_DIR}/${shot}${dark ? "-dark" : ""}.png` });
    await expectFits(page, dialog, `${label}${dark ? "/dark" : ""}`);
  }
}

test.describe("goals entries responsive (G3)", () => {
  test.beforeEach(async ({ page }) => {
    await new EntriesApi().install(page);
    await gotoGoals(page);
    await expect(page.getByTestId("goals-card-line1")).toBeVisible();
  });

  test("entry actions and the entry form fit", async ({ page }, testInfo) => {
    await expectSurfaceNoHorizontalOverflow(page, "goals-screen", `goals-entries/${testInfo.project.name}`);
    await page.getByTestId("goals-entries").getByRole("button", { name: "Edit M003" }).click();
    const dialog = page.getByRole("dialog", { name: "Edit entry M003" });
    await dialog.getByLabel("Product value").fill("-5");
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog.getByRole("alert")).toContainText("Product value can’t be negative.");
    await bothThemes(page, dialog, `entry form/${testInfo.project.name}`, `entry-form-${testInfo.project.name}`);
  });

  test("the import preview fits", async ({ page }, testInfo) => {
    const rows = ENTRIES.map((entry) => entryRow(entry));
    rows[6][7] = 6000;
    rows.splice(2, 1);
    rows.push([null, "Shipment", excelDate("2026-10-14"), "PO-NEW-LONG-REFERENCE-0001", "Tiger Hospitality LLC DBA of A1 American", "A long product description that wraps", null, 19000, 1250, "USD"]);
    await page.getByTestId("goals-import").click();
    const dialog = page.getByRole("dialog", { name: "Import manual entries" });
    await dialog.getByLabel("Workbook (.xlsx, up to 2 MB)").setInputFiles({
      name: "PLX goals and production 2026-10-14.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: await entriesWorkbook(rows),
    });
    await expect(dialog.getByTestId("goals-import-preview")).toBeVisible();
    await bothThemes(page, dialog, `import preview/${testInfo.project.name}`, `import-preview-${testInfo.project.name}`);
  });
});
