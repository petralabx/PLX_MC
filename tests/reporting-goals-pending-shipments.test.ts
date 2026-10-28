// INTERIM (TASK-3992): shipped, not yet invoiced. Posted Sage shipments this
// month that no posted invoice names yet are added to the Revenue goal as an
// estimate, by the shipment's customer class (scope=mfg leaves Exclusive
// Distribution out). A login without the grant records "missing", adds
// nothing and doesn't fail; GOALS_PENDING_SHIPMENTS=off turns it off.

import { readFileSync } from "node:fs";
import path from "node:path";

import ExcelJS from "exceljs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import pendingJson from "./fixtures/reporting-goals/2026-10-14/pending-shipments.json";
import { GoalCards } from "@/components/mc/goals/goal-cards";
import { dollars, isReady } from "@/components/mc/goals/helpers";
import { buildGoalsWorkbook } from "@/lib/reporting/goals/excel/export";
import { WORKBOOK_SHEETS } from "@/lib/reporting/goals/excel/layout";
import { convertCents } from "@/lib/reporting/goals/money";
import { pendingShipmentsByClass, pendingShipmentsEnabled } from "@/lib/reporting/goals/pending-shipments";
import { ITEM_LINES_SQL } from "@/lib/reporting/goals/queries/forecast-orders";
import { PENDING_SHIPMENT_COLUMNS, pendingShipmentsQuery } from "@/lib/reporting/goals/queries/pending-shipments";
import type { PendingShipmentsDataset } from "@/lib/reporting/goals/types";
import { DATASETS, ENTRIES, FORECAST, RATE, RUN, SETTINGS, SHIPMENT_LINES_SUMMARY, TODAY, goalsPage, manualEntry } from "./reporting-goals-helpers";

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

  it("does not add a pending shipment a counted manual entry already names", () => {
    const hand = manualEntry({
      entryId: "M-SH0009101",
      type: "Shipment",
      date: "2026-10-13",
      reference: "SH 0009101",
      customerCode: "1HRA01",
      productValue: "2000.00",
      freight: "0",
      currency: "CAD",
    });
    const withHand = goalsPage(
      {},
      [...ENTRIES, hand],
      FORECAST,
      SHIPMENT_LINES_SUMMARY,
      "boc",
      { ...DATASETS, pendingShipments: PENDING },
    );
    // The $2,000 manual entry replaces the matching estimate. Adding both would put $4,000 on the headline.
    expect(withHand.revenueGoal!.goalCadCents).toBe(page(PENDING).revenueGoal!.goalCadCents);
    expect(withHand.revenueGoal!.pendingCadCents).toBe(page(PENDING).revenueGoal!.pendingCadCents - 200_000);
    expect(withHand.revenueGoal!.pendingShipments).toBe(page(PENDING).revenueGoal!.pendingShipments - 1);
  });

  it("keeps the Sage row when the hand entry does not count", () => {
    const hand = manualEntry({
      entryId: "M-SH0009101-old",
      type: "Shipment",
      date: "2026-09-30",
      reference: "SH0009101",
      customerCode: "1HRA01",
      productValue: "2000.00",
      freight: "0",
      currency: "CAD",
    });
    const withHand = goalsPage(
      {},
      [...ENTRIES, hand],
      FORECAST,
      SHIPMENT_LINES_SUMMARY,
      "boc",
      { ...DATASETS, pendingShipments: PENDING },
    );
    expect(withHand.revenueGoal!.pendingCadCents).toBe(page(PENDING).revenueGoal!.pendingCadCents);
    expect(withHand.revenueGoal!.pendingShipments).toBe(page(PENDING).revenueGoal!.pendingShipments);
  });

  it("keeps the Sage row when the hand entry names the order, not the shipment", () => {
    const hand = manualEntry({
      entryId: "M-ORD0045101",
      type: "Shipment",
      date: "2026-10-13",
      reference: "ORD0045101",
      customerCode: "1HRA01",
      productValue: "2000.00",
      freight: "0",
      currency: "CAD",
    });
    const withHand = goalsPage(
      {},
      [...ENTRIES, hand],
      FORECAST,
      SHIPMENT_LINES_SUMMARY,
      "boc",
      { ...DATASETS, pendingShipments: PENDING },
    );
    // Matching the order would also drop every other shipment of that order. This entry stays beside the estimate.
    const base = page(PENDING).revenueGoal!;
    expect(withHand.revenueGoal!.pendingCadCents).toBe(base.pendingCadCents);
    expect(withHand.revenueGoal!.goalCadCents).toBe(base.goalCadCents + 200_000);
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
  });

  it("counts a blank or space-padded line type as an item line, as ITEM_LINES_SQL does", () => {
    // trim(coalesce(linetype, '1')) turns '   ' into '', not '1', and dropped those item lines.
    const itemLine = "coalesce(nullif(trim(d.linetype::text), ''), '1') = '1'";
    expect(ITEM_LINES_SQL).toContain(itemLine);
    expect(pendingShipmentsQuery.sql).toContain(itemLine);
    expect(pendingShipmentsQuery.sql).not.toContain("trim(coalesce(d.linetype::text, '1'))");
  });
});

describe("shipped, not yet invoiced in the card's equations", () => {
  const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
  const card = (scope: "all" | "mfg") => {
    const p = page(PENDING);
    if (!isReady(p)) throw new Error("ready");
    return text(renderToStaticMarkup(createElement(GoalCards, { page: p, scope })));
  };

  it("all customers: headline + charges + returns - estimate = invoiced", () => {
    const g = page(PENDING).revenueGoal!;
    expect(g.pendingCadCents).toBeGreaterThan(0);
    expect(g.goalCadCents + g.chargesCadCents + g.returnsCadCents - g.pendingCadCents).toBe(g.totalCadCents);
    expect(card("all")).toContain(
      `+ ${dollars(g.chargesCadCents)} freight & other charges left out − ${dollars(g.pendingCadCents)} shipped, not yet invoiced = ${dollars(g.totalCadCents)} invoiced`
    );
  });

  it("manufacturing: headline + charges + returns - estimate + Exclusive Distribution = all customers", () => {
    const m = page(PENDING).revenueScope!;
    expect(m.pendingCadCents).toBeGreaterThan(0);
    expect(m.goalCadCents + m.chargesCadCents + m.returnsCadCents - m.pendingCadCents + m.excludedCadCents).toBe(m.totalCadCents + m.excludedCadCents);
    expect(card("mfg")).toContain(
      `+ ${dollars(m.chargesCadCents)} freight & other charges − ${dollars(m.pendingCadCents)} shipped, not yet invoiced + ${dollars(m.excludedCadCents)} Exclusive Distribution left out = ${dollars(m.totalCadCents + m.excludedCadCents)} all customers`
    );
  });

  it("leaves the equations unchanged without the estimate", () => {
    const p = page();
    if (!isReady(p)) throw new Error("ready");
    expect(text(renderToStaticMarkup(createElement(GoalCards, { page: p, scope: "all" })))).not.toContain("shipped, not yet invoiced");
  });
});

describe("rollback of migration 052", () => {
  const sql = readFileSync(path.join(__dirname, "..", "db", "rollback", "052_reporting_goals_pending_shipments_rollback.sql"), "utf8");
  const code = sql.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n").trim();

  it("says the code goes back first and the flag is no substitute", () => {
    expect(sql).toMatch(/revert the code first, then run this/i);
    expect(sql).toContain("GOALS_PENDING_SHIPMENTS=off is NOT a substitute");
  });

  it("drops nothing unless the operator says the code is reverted and no live run wrote a summary", () => {
    // One DO block: a refusal raises before any DROP, even without ON_ERROR_STOP.
    expect(code.startsWith("DO $$")).toBe(true);
    expect(code.endsWith("END $$;")).toBe(true);
    expect(code.match(/\$\$/g)).toHaveLength(2);
    const drop = code.indexOf("DROP TABLE");
    expect(code.indexOf("current_setting('plx.code_reverted', true)")).toBeGreaterThan(0);
    expect(code.indexOf("current_setting('plx.code_reverted', true)")).toBeLessThan(drop);
    expect(code.indexOf("FROM report_snap_pending_shipment_summary")).toBeLessThan(drop);
    expect(code.indexOf("DELETE FROM schema_migrations")).toBeGreaterThan(drop);
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

  it("leaves a hand-entered shipment out of the workbook estimate", async () => {
    const hand = manualEntry({
      entryId: "M-SH0009101",
      type: "Shipment",
      date: "2026-10-13",
      reference: "SH0009101",
      customerCode: "1HRA01",
      productValue: "2000.00",
      freight: "0",
      currency: "CAD",
    });
    const p = goalsPage({}, [...ENTRIES, hand], FORECAST, SHIPMENT_LINES_SUMMARY, "boc", { ...DATASETS, pendingShipments: PENDING });
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
      pendingShipments: PENDING,
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const pendingSheet = wb.getWorksheet("Pending shipments")!;
    const listed: string[] = [];
    pendingSheet.eachRow((row) => {
      const value = row.getCell(1).value;
      if (typeof value === "string" && value.startsWith("SH")) listed.push(value);
    });
    expect(listed).not.toContain("SH0009101");
    const byClass = wb.getWorksheet("Revenue by class")!;
    let manufacturing: number | string | null = null;
    byClass.eachRow((row) => {
      if (row.getCell(1).value === "Exclusive Manufacturing") manufacturing = row.getCell(15).value as number | string | null;
    });
    expect(manufacturing === "" || manufacturing === 0 || manufacturing === null).toBe(true);
  });

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
