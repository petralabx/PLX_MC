// Goals & Production workbook (TASK-2898), built from the 2026-10-14 fixture
// with and without M1–M7 and read back with exceljs: the eight sheets in the
// shared order, the house styles, real dates and number formats, formulas
// wherever the brief derives a value, amber for everything entered by hand,
// and the "Manual entries" import template. LibreOffice then recalculates it:
// no formula errors, and the brief's totals (Goals!G8 = 367,014.16). That test
// skips, saying why, where soffice isn't installed (CI). The route is in
// tests/reporting-goals-export-route.test.ts.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import ExcelJS from "exceljs";
import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({ succeeded: null as unknown }));
vi.mock("@/lib/secrets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/secrets")>()),
  databaseConfigured: () => true,
  reportingDatabaseConfigured: () => true,
}));
vi.mock("@/lib/reporting/goals/store", async () => {
  const h = await import("./reporting-goals-helpers");
  return {
    latestRuns: vi.fn(async () => ({ succeeded: store.succeeded, latest: store.succeeded })),
    loadConfig: vi.fn(async () => ({ settings: h.SETTINGS, ftlCustomers: h.FTL_CUSTOMERS, holidays: h.HOLIDAYS })),
    loadSnapshot: vi.fn(async () => h.DATASETS),
    listEntries: vi.fn(async () => h.ENTRIES),
    loadRates: vi.fn(async () => [{ date: h.TODAY, rate: h.RATE }]),
    loadReferenceMatches: vi.fn(async (_runId: number, refs: string[]) => ({
      filemaker: new Set(refs.filter((r) => h.refsOf("filemaker").has(r))),
      sage: new Set(refs.filter((r) => h.refsOf("sage").has(r))),
    })),
  };
});
vi.mock("@/lib/reporting/goals/forecast-store", async () => {
  const h = await import("./reporting-goals-helpers");
  return { loadForecast: vi.fn(async () => h.FORECAST) };
});

import {
  AMBER_FILL,
  AMBER_FONT,
  COUNT_FORMAT,
  DOLLAR_FORMAT,
  ENTRY_COLUMNS,
  ENTRY_LAST_FORMATTED_ROW,
  HEADER_FILL,
  WORKBOOK_SHEETS,
  buildGoalsWorkbook,
  centsToDecimal,
  loadGoalsExport,
  loadGoalsView,
  type GoalsModel,
  type ManualEntry,
} from "@/lib/reporting/goals";
import { loadSnapshot } from "@/lib/reporting/goals/store";

import { DATASETS, ENTRIES, RATE, RUN, SETTINGS, TODAY, goalsPage } from "./reporting-goals-helpers";

const EXPORTED_AT = new Date("2026-10-14T14:42:00Z");
const DATE_FORMAT = "yyyy-mm-dd";

interface Built {
  buffer: Buffer;
  wb: ExcelJS.Workbook;
  model: GoalsModel;
}

async function build(entries: ManualEntry[] = ENTRIES): Promise<Built> {
  const model = goalsPage({}, entries).model!;
  const buffer = await buildGoalsWorkbook({
    run: RUN,
    model,
    settings: SETTINGS,
    shipments: DATASETS.shipments,
    truckloads: DATASETS.truckloads,
    rates: [{ date: TODAY, rate: RATE }],
    exportedAt: EXPORTED_AT,
  });
  return { buffer, wb: await readXlsx(buffer), model };
}

/** .xlsx bytes read back with exceljs (its load() is typed for an ArrayBuffer, so copy into one). */
async function readXlsx(bytes: Uint8Array): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(new Uint8Array(bytes).buffer);
  return wb;
}

const sheet = (wb: ExcelJS.Workbook, name: string) => wb.getWorksheet(name)!;
const fillOf = (cell: ExcelJS.Cell) => (cell.fill?.type === "pattern" ? cell.fill.fgColor?.argb : undefined);
const isAmber = (cell: ExcelJS.Cell) => fillOf(cell) === AMBER_FILL && cell.font?.color?.argb === AMBER_FONT;
const formulaOf = (cell: ExcelJS.Cell) =>
  cell.value !== null && typeof cell.value === "object" && "formula" in cell.value ? cell.value.formula : undefined;
const utcDay = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("the workbook", () => {
  it("has the eight sheets in the shared order, set to recalculate on open", async () => {
    const { wb, buffer } = await build();
    expect(wb.worksheets.map((ws) => ws.name)).toEqual([...WORKBOOK_SHEETS]);
    // exceljs reads calcPr back without its attributes, so look at the file itself
    // (jszip is exceljs's own zip library).
    const workbookXml = await (await JSZip.loadAsync(buffer)).file("xl/workbook.xml")!.async("string");
    expect(workbookXml).toMatch(/<calcPr[^>]*\bfullCalcOnLoad="1"/);
  });

  it("is Arial 10 throughout, with 14-point bold titles", async () => {
    const { wb } = await build();
    const titles = new Set(["Read me!A1", "Goals!A1", "Forecast!A1"]);
    for (const ws of wb.worksheets) {
      ws.eachRow((row) =>
        row.eachCell((cell) => {
          const where = `${ws.name}!${cell.address}`;
          expect(cell.font?.name, where).toBe("Arial");
          expect(cell.font?.size, where).toBe(titles.has(where) ? 14 : 10);
          if (titles.has(where)) expect(cell.font?.bold, where).toBe(true);
        })
      );
      // Typed-in cells pick up the column style too.
      expect(ws.getColumn(1).font).toMatchObject({ name: "Arial", size: 10 });
    }
  });

  it("puts every header row in bold on light grey (amber for columns entered by hand) and freezes it", async () => {
    const { wb } = await build();
    const headerRows: Record<string, number> = { Goals: 4, Daily: 1, Truckloads: 1, Batches: 1, Shipments: 1, "Manual entries": 1 };
    for (const [name, row] of Object.entries(headerRows)) {
      const ws = sheet(wb, name);
      expect(ws.views[0], name).toMatchObject({ state: "frozen", ySplit: row });
      ws.getRow(row).eachCell((cell) => {
        expect(cell.font?.bold, `${name}!${cell.address}`).toBe(true);
        expect([HEADER_FILL, AMBER_FILL], `${name}!${cell.address}`).toContain(fillOf(cell));
      });
    }
    const amberHeaders = (name: string, row: number) => {
      const out: string[] = [];
      sheet(wb, name).getRow(row).eachCell((cell) => {
        if (isAmber(cell)) out.push(String(cell.value));
      });
      return out;
    };
    expect(amberHeaders("Goals", 4)).toEqual(["By hand"]);
    expect(amberHeaders("Daily", 1)).toEqual(["Line 1 kg done (by hand)", "Revenue by hand, CAD"]);
    expect(amberHeaders("Truckloads", 1)).toEqual(["Full loads (by hand)", "Partial loads (by hand)", "Product US$ (by hand)"]);
    // The import template: every column is entered by hand except the computed status.
    expect(amberHeaders("Manual entries", 1)).toEqual(ENTRY_COLUMNS.filter((c) => c.key !== "status").map((c) => c.header));
  });

  it("uses real dates and the house number formats", async () => {
    const { wb } = await build();
    const daily = sheet(wb, "Daily");
    expect(daily.getCell("A2").value).toEqual(utcDay("2026-10-01"));
    expect(daily.getCell("A2").numFmt).toBe(DATE_FORMAT);
    expect(daily.getCell("A32").value).toEqual(utcDay("2026-10-31"));
    expect(daily.getCell("C15").numFmt).toBe(COUNT_FORMAT);
    expect(daily.getCell("F3")).toMatchObject({ value: 26981.2, numFmt: DOLLAR_FORMAT });
    const goals = sheet(wb, "Goals");
    expect(goals.getCell("D5").value).toEqual(utcDay("2026-10-14"));
    expect(goals.getCell("B13")).toMatchObject({ value: 20_000, numFmt: COUNT_FORMAT });
    expect(goals.getCell("B14")).toMatchObject({ value: 5000, numFmt: COUNT_FORMAT });
    expect(goals.getCell("I5").numFmt).toBe(COUNT_FORMAT);
    expect(goals.getCell("B16")).toMatchObject({ value: 1_000_000, numFmt: DOLLAR_FORMAT });
    expect(goals.getCell("B17")).toMatchObject({ value: 1.4219, numFmt: "0.0000" });
    expect(goals.getCell("B18").value).toEqual(utcDay("2026-10-14"));
    const batches = sheet(wb, "Batches");
    expect(batches.getCell("D2").value).toBeInstanceOf(Date);
    expect(batches.getCell("E2").numFmt).toBe(COUNT_FORMAT);
    const entries = sheet(wb, "Manual entries");
    expect(entries.getCell("C2").value).toEqual(utcDay("2026-10-13"));
    expect(entries.getCell("H4")).toMatchObject({ value: 24500, numFmt: DOLLAR_FORMAT });
  });
});

describe("Goals", () => {
  it("states each goal with the brief's formulas over the assumptions block", async () => {
    const { wb } = await build();
    const goals = sheet(wb, "Goals");
    expect(goals.getCell("A1").value).toBe("Goals — October 2026");
    expect((goals.getRow(4).values as unknown[]).slice(1)).toEqual([
      "Goal",
      "Target this month",
      "Due so far",
      "Due by",
      "In system",
      "By hand",
      "Total",
      "Status",
      "Needed per working day from today",
    ]);
    const formulas: Record<string, string> = {
      B5: "B13*B11",
      C5: "B13*B20",
      E5: "Daily!C33",
      F5: "Daily!D33",
      E6: "Truckloads!B7",
      F6: "Truckloads!E7",
      E7: "Truckloads!C7",
      F7: "Truckloads!F7",
      B8: "B16",
      C8: "ROUND(B16*B21/B11,2)",
      E8: "ROUND(Daily!F33+Daily!G33*B17,2)",
      F8: "Daily!H33",
    };
    for (const row of [5, 6, 7, 8]) {
      formulas[`G${row}`] = `E${row}+F${row}`;
      expect(isAmber(goals.getCell(`F${row}`)), `F${row}`).toBe(true);
      expect(isAmber(goals.getCell(`E${row}`)), `E${row}`).toBe(false);
    }
    for (const row of [5, 8]) {
      formulas[`H${row}`] = `IF(G${row}>=C${row},"On track","Behind")`;
      formulas[`I${row}`] = `IF($B$12>0,MAX(0,B${row}-G${row})/$B$12,0)`;
    }
    for (const [address, formula] of Object.entries(formulas)) expect(formulaOf(goals.getCell(address)), address).toBe(formula);
    expect(goals.getCell("A5").value).toBe("Line 1 bulk, kg (batches of 5,000 kg or more)");
    expect(goals.getCell("B6").value).toBe("No target set");
  });

  it("has no large-batch figure, column or definition left on any sheet", async () => {
    const { wb } = await build();
    const found: string[] = [];
    for (const ws of wb.worksheets) {
      ws.eachRow((row) =>
        row.eachCell((cell) => {
          if (/large|7,?500/i.test(String(cell.value ?? ""))) found.push(`${ws.name}!${cell.address}`);
        })
      );
    }
    expect(found).toEqual([]);
  });

  it("holds the inputs the formulas use: the calendar, the goals, the rate and both cutoffs", async () => {
    const { wb, model } = await build();
    const goals = sheet(wb, "Goals");
    const inputs = Object.fromEntries([...Array(11)].map((_, i) => [goals.getCell(`A${11 + i}`).value, goals.getCell(`B${11 + i}`).value]));
    expect(inputs).toEqual({
      "Working days this month": 21,
      "Working days left, from today": 13,
      "Line 1 bulk per working day, kg (target)": 20_000,
      "Line 1 minimum batch, kg": 5000,
      "Full truckload minimum, US$ before tax and freight": 18000,
      "Revenue target, CAD": 1_000_000,
      "USD/CAD rate": 1.4219,
      "FileMaker data through": utcDay("2026-10-14"),
      "Sage data through": utcDay("2026-10-14"),
      "Working days covered, production": 9,
      "Working days covered, revenue": 9,
    });
    expect(goals.getCell("C17").value).toBe("Bank of Canada daily rate (FXUSDCAD) for 2026-10-13");
    expect(goals.getCell("C14").value).toBe("A batch of this many kg or more is assumed to run on Line 1");
    expect(goals.getCell("C20").value).toBe("To 2026-10-14: FileMaker’s data, or a later Line 1 batch entered by hand");
    // "Due so far" (=B13*B20) recomputes from these exactly as the model did.
    expect(Number(inputs["Line 1 bulk per working day, kg (target)"]) * Number(inputs["Working days covered, production"])).toBe(
      model.line1.dueSoFarKg
    );
  });

  it("shows a truckload target when the business sets one", async () => {
    const model = goalsPage({}, []).model!;
    const buffer = await buildGoalsWorkbook({
      run: RUN,
      model,
      settings: { ...SETTINGS, fullTruckloadsPerMonth: 8 },
      shipments: DATASETS.shipments,
      truckloads: DATASETS.truckloads,
      rates: [],
      exportedAt: EXPORTED_AT,
    });
    const wb = await readXlsx(buffer);
    expect(sheet(wb, "Goals").getCell("B6")).toMatchObject({ value: 8, numFmt: COUNT_FORMAT });
  });
});

describe("Daily, Truckloads and Batches", () => {
  it("Daily: one row per day of the month with Line 1 kg and the brief's running revenue, then SUM totals", async () => {
    const { wb, model } = await build();
    const daily = sheet(wb, "Daily");
    expect(model.daily).toHaveLength(31);
    expect((daily.getRow(1).values as unknown[]).slice(3, 6)).toEqual([
      "Line 1 kg done (FileMaker)",
      "Line 1 kg done (by hand)",
      "Line 1 kg still scheduled",
    ]);
    model.daily.forEach((day, i) => {
      const r = 2 + i;
      expect(daily.getCell(`A${r}`).value).toEqual(utcDay(day.day));
      expect(daily.getCell(`B${r}`).value).toBe(day.isWorkingDay ? "Yes" : "No");
      expect(daily.getCell(`C${r}`)).toMatchObject({ value: day.line1DoneKg, numFmt: COUNT_FORMAT });
      expect(daily.getCell(`D${r}`).value).toBe(day.line1ByHandKg);
      expect(daily.getCell(`E${r}`).value).toBe(day.line1ScheduledKg);
      expect(daily.getCell(`H${r}`).value).toBe(day.byHandCadCents / 100);
      expect(isAmber(daily.getCell(`D${r}`)) && isAmber(daily.getCell(`H${r}`))).toBe(true);
      expect(isAmber(daily.getCell(`C${r}`)) || isAmber(daily.getCell(`F${r}`))).toBe(false);
      expect(formulaOf(daily.getCell(`I${r}`))).toBe(`SUM($F$2:F${r})+SUM($G$2:G${r})*Goals!$B$17+SUM($H$2:H${r})`);
      expect(formulaOf(daily.getCell(`J${r}`))).toBe(`ROUND(Goals!$B$16*COUNTIF($B$2:B${r},"Yes")/Goals!$B$11,2)`);
    });
    expect(daily.getCell("A33").value).toBe("Total");
    for (const col of ["C", "D", "E", "F", "G", "H"]) expect(formulaOf(daily.getCell(`${col}33`)), col).toBe(`SUM(${col}2:${col}32)`);
    // Oct 13: BC-26286C (10,000 kg) was scheduled, and M1 completed it by hand with 10,050 kg.
    expect(daily.getCell("D14").value).toBe(10_050);
    expect(daily.getCell("E14").value).toBe(18_000);
    expect(daily.getCell("H15").value).toBe(41613.92);
  });

  it("Truckloads: one row per truckload customer, totals and the full-total column as formulas", async () => {
    const { wb, model } = await build();
    const trucks = sheet(wb, "Truckloads");
    const customers = model.truckloads.customers;
    customers.forEach((c, i) => {
      const r = 2 + i;
      expect(trucks.getCell(`A${r}`).value).toBe(c.name);
      expect([trucks.getCell(`B${r}`).value, trucks.getCell(`E${r}`).value, trucks.getCell(`I${r}`).value]).toEqual([
        c.thisMonth.full,
        c.byHand.full,
        c.lastMonth.full,
      ]);
      expect(formulaOf(trucks.getCell(`H${r}`))).toBe(`B${r}+E${r}`);
      for (const col of ["E", "F", "G"]) expect(isAmber(trucks.getCell(`${col}${r}`)), `${col}${r}`).toBe(true);
    });
    const total = 2 + customers.length;
    for (const col of ["B", "C", "D", "E", "F", "G", "H", "I", "J", "K"]) {
      expect(formulaOf(trucks.getCell(`${col}${total}`)), col).toBe(`SUM(${col}2:${col}${total - 1})`);
    }
    expect(String(trucks.getCell(`A${total + 2}`).value)).toContain("(Goals!B15)");
  });

  it("Truckloads: with no truckload customers configured, the totals are zeros, not sums that cover themselves", async () => {
    const page = goalsPage();
    const model = { ...page.model!, truckloads: { ...page.model!.truckloads, customers: [] } };
    const buffer = await buildGoalsWorkbook({
      run: RUN,
      model,
      settings: SETTINGS,
      shipments: DATASETS.shipments,
      truckloads: DATASETS.truckloads,
      rates: [{ date: TODAY, rate: RATE }],
      exportedAt: EXPORTED_AT,
    });
    const trucks = sheet(await readXlsx(buffer), "Truckloads");
    expect(trucks.getCell("A2").value).toBe("All truckload customers");
    for (const col of ["B", "C", "D", "E", "F", "G", "H", "I", "J", "K"]) {
      expect([formulaOf(trucks.getCell(`${col}2`)), trucks.getCell(`${col}2`).value], col).toEqual([undefined, 0]);
    }
  });

  it("Batches: the model's batch list grouped by stage, Line 1 as a formula, hand entries in amber", async () => {
    const { wb, model } = await build();
    const batches = sheet(wb, "Batches");
    expect((batches.getRow(1).values as unknown[]).slice(1)).toEqual([
      "Batch",
      "Product",
      "Stage",
      "Date",
      "kg",
      "Size band",
      "Line 1 (5,000 kg+)",
      "Line",
      "Status",
      "Source",
    ]);
    expect(batches.rowCount).toBe(1 + model.batches.length);
    const stages: string[] = [];
    const byHand: string[] = [];
    for (let r = 2; r <= batches.rowCount; r += 1) {
      const stage = String(batches.getCell(`C${r}`).value);
      if (stages[stages.length - 1] !== stage) stages.push(stage);
      expect(formulaOf(batches.getCell(`G${r}`))).toBe(`IF(E${r}>=Goals!$B$14,"Yes","")`);
      const hand = batches.getCell(`J${r}`).value === "By hand";
      if (hand) byHand.push(String(batches.getCell(`A${r}`).value));
      for (const col of ["A", "E", "G", "J"]) expect(isAmber(batches.getCell(`${col}${r}`)), `${col}${r}`).toBe(hand);
    }
    expect(stages).toEqual(["Completed", "Completed (by hand)", "Open past date", "Scheduled"]);
    expect(byHand.sort()).toEqual(["BC-26286C", "BC-26290X"]);
  });
});

describe("Shipments", () => {
  it("lists this month's Sage invoices, marking the truckload ones as the model counted them", async () => {
    const { wb, model } = await build([]);
    const ships = sheet(wb, "Shipments");
    expect(ships.rowCount).toBe(1 + DATASETS.shipments.length);
    const full = new Set<string>();
    DATASETS.shipments.forEach((s, i) => {
      const r = 2 + i;
      expect(ships.getCell(`B${r}`).value).toBe(s.invoice);
      expect(ships.getCell(`A${r}`).value).toEqual(utcDay(s.shipDate));
      expect(ships.getCell(`L${r}`).value).toBe("Sage");
      expect(isAmber(ships.getCell(`B${r}`))).toBe(false);
      if (ships.getCell(`K${r}`).value === "Full") full.add(`${s.customerCode}|${s.shipment}`);
      else expect(ships.getCell(`K${r}`).value, s.invoice).toBeNull();
    });
    expect(full.size).toBe(model.truckloads.full.inSystem);
    expect([...full].sort()).toEqual(["A1TEXT11|SH1000085508", "DIVE11|SH1000085509"]);
    // A1 American's billing name keeps its no-break space.
    expect(ships.getCell("F54").value).toBe("Tiger Hospitality LLC DBA of A1 American");
  });

  it("then every shipment entered by hand, counted or not, with its status, in amber", async () => {
    const { wb } = await build();
    const ships = sheet(wb, "Shipments");
    const rows = [];
    for (let r = 2 + DATASETS.shipments.length; r <= ships.rowCount; r += 1) {
      for (let col = 1; col <= 13; col += 1) expect(isAmber(ships.getCell(r, col)), `${r}:${col}`).toBe(true);
      expect(formulaOf(ships.getCell(`J${r}`))).toBe(`H${r}+I${r}`);
      rows.push([ships.getCell(`L${r}`).value, ships.getCell(`B${r}`).value, ships.getCell(`K${r}`).value, ships.getCell(`M${r}`).value]);
    }
    expect(rows).toEqual([
      ["By hand (M006)", "PSP-0930", null, "Not this month"],
      ["By hand (M004)", "IN1000180418", null, "In Sage now"],
      ["By hand (M003)", "PO0104001", "Full", "Counted"],
      ["By hand (M007)", "INV-PENDING-7", null, "Counted"],
    ]);
  });
});

describe("Manual entries (the import template)", () => {
  it("has exactly the shared columns, the entries in amber, then formatted rows with the lists to row 200", async () => {
    const { wb, model } = await build();
    const ws = sheet(wb, "Manual entries");
    expect((ws.getRow(1).values as unknown[]).slice(1)).toEqual(ENTRY_COLUMNS.map((c) => c.header));
    expect(ws.getRow(1).cellCount).toBe(ENTRY_COLUMNS.length);
    const col = (key: string) => ENTRY_COLUMNS.findIndex((c) => c.key === key) + 1;

    model.entries.forEach((entry, i) => {
      const r = 2 + i;
      expect(ws.getCell(r, col("entryId")).value).toBe(entry.entryId);
      expect(ws.getCell(r, col("type")).value).toBe(entry.type);
      expect(ws.getCell(r, col("date")).value).toEqual(entry.date ? utcDay(entry.date) : null);
      expect(ws.getCell(r, col("reference")).value).toBe(entry.reference);
      expect(ws.getCell(r, col("kg")).value).toBe(entry.kg === null ? null : Number(entry.kg));
      expect(ws.getCell(r, col("productValue")).value).toBe(entry.productValue === null ? null : Number(entry.productValue));
      expect(ws.getCell(r, col("freight")).value).toBe(entry.freight === null ? null : Number(entry.freight));
      expect(ws.getCell(r, col("currency")).value).toBe(entry.currency);
      expect(ws.getCell(r, col("enteredBy")).value).toBe(entry.enteredBy);
      expect(ws.getCell(r, col("status")).value).toBe(entry.statusLabel);
      for (const c of ENTRY_COLUMNS) expect(isAmber(ws.getCell(r, col(c.key))), `${c.key} ${r}`).toBe(c.key !== "status");
    });
    expect(ws.getCell("A2").value).toBe("M001");
    expect(ws.getCell("M5").value).toBe("In Sage now");

    const blank = 2 + model.entries.length;
    for (const r of [blank, ENTRY_LAST_FORMATTED_ROW]) {
      expect(ws.getCell(r, col("entryId")).value, `row ${r}`).toBeNull();
      expect(isAmber(ws.getCell(r, col("type"))), `row ${r}`).toBe(false);
      expect(ws.getCell(r, col("date")).numFmt).toBe(DATE_FORMAT);
      expect(ws.getCell(r, col("kg")).numFmt).toBe(COUNT_FORMAT);
      expect(ws.getCell(r, col("productValue")).numFmt).toBe(DOLLAR_FORMAT);
      expect(ws.getCell(r, col("freight")).numFmt).toBe(DOLLAR_FORMAT);
    }
    expect(ws.rowCount).toBe(ENTRY_LAST_FORMATTED_ROW);
    for (const r of [2, blank, ENTRY_LAST_FORMATTED_ROW]) {
      expect(ws.getCell(r, col("type")).dataValidation, `type ${r}`).toMatchObject({ type: "list", formulae: ['"Batch,Shipment"'] });
      expect(ws.getCell(r, col("currency")).dataValidation, `currency ${r}`).toMatchObject({ type: "list", formulae: ['"CAD,USD"'] });
    }
    expect(ws.getCell(ENTRY_LAST_FORMATTED_ROW + 1, col("type")).dataValidation).toBeUndefined();
    expect(ws.getCell(2, col("reference")).dataValidation).toBeUndefined();
  });

  it("is a blank template with its lists when there are no entries", async () => {
    const { wb } = await build([]);
    const ws = sheet(wb, "Manual entries");
    expect(ws.getCell("A2").value).toBeNull();
    expect(isAmber(ws.getCell("A2"))).toBe(false);
    expect(ws.getCell("B2").dataValidation).toMatchObject({ formulae: ['"Batch,Shipment"'] });
    expect(ws.getCell(`J${ENTRY_LAST_FORMATTED_ROW}`).dataValidation).toMatchObject({ formulae: ['"CAD,USD"'] });
  });
});

describe("Read me", () => {
  it("names the export time, the run and both cutoffs, the colour, the steps and two format-only examples", async () => {
    const { wb } = await build();
    const ws = sheet(wb, "Read me");
    const text = (r: number) => String(ws.getCell(`A${r}`).value ?? "");
    expect(text(1)).toBe("PLX goals & production — October 2026");
    expect(text(2)).toBe(
      "Exported 2026-10-14 10:42 (Toronto time) from refresh run #41 of 2026-10-14 06:00. FileMaker data through 2026-10-14, Sage through 2026-10-14."
    );
    expect(isAmber(ws.getCell("A5"))).toBe(true);
    const lines = [...Array(ws.rowCount)].map((_, i) => text(i + 1));
    expect(lines.filter((l) => /^\d\. /.test(l)).map((l) => l.slice(0, 2))).toEqual(["1.", "2.", "3.", "4.", "5."]);
    expect(lines.join("\n")).toContain("Import manual entries");
    expect(lines.join("\n")).toContain("4. Batch: fill in kg (5,000 kg or more counts toward Line 1).");
    const examples = lines.indexOf("Example rows (format only; not imported)") + 1;
    expect(examples).toBeGreaterThan(0);
    const header = (ws.getRow(examples + 1).values as unknown[]).slice(1);
    expect(header).toEqual(ENTRY_COLUMNS.filter((c) => c.key !== "status").map((c) => c.header));
    expect([ws.getCell(examples + 2, 2).value, ws.getCell(examples + 3, 2).value]).toEqual(["Batch", "Shipment"]);
    expect(isAmber(ws.getCell(examples + 2, 4)) && isAmber(ws.getCell(examples + 3, 8))).toBe(true);
    expect(ws.rowCount).toBe(examples + 3);
  });
});

describe("loadGoalsExport", () => {
  it("returns the page model with the same run's invoices, truckload shipments and rates", async () => {
    store.succeeded = RUN;
    const data = await loadGoalsExport();
    expect(data.view).toEqual(await loadGoalsView());
    expect(data.view.state).toBe("ready");
    expect(vi.mocked(loadSnapshot)).toHaveBeenCalledWith(RUN);
    expect(data.shipments).toBe(DATASETS.shipments);
    expect(data.truckloads).toBe(DATASETS.truckloads);
    expect(data.rates).toEqual([{ date: TODAY, rate: RATE }]);
  });

  it("has no rows before the first good refresh", async () => {
    store.succeeded = null;
    const data = await loadGoalsExport();
    expect(data).toMatchObject({ shipments: [], truckloads: [], rates: [] });
    expect(data.view.state).toBe("no_data");
  });
});

// ─── LibreOffice ────────────────────────────────────────────────────────────

const SOFFICE = spawnSync("soffice", ["--version"], { encoding: "utf8" }).status === 0;
const SKIP_REASON = "soffice (LibreOffice) is not installed here, as in CI; run this test where it is";
// The default reporter counts a skip without its note, so say why in the log as well.
if (!SOFFICE) console.warn(`[reporting-goals-export] The LibreOffice recalculation test is skipped: ${SKIP_REASON}.`);
const ERROR_VALUE = /^(#REF!|#VALUE!|#NAME\?|#DIV\/0!|#N\/A|#NUM!|#NULL!|Err:\d+)/;

/**
 * A formula's recalculated result. cell.result, not cell.value.result: exceljs
 * drops a cached 0 from cell.value.
 */
const resultOf = (cell: ExcelJS.Cell): unknown => cell.result;

/** Every cell holding a formula error, after recalculation. */
function formulaErrors(wb: ExcelJS.Workbook): string[] {
  const errors: string[] = [];
  for (const ws of wb.worksheets) {
    ws.eachRow((row) =>
      row.eachCell((cell) => {
        const result: unknown = formulaOf(cell) === undefined ? cell.value : resultOf(cell);
        const error =
          result !== null && typeof result === "object" && "error" in result
            ? String((result as { error: unknown }).error)
            : typeof result === "string" && ERROR_VALUE.test(result)
              ? result
              : null;
        if (error) errors.push(`${ws.name}!${cell.address} ${error}`);
      })
    );
  }
  return errors;
}

describe("recalculated by LibreOffice (soffice --headless --convert-to xlsx)", () => {
  it("has no formula errors on any sheet, and reproduces the brief's totals with and without M1–M7", async (ctx) => {
    ctx.skip(!SOFFICE, SKIP_REASON);
    const dir = mkdtempSync(path.join(tmpdir(), "plx-goals-export-"));
    try {
      const plain = await build([]);
      const entered = await build(ENTRIES);
      writeFileSync(path.join(dir, "plain.xlsx"), plain.buffer);
      writeFileSync(path.join(dir, "entered.xlsx"), entered.buffer);
      // A control with two broken formulas proves the error scan can see errors at all.
      const control = new ExcelJS.Workbook();
      control.calcProperties.fullCalcOnLoad = true;
      const broken = control.addWorksheet("Control");
      broken.getCell("A1").value = { formula: "1/0" };
      broken.getCell("A2").value = { formula: "NOSUCHFUNCTION(1)" };
      writeFileSync(path.join(dir, "control.xlsx"), new Uint8Array(await control.xlsx.writeBuffer()));
      const out = path.join(dir, "out");
      const run = spawnSync(
        "soffice",
        [
          `-env:UserInstallation=${pathToFileURL(path.join(dir, "profile")).href}`,
          "--headless",
          "--convert-to",
          "xlsx",
          "--outdir",
          out,
          path.join(dir, "plain.xlsx"),
          path.join(dir, "entered.xlsx"),
          path.join(dir, "control.xlsx"),
        ],
        { encoding: "utf8", timeout: 120_000 }
      );
      expect(run.status, run.stderr).toBe(0);
      expect(formulaErrors(await readXlsx(readFileSync(path.join(out, "control.xlsx"))))).toEqual([
        "Control!A1 #DIV/0!",
        "Control!A2 #NAME?",
      ]);

      for (const [name, built, g8] of [
        ["plain", plain, "367014.16"],
        ["entered", entered, "408628.08"],
      ] as const) {
        const wb = await readXlsx(readFileSync(path.join(out, `${name}.xlsx`)));
        expect(wb.worksheets.map((ws) => ws.name)).toEqual([...WORKBOOK_SHEETS]);
        expect(formulaErrors(wb), name).toEqual([]);

        const goals = sheet(wb, "Goals");
        const model = built.model;
        const at = (address: string) => resultOf(goals.getCell(address));
        expect(at("G8"), `${name} Goals!G8`).toBeCloseTo(Number(g8), 6);
        expect(centsToDecimal(model.revenue.totalCents)).toBe(g8);
        expect(at("C8")).toBeCloseTo(model.revenue.dueSoFarCents / 100, 6);
        expect(at("I8")).toBeCloseTo(model.revenue.neededPerDayCents / 100, 2);
        expect(at("H8")).toBe(model.revenue.status === "on_track" ? "On track" : "Behind");
        expect([at("B5"), at("C5"), at("G5"), at("G6"), at("G7")]).toEqual([
          model.line1.targetKg,
          model.line1.dueSoFarKg,
          model.line1.totalKg,
          model.truckloads.full.total,
          model.truckloads.partial.total,
        ]);
        expect(at("I5")).toBeCloseTo(model.line1.neededPerDayKg, 6);
        expect(at("H5")).toBe(model.line1.status === "on_track" ? "On track" : "Behind");

        // The running revenue line ends where the page's does, to the cent.
        const daily = sheet(wb, "Daily");
        const last = model.daily[model.daily.length - 1];
        expect(resultOf(daily.getCell("I32"))).toBeCloseTo(last.withHandToDateCents / 100, 2);
        expect(resultOf(daily.getCell("J32"))).toBeCloseTo(last.targetToDateCents / 100, 6);

        // Line 1 = Yes on every batch that counts if every scheduled batch runs: their kg add up to it.
        const batches = sheet(wb, "Batches");
        let line1Kg = 0;
        for (let r = 2; r <= batches.rowCount; r += 1) {
          if (resultOf(batches.getCell(`G${r}`)) === "Yes") line1Kg += Number(batches.getCell(`E${r}`).value);
        }
        expect(line1Kg).toBeCloseTo(model.line1.ifAllRunKg, 6);
      }
      expect([plain.model.line1.ifAllRunKg, entered.model.line1.ifAllRunKg]).toEqual([286_147, 295_197]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 180_000);
});
