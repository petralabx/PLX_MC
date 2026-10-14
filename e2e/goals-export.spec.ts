import { readFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";
import ExcelJS from "exceljs";

import { XLSX_CONTENT_TYPE } from "../src/lib/reporting/goals/excel/export";
import { goalsPage, gotoGoals, mockGoalsApi } from "./helpers/goals";

// Export to Excel on the Goals & Production page (TASK-2898): Viewers and
// Editors download the workbook under the dated name the route suggests, by
// mouse or keyboard, with progress and failures in the status line. The e2e
// server has no database, so the route is stubbed with a small workbook; the
// real one is tested in tests/reporting-goals-export*.test.ts.

const FILE = "PLX goals and production 2026-10-14.xlsx";
const status = (page: Page) => page.locator("#goals-refresh-status");
const exportButton = (page: Page) => page.getByRole("button", { name: "Export to Excel" });

async function smallWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet("Read me").getCell("A1").value = "PLX goals & production — October 2026";
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Serves the workbook once `ready` resolves (immediately by default). */
async function serveExport(page: Page, body: Buffer, ready: Promise<void> = Promise.resolve()): Promise<void> {
  await page.route("**/api/reporting/goals/export", async (route) => {
    await ready;
    await route.fulfill({
      status: 200,
      headers: { "content-type": XLSX_CONTENT_TYPE, "content-disposition": `attachment; filename="${FILE}"` },
      body,
    });
  });
}

test.describe("goals export to Excel", () => {
  test("a Viewer downloads the workbook under its dated name, seeing progress meanwhile", async ({ page }) => {
    await mockGoalsApi(page, goalsPage({ viewer: { editor: false } }));
    const body = await smallWorkbook();
    let release!: () => void;
    await serveExport(page, body, new Promise<void>((resolve) => (release = resolve)));
    await gotoGoals(page);
    await expect(page.getByRole("button", { name: "Refresh" })).toHaveCount(0);

    await exportButton(page).click();
    await expect(page.getByRole("button", { name: "Exporting…" })).toBeDisabled();
    await expect(status(page)).toHaveText("Preparing the Excel workbook…");
    const downloading = page.waitForEvent("download");
    release();
    const download = await downloading;
    expect(download.suggestedFilename()).toBe(FILE);
    expect(readFileSync(await download.path())).toEqual(body);
    await expect(status(page)).toHaveText(`Downloaded ${FILE}.`);
    await expect(exportButton(page)).toBeEnabled();
  });

  test("an Editor exports from the keyboard, next to Refresh", async ({ page }) => {
    await mockGoalsApi(page);
    await serveExport(page, await smallWorkbook());
    await gotoGoals(page);
    await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();
    await exportButton(page).focus();
    const downloading = page.waitForEvent("download");
    await page.keyboard.press("Enter");
    expect((await downloading).suggestedFilename()).toBe(FILE);
  });

  test("a failed export says why, and the button works again", async ({ page }) => {
    await mockGoalsApi(page);
    await page.route("**/api/reporting/goals/export", (route) =>
      route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({
          error: { code: "no_data", message: "There’s nothing to export yet: the report fills in after its first refresh." },
        }),
      })
    );
    await gotoGoals(page);
    await exportButton(page).click();
    await expect(status(page)).toHaveText(
      "The export failed: There’s nothing to export yet: the report fills in after its first refresh."
    );
    await expect(exportButton(page)).toBeEnabled();
  });

  test("offers no export before the report has data", async ({ page }) => {
    const empty = { ...goalsPage(), state: "no_data" as const, run: null, model: null, settings: null, fx: null, latestAttempt: null };
    await mockGoalsApi(page, empty);
    await gotoGoals(page);
    await expect(page.getByTestId("goals-not-ready")).toContainText("No data yet");
    await expect(exportButton(page)).toHaveCount(0);
  });
});
