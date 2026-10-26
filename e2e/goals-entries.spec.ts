import { expect, test, type Page } from "@playwright/test";

import { ENTRY_HEADERS, entriesWorkbook, entryRow, excelDate } from "../tests/reporting-goals-workbook";
import { ENTRIES } from "../tests/reporting-goals-helpers";

import { gotoGoals } from "./helpers/goals";
import { EntriesApi } from "./helpers/goals-entries";

// Goals & Production, entries by hand (TASK-2897) against the 2026-10-14
// fixture with M1–M7 entered: an Editor adds, edits, deletes and imports
// entries and the page follows; mistakes are announced by their fields; a
// changed header row and bad rows import nothing; Viewers get no way to write.
// The routes are served by EntriesApi (no database in the e2e server).

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const FILE = "PLX goals and production 2026-10-14.xlsx";
const table = (page: Page) => page.getByTestId("goals-entries");
const row = (page: Page, entryId: string) => table(page).locator("tbody tr").filter({ hasText: entryId });

async function open(page: Page, api = new EntriesApi()): Promise<EntriesApi> {
  await api.install(page);
  await gotoGoals(page);
  await expect(page.getByTestId("goals-card-line1")).toContainText("91,702 of 420,000 kg");
  return api;
}

async function upload(page: Page, bytes: Buffer) {
  await page.getByTestId("goals-import").click();
  const dialog = page.getByRole("dialog", { name: "Import manual entries" });
  await expect(dialog.getByLabel("Workbook (.xlsx, up to 2 MB)")).toBeFocused();
  await dialog.getByLabel("Workbook (.xlsx, up to 2 MB)").setInputFiles({ name: FILE, mimeType: XLSX, buffer: bytes });
  return dialog;
}

test.describe("goals & production: entries by hand", () => {
  test("an Editor adds a batch: it counts, in amber, and the goals follow", async ({ page }) => {
    const api = await open(page);
    await page.getByTestId("goals-add-entry").click();
    const dialog = page.getByRole("dialog", { name: "Add an entry" });
    await expect(dialog.getByRole("radio", { name: "Batch" })).toBeFocused();
    await expect(dialog.getByRole("radio", { name: "Batch" })).toBeChecked();
    await dialog.getByLabel("Date").fill("2026-10-14");
    await dialog.getByLabel("Reference").fill("BC-26299Z");
    await dialog.getByLabel("kg").fill("8,000");
    await dialog.getByRole("button", { name: "Add entry" }).click();

    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId("goals-entries-status")).toHaveText("Added M008.");
    await expect(row(page, "M008")).toHaveClass("hand");
    await expect(row(page, "M008")).toContainText("BC-26299Z");
    await expect(row(page, "M008")).toContainText("Counted");
    // 8,000 kg is Line 1: 91,702 + 8,000.
    await expect(page.getByTestId("goals-card-line1")).toContainText("99,702 of 420,000 kg");
    await expect(page.getByTestId("goals-add-entry")).toBeFocused();
    expect(api.writes()).toEqual([
      {
        method: "POST",
        path: "/api/reporting/goals/entries",
        body: {
          type: "Batch",
          date: "2026-10-14",
          reference: "BC-26299Z",
          customer: null,
          product: null,
          kg: "8000.000",
          productValue: null,
          freight: null,
          currency: null,
          note: null,
        },
      },
    ]);
  });

  test("an Editor adds a shipment, picking the customer from Sage's list", async ({ page }) => {
    const api = await open(page);
    await page.getByTestId("goals-add-entry").click();
    const dialog = page.getByRole("dialog", { name: "Add an entry" });
    await dialog.getByRole("radio", { name: "Shipment" }).check();
    await expect(dialog.getByLabel("kg")).toHaveCount(0);
    await dialog.getByLabel("Date").fill("2026-10-14");
    await expect(dialog.locator("datalist option")).toHaveCount(49);
    await dialog.getByLabel("Customer").fill("Tiger Hospitality LLC\u00a0DBA of A1 American");
    // A customer from the list brings its currency.
    await expect(dialog.getByRole("radio", { name: "USD" })).toBeChecked();
    await dialog.getByLabel("Product value").fill("$19,000");
    await dialog.getByRole("button", { name: "Add entry" }).click();
    await expect(page.getByTestId("goals-entries-status")).toHaveText("Added M008.");
    await expect(row(page, "M008")).toContainText("Full");
    await expect(page.getByTestId("goals-card-truckloads")).toContainText("2 in Sage + 2 entered by hand");
    expect(api.writes()[0].body).toMatchObject({ type: "Shipment", productValue: "19000.00", currency: "USD", kg: null });
  });

  test("mistakes are announced by their fields, nothing is sent, and the keyboard works throughout", async ({ page }) => {
    const api = await open(page);
    await page.getByTestId("goals-add-entry").focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Add an entry" });
    await expect(dialog.getByRole("radio", { name: "Batch" })).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(dialog.getByRole("radio", { name: "Shipment" })).toBeChecked();
    await dialog.getByLabel("Date").fill("2026-10-14");
    await dialog.getByLabel("Product value").fill("-5");
    await dialog.getByRole("button", { name: "Add entry" }).click();

    const alert = dialog.getByRole("alert");
    await expect(alert).toContainText("Check these 2 fields:");
    await expect(alert).toContainText("Product value can’t be negative.");
    await expect(alert).toContainText("Currency is required for a shipment: CAD or USD.");
    const value = dialog.getByLabel("Product value");
    await expect(value).toBeFocused();
    await expect(value).toHaveAttribute("aria-invalid", "true");
    await expect(value).toHaveAccessibleDescription("Before tax and freight. Product value can’t be negative.");
    await expect(dialog.getByRole("radiogroup", { name: "Currency" })).toHaveAttribute("aria-invalid", "true");
    expect(api.writes()).toEqual([]);

    // Correcting a field clears its message.
    await value.fill("500");
    await expect(value).not.toHaveAttribute("aria-invalid", "true");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId("goals-add-entry")).toBeFocused();
    expect(api.writes()).toEqual([]);
  });

  test("an Editor edits an entry and the figures follow", async ({ page }) => {
    const api = await open(page);
    await expect(page.getByTestId("goals-card-revenue")).toContainText("$390,827 of $1,000,000");
    await table(page).getByRole("button", { name: "Edit M007" }).click();
    const dialog = page.getByRole("dialog", { name: "Edit entry M007" });
    await expect(dialog.getByRole("radio", { name: "Shipment" })).toBeChecked();
    await expect(dialog.getByLabel("Reference")).toHaveValue("INV-PENDING-7");
    await expect(dialog.getByLabel("Product value")).toHaveValue("5000");
    await expect(dialog.getByRole("radio", { name: "CAD" })).toBeChecked();
    await dialog.getByLabel("Product value").fill("6000");
    await dialog.getByRole("button", { name: "Save changes" }).click();

    await expect(page.getByTestId("goals-entries-status")).toHaveText("Saved M007.");
    await expect(row(page, "M007")).toContainText("6,000.00");
    await expect(page.getByTestId("goals-card-revenue")).toContainText("$391,827 of $1,000,000");
    await expect(table(page).getByRole("button", { name: "Edit M007" })).toBeFocused();
    expect(api.writes()).toEqual([expect.objectContaining({ method: "PATCH", path: "/api/reporting/goals/entries/M007" })]);
  });

  test("an Editor deletes an entry; entries that no longer count stay, dimmed, not hidden", async ({ page }) => {
    const api = await open(page);
    await expect(table(page).locator("tbody tr")).toHaveCount(7);
    await table(page).getByRole("button", { name: "Delete M007" }).click();
    const dialog = page.getByRole("dialog", { name: "Delete entry M007?" });
    await expect(dialog).toContainText("Shipment · Oct 14 · INV-PENDING-7 · Sahajan Inc. · 5,000.00 CAD");
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
    await dialog.getByRole("button", { name: "Delete entry" }).click();

    await expect(page.getByTestId("goals-entries-status")).toHaveText("Deleted M007.");
    await expect(row(page, "M007")).toHaveCount(0);
    await expect(table(page).locator("tbody tr")).toHaveCount(6);
    await expect(table(page).locator("tbody tr.retired")).toHaveCount(3);
    for (const id of ["M004", "M005", "M006"]) await expect(row(page, id)).toBeVisible();
    await expect(page.getByTestId("goals-card-revenue")).toContainText("$385,827 of $1,000,000");
    await expect(table(page).getByRole("region", { name: "Entries by hand" })).toBeFocused();
    expect(api.writes()).toEqual([{ method: "DELETE", path: "/api/reporting/goals/entries/M007", body: {} }]);
  });

  test("an Editor imports a workbook: the preview lists additions, changes and removals, then confirm applies them", async ({ page }) => {
    const api = await open(page);
    const rows = ENTRIES.map((entry) => entryRow(entry));
    rows[6][7] = 6000; // M007: product value 5,000 → 6,000
    rows.splice(2, 1); // M003 left out
    rows.push([null, "Batch", excelDate("2026-10-14"), "BC-26299Z", null, "Lavender wash", 8000]);
    const bytes = await entriesWorkbook(rows);
    const dialog = await upload(page, bytes);

    await expect(dialog.getByRole("status")).toHaveText(`“${FILE}”: 1 to add, 1 to change, 1 to remove, 5 unchanged.`);
    await expect(dialog).toContainText("1 entry isn’t in the file and will be deleted.");
    const add = dialog.getByRole("region", { name: "To add (1)" });
    await expect(add).toContainText("Row 8");
    await expect(add).toContainText("BC-26299Z");
    await expect(add).toContainText("8,000 kg");
    await expect(add).toContainText("Counted");
    const change = dialog.getByRole("region", { name: "To change (1)" });
    await expect(change.locator("tbody th")).toHaveText(["M007"]);
    await expect(change.locator("tbody li")).toHaveText(["Product value: 5,000.00 → 6,000.00"]);
    await expect(change).toContainText("Counted");
    await expect(dialog.getByRole("region", { name: "To remove (1)" })).toContainText("M003");
    // The workbook went up whole, as base64 inside JSON.
    const sent = api.writes()[0];
    expect(sent.path).toBe("/api/reporting/goals/import");
    expect(sent.body).toMatchObject({ fileName: FILE });
    expect(Buffer.compare(Buffer.from((sent.body as { fileBase64: string }).fileBase64, "base64"), bytes)).toBe(0);
    // Nothing changed yet.
    await expect(row(page, "M003")).toHaveCount(1);

    await dialog.getByRole("button", { name: "Confirm import" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId("goals-entries-status")).toHaveText(`Imported “${FILE}”: 1 added, 1 changed, 1 removed.`);
    await expect(row(page, "M003")).toHaveCount(0);
    await expect(row(page, "M008")).toContainText("BC-26299Z");
    await expect(row(page, "M007")).toContainText("6,000.00");
    expect(api.writes().map((w) => w.path)).toEqual(["/api/reporting/goals/import", "/api/reporting/goals/import/confirm"]);
  });

  test("an unchanged export previews as nothing to change", async ({ page }) => {
    const api = await open(page);
    const dialog = await upload(page, await entriesWorkbook(ENTRIES.map((entry) => entryRow(entry))));
    await expect(dialog.getByRole("status")).toHaveText(`Nothing to change: “${FILE}” matches the 7 entries on this page.`);
    await expect(dialog.getByRole("button", { name: "Confirm import" })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Close" }).first().click();
    await expect(dialog).toHaveCount(0);
    expect(api.writes().map((w) => w.path)).toEqual(["/api/reporting/goals/import"]);
  });

  test("a changed header row is rejected and nothing is imported", async ({ page }) => {
    const api = await open(page);
    const header = [...ENTRY_HEADERS];
    header[3] = "Ref";
    const dialog = await upload(page, await entriesWorkbook(ENTRIES.map((entry) => entryRow(entry)), { header }));
    await expect(dialog.getByRole("alert")).toHaveText(
      "The header row isn’t the export’s: column D should be “Reference” but is “Ref”. Keep the header row exactly as Export to Excel writes it."
    );
    await expect(dialog.getByRole("button", { name: "Confirm import" })).toHaveCount(0);
    await expect(dialog.getByLabel("Workbook (.xlsx, up to 2 MB)")).toBeEnabled();
    expect(api.writes().map((w) => w.path)).toEqual(["/api/reporting/goals/import"]);
    await expect(table(page).locator("tbody tr")).toHaveCount(7);
  });

  test("rows with mistakes are listed by row and nothing is imported", async ({ page }) => {
    await open(page);
    const rows = ENTRIES.map((entry) => entryRow(entry));
    rows[1][6] = 0;
    rows.push([null, "Shipment", excelDate("2026-10-14"), "PO-9", null, null, 50, 100, null, "USD"]);
    const dialog = await upload(page, await entriesWorkbook(rows));
    const alert = dialog.getByRole("alert");
    await expect(alert.locator("p")).toHaveText("Nothing was imported: 2 problems on 2 rows. Fix them in the file and upload it again.");
    await expect(alert.locator("li")).toHaveText([
      "Row 3: kg must be more than 0.",
      "Row 9: kg is only for batches. Clear it, or change Type to Batch.",
    ]);
    await expect(dialog.getByRole("button", { name: "Confirm import" })).toHaveCount(0);
  });

  test("confirming after someone else changed an entry is refused, and says to upload again", async ({ page }) => {
    const api = await open(page);
    const rows = ENTRIES.map((entry) => entryRow(entry));
    rows.splice(0, 1);
    const dialog = await upload(page, await entriesWorkbook(rows));
    await expect(dialog.getByRole("region", { name: "To remove (1)" })).toContainText("M001");
    api.conflictOnConfirm = true;
    await dialog.getByRole("button", { name: "Confirm import" }).click();
    await expect(dialog.getByRole("alert")).toContainText("The entries changed since this preview");
    await expect(dialog.getByLabel("Workbook (.xlsx, up to 2 MB)")).toBeVisible();
    await expect(row(page, "M001")).toHaveCount(1);
  });

  test("Viewers see no way to change entries", async ({ page }) => {
    await open(page, new EntriesApi(ENTRIES, false));
    await expect(table(page).locator("tbody tr")).toHaveCount(7);
    for (const name of ["Add entry", "Import manual entries", "Refresh"]) {
      await expect(page.getByRole("button", { name })).toHaveCount(0);
    }
    await expect(table(page).getByRole("button")).toHaveCount(0);
  });
});
