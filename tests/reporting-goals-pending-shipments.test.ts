// INTERIM (TASK-3992): shipped, not yet invoiced. Posted Sage shipments this
// month that no posted invoice names yet are added to the Revenue goal as an
// estimate, by the shipment's customer class (scope=mfg leaves Exclusive
// Distribution out). A login without the grant records "missing", adds
// nothing and doesn't fail; GOALS_PENDING_SHIPMENTS=off turns it off.

import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import pendingJson from "./fixtures/reporting-goals/2026-10-14/pending-shipments.json";
import { buildGoalsWorkbook } from "@/lib/reporting/goals/excel/export";
import { WORKBOOK_SHEETS } from "@/lib/reporting/goals/excel/layout";
import { convertCents } from "@/lib/reporting/goals/money";
import { pendingShipmentsByClass, pendingShipmentsEnabled } from "@/lib/reporting/goals/pending-shipments";
import { PENDING_SHIPMENT_COLUMNS, pendingShipmentsQuery } from "@/lib/reporting/goals/queries/pending-shipments";
import type { PendingShipmentsDataset } from "@/lib/reporting/goals/types";
import { DATASETS, ENTRIES, FORECAST, RATE, RUN, SETTINGS, SHIPMENT_LINES_SUMMARY, TODAY, goalsPage } from "./reporting-goals-helpers";

const PENDING = pendingJson as unknown as PendingShipmentsDataset;
const page = (pendingShipments?: PendingShipmentsDataset) =>
  goalsPage({}, ENTRIES, FORECAST, SHIPMENT_LINES_SUMMARY, "boc", pendingShipments ? { ...DATASETS, pendingShipments } : DATASETS);

describe("shipped, not yet invoiced on the Revenue goal", () => {
  it("leaves the fixture's numbers alone without the dataset", () => {
    const p = page();
    expect(p.pendingShipments).toBeNull();
    expect(p.revenueGoal!.pendingCadCents).toBe(0);
  });

  it("adds the estimate to the goal (not to invoiced), all customers", () => {
    const base = page().revenueGoal!;
    const goal = page(PENDING).revenueGoal!;
    const usd = convertCents(100_000, RATE);
    expect(goal.pendingShipments).toBe(3);
    expect(goal.pendingCadCents).toBe(200_000 + 40_000 + usd);
    expect(goal.goalCadCents).toBe(base.goalCadCents + goal.pendingCadCents);
    expect(goal.totalCadCents).toBe(base.totalCadCents);
    expect(goal.invoicedProductCadCents).toBe(base.totalCadCents - base.chargesCadCents);
    expect(goal.status).toBe(goal.goalCadCents >= page().model!.revenue.dueSoFarCents ? "on_track" : "behind");
  });

  it("classes by customer: scope=mfg leaves Exclusive Distribution out", () => {
    const all = page(PENDING).revenueGoal!;
    const mfg = page(PENDING).revenueScope!;
    expect(mfg.pendingShipments).toBe(2);
    expect(all.pendingCadCents - mfg.pendingCadCents).toBe(40_000);
    const byClass = pendingShipmentsByClass(PENDING.shipments, RATE);
    expect(byClass.rows["Exclusive Manufacturing"].cadCents).toBe(200_000);
    expect(byClass.rows.Mixed.usdCents).toBe(100_000);
  });

  it("adds nothing and names what's missing without the grant", () => {
    const missing: PendingShipmentsDataset = { access: "missing", missing: ["sage.oe_shipment_header.shidate"], shipments: [] };
    const p = page(missing);
    expect(p.pendingShipments).toMatchObject({ access: "missing", shipments: 0 });
    expect(p.revenueGoal!.goalCadCents).toBe(page().revenueGoal!.goalCadCents);
  });

  it("leaves other currencies out", () => {
    const r = pendingShipmentsByClass([{ ...PENDING.shipments[0]!, currency: "EUR" }], RATE);
    expect(r.total.totalCadCents).toBe(0);
    expect(r.otherCurrencies).toEqual([{ currency: "EUR", shipments: 1, cents: 200_000 }]);
  });

  it("is on unless GOALS_PENDING_SHIPMENTS=off", () => {
    expect(pendingShipmentsEnabled({})).toBe(true);
    expect(pendingShipmentsEnabled({ GOALS_PENDING_SHIPMENTS: "off" })).toBe(false);
    expect(pendingShipmentsEnabled({ GOALS_PENDING_SHIPMENTS: " OFF " })).toBe(false);
  });

  it("reads no cost column and skips invoiced shipments", () => {
    const cols = PENDING_SHIPMENT_COLUMNS.flatMap(([, , c]) => [...c]);
    expect(cols.some((c) => /cost|margin/i.test(c))).toBe(false);
    expect(pendingShipmentsQuery.sql).toContain("NOT EXISTS (SELECT 1 FROM sage.oe_invoice_header h");
    expect(pendingShipmentsQuery.sql).toContain("trim(coalesce(d.linetype::text, '1')) = '1'");
  });
});

describe("shipped, not yet invoiced in the workbook", () => {
  async function load(pendingShipments?: PendingShipmentsDataset) {
    const p = page(pendingShipments);
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
      pendingShipments: pendingShipments ?? null,
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    return wb;
  }
  const formula = (v: unknown) => (typeof v === "object" && v && "formula" in v ? (v as { formula: string }).formula : null);

  it("adds the Pending shipments sheet after Shipment lines", async () => {
    const wb = await load(PENDING);
    expect(wb.worksheets.map((w) => w.name)).toEqual([...WORKBOOK_SHEETS]);
    expect(WORKBOOK_SHEETS.indexOf("Pending shipments")).toBe(WORKBOOK_SHEETS.indexOf("Shipment lines") + 1);
    const ws = wb.getWorksheet("Pending shipments")!;
    expect(ws.getCell("A5").value).toBe("SH0009101");
    expect(ws.getCell("E7").value).toBe("Exclusive Distribution");
    expect(ws.getCell("I6").value).toBe(1000);
  });

  it("adds the pending columns and J = G - I - L + O on Revenue by class", async () => {
    const ws = (await load(PENDING)).getWorksheet("Revenue by class")!;
    let header = 0;
    ws.eachRow((row, n) => {
      if (row.getCell(15).value === "Shipped, not invoiced, CAD (estimate)") header = n;
    });
    expect(header).toBeGreaterThan(0);
    const r = header + 1;
    expect(formula(ws.getCell(r, 10).value)).toBe(`G${r}-I${r}-L${r}+O${r}`);
  });

  it("keeps J = G - I - L and says not included without access", async () => {
    const wb = await load({ access: "missing", missing: ["sage.oe_shipment_header.shidate"], shipments: [] });
    const ws = wb.getWorksheet("Revenue by class")!;
    const texts: string[] = [];
    let j: string | null = null;
    ws.eachRow((row) => {
      row.eachCell((c) => texts.push(String(c.value)));
      const f = formula(row.getCell(10).value);
      if (!j && f && /^G\d+-I\d+-L\d+$/.test(f)) j = f;
    });
    expect(j).not.toBeNull();
    expect(texts.some((t) => t.startsWith("Shipped, not invoiced: not included (needs access"))).toBe(true);
    expect(String(wb.getWorksheet("Pending shipments")!.getCell("A2").value)).toContain("not included (needs access");
  });
});
