// Returns (Sage credit notes, TASK-3987): credit notes dated this month come
// off the Revenue goal (before tax, net of credited freight & other charges),
// by the credit note's customer class, so scope=mfg leaves Exclusive
// Distribution's returns out with its invoices. A login without the grant
// records access "missing" and deducts nothing.

import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import creditNotesJson from "./fixtures/reporting-goals/2026-10-14/credit-notes.json";
import { buildGoalsWorkbook } from "@/lib/reporting/goals/excel/export";
import type { CreditNotesDataset, Datasets } from "@/lib/reporting/goals/types";
import { DATASETS, ENTRIES, FORECAST, RATE, RUN, SETTINGS, SHIPMENT_LINES_SUMMARY, TODAY, goalsPage } from "./reporting-goals-helpers";

const CREDIT_NOTES = creditNotesJson as unknown as CreditNotesDataset;
const withNotes = (creditNotes: CreditNotesDataset): Datasets => ({ ...DATASETS, creditNotes });
const page = (creditNotes?: CreditNotesDataset) =>
  goalsPage({}, ENTRIES, FORECAST, SHIPMENT_LINES_SUMMARY, "boc", creditNotes ? withNotes(creditNotes) : DATASETS);

describe("returns on the Revenue goal", () => {
  it("leaves the fixture's numbers alone without credit notes", () => {
    const base = page();
    expect(base.creditNotes).toBeNull();
    expect(base.revenueGoal!.returnsCadCents).toBe(0);
    expect(base.revenueGoal!.returnsNotes).toBe(0);
  });

  it("subtracts product returns (not credited charges) from the goal, all customers", () => {
    const base = page().revenueGoal!;
    const goal = page(CREDIT_NOTES).revenueGoal!;
    expect(goal.returnsNotes).toBe(3);
    // CAD 1,200 + 300, plus US$500 converted; the US$50 freight is charges.
    expect(goal.returnsCadCents).toBeGreaterThan(150_000 + 50_000);
    expect(goal.returnsChargesCadCents).toBeGreaterThan(5_000);
    expect(goal.goalCadCents).toBe(base.goalCadCents - goal.returnsCadCents);
    expect(goal.totalCadCents).toBe(base.totalCadCents);
    expect(goal.chargesCadCents).toBe(base.chargesCadCents);
  });

  it("buckets each note by its customer's class: scope=mfg leaves Exclusive Distribution's out", () => {
    const all = page(CREDIT_NOTES).revenueGoal!;
    const mfg = page(CREDIT_NOTES).revenueScope!;
    expect(mfg.returnsNotes).toBe(2);
    expect(all.returnsCadCents - mfg.returnsCadCents).toBe(30_000);
    const rows = page(CREDIT_NOTES).revenueByClass!.rows;
    expect(rows.find((r) => r.customerClass === "Exclusive Distribution")!.returns.notes).toBe(1);
    expect(rows.find((r) => r.customerClass === "Exclusive Manufacturing")!.returns.cad.cents).toBe(120_000);
    const mixed = rows.find((r) => r.customerClass === "Mixed")!.returns;
    expect(mixed.usd.cents).toBe(55_000);
    expect(mixed.usd.chargesCents).toBe(5_000);
  });

  it("deducts nothing and says what's missing when the login can't read credit notes", () => {
    const missing: CreditNotesDataset = { access: "missing", missing: ["sage.oe_credit_note_header"], notes: [] };
    const p = page(missing);
    expect(p.creditNotes).toEqual({ access: "missing", missing: ["sage.oe_credit_note_header"], notes: 0 });
    expect(p.revenueGoal!.goalCadCents).toBe(page().revenueGoal!.goalCadCents);
  });
});

describe("returns in the workbook", () => {
  async function cells(creditNotes?: CreditNotesDataset): Promise<string[]> {
    const p = page(creditNotes);
    const buffer = await buildGoalsWorkbook({
      run: RUN,
      model: p.model!,
      settings: SETTINGS,
      shipments: DATASETS.shipments,
      truckloads: DATASETS.truckloads,
      rates: [{ date: TODAY, rate: RATE }],
      exportedAt: new Date("2026-10-14T12:00:00.000Z"),
      forecast: p.forecast,
      revenueByClass: p.revenueByClass,
      creditNotes: creditNotes ?? null,
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const out: string[] = [];
    wb.eachSheet((ws) =>
      ws.eachRow((row) =>
        row.eachCell((c) => {
          const v = c.value as unknown;
          out.push(typeof v === "object" && v && "formula" in v ? `=${(v as { formula: string }).formula}` : String(v));
        })
      )
    );
    return out;
  }

  it("adds the returns columns, the J = G - I - L formula and every credit note", async () => {
    const all = await cells(CREDIT_NOTES);
    expect(all).toContain("Credit notes (Sage)");
    expect(all).toContain("Returns, CAD");
    expect(all).toContain("Credited charges, CAD");
    expect(all.some((v) => /^=G\d+-I\d+-L\d+$/.test(v))).toBe(true);
    for (const n of CREDIT_NOTES.notes) expect(all).toContain(n.creditNote);
  });

  it("says returns aren't deducted when the grant is missing", async () => {
    const all = await cells({ access: "missing", missing: ["sage.oe_credit_note_header"], notes: [] });
    expect(all.some((v) => v.includes("needs sage.oe_credit_note_header"))).toBe(true);
  });
});
