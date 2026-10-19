// Revenue forecast persistence (migration 043, TASK-3151): each good run's open
// order lines (with Sage's item category, migration 045, TASK-3177) and assembly
// orders, and its summary (whether the login could read the forecast's tables
// and the category column, and the four bucket totals from Sage and FileMaker
// only). completeRun (store.ts) writes the rows below in the run's own
// transaction; the loader reads them back with every retained run's point for
// the hit rate. Runs are kept 90 days, and these rows go with them. Server-only.

import { withTransaction } from "@/lib/db";

import { forecastSummary, type ForecastRunPoint, type ForecastSnapshot } from "./forecast";
import { centsToDecimal, toCents } from "./money";
import type { ForecastAccess, ForecastDatasets, RefreshRun } from "./types";

type Column = readonly [name: string, pgType: string];

/** One snapshot table's rows, for store.insertRows. */
export interface ForecastTableRows {
  table: string;
  columns: readonly Column[];
  rows: unknown[][];
}

/** Everything a run stores for the forecast; the summary is computed with the run's rate. */
export function forecastTableRows(run: Pick<RefreshRun, "id" | "today">, forecast: ForecastDatasets, rate: string): ForecastTableRows[] {
  const id = (rows: unknown[][]) => rows.map((row) => [run.id, ...row]);
  const summary = forecast.access === "read" ? forecastSummary(forecast, run.today, rate) : null;
  const dollars = (cents: number | undefined) => (cents === undefined ? null : centsToDecimal(cents));
  return [
    {
      table: "report_snap_forecast_line",
      columns: [["run_id", "bigint"], ["row_no", "integer"], ["order_no", "text"], ["line_no", "integer"], ["customer_code", "text"],
        ["customer", "text"], ["po", "text"], ["item", "text"], ["description", "text"], ["expected", "date"], ["qty", "numeric"],
        ["unit", "text"], ["unit_price", "numeric"], ["currency", "text"], ["later_qty", "numeric"], ["category", "text"]],
      rows: id(forecast.lines.map((l, i) => [i + 1, l.orderNo, l.lineNo, l.customerCode, l.customer, l.po, l.item, l.description,
        l.expected, l.qty, l.unit, l.unitPrice, l.currency, l.laterQty, l.category])),
    },
    {
      table: "report_snap_forecast_ao",
      columns: [["run_id", "bigint"], ["ao_id", "text"], ["ao", "text"], ["status", "text"], ["scheduled", "date"], ["item", "text"],
        ["oe_list", "text"], ["qty", "numeric"], ["units_per_box", "numeric"], ["batch", "text"], ["batch_status", "text"],
        ["open_order", "boolean"]],
      rows: id(forecast.aos.map((a) => [a.id, a.ao, a.status, a.scheduled, a.item, a.oeList, a.qty, a.unitsPerBox, a.batch,
        a.batchStatus, a.openOrder])),
    },
    {
      table: "report_snap_forecast_summary",
      columns: [["run_id", "bigint"], ["access", "text"], ["missing", "jsonb"], ["lines", "integer"], ["ready_cad", "numeric"],
        ["planned_cad", "numeric"], ["late_cad", "numeric"], ["not_planned_cad", "numeric"], ["category_missing", "jsonb"]],
      rows: id([[forecast.access, JSON.stringify(forecast.missing), forecast.lines.length, dollars(summary?.readyCents),
        dollars(summary?.plannedCents), dollars(summary?.lateCents), dollars(summary?.notPlannedCents),
        forecast.categoryMissing === null ? null : JSON.stringify(forecast.categoryMissing)]]),
    },
  ];
}

/** The run's forecast and the hit-rate history up to it; null for a run stored before the forecast existed. */
export async function loadForecast(run: RefreshRun): Promise<ForecastSnapshot | null> {
  // One connection, sequential reads: the snapshot is immutable once written.
  return withTransaction(async (q) => {
    const [summary] = await q<{ access: ForecastAccess; missing: string[]; category_missing: string[] | null }>(
      `SELECT access, missing, category_missing FROM report_snap_forecast_summary WHERE run_id = $1`,
      [run.id]
    );
    if (!summary) return null;
    const lines = await q<{
      order_no: string; line_no: number | null; customer_code: string | null; customer: string | null; po: string | null;
      item: string; description: string | null; expected: string; qty: string; unit: string | null; unit_price: string; currency: string;
      later_qty: string; category: string | null;
    }>(
      `SELECT order_no, line_no, customer_code, customer, po, item, description, expected::text AS expected,
              qty::text AS qty, unit, unit_price::text AS unit_price, currency, later_qty::text AS later_qty, category
         FROM report_snap_forecast_line WHERE run_id = $1 ORDER BY row_no`,
      [run.id]
    );
    const aos = await q<{
      ao_id: string; ao: string | null; status: string | null; scheduled: string | null; item: string | null; oe_list: string | null;
      qty: string | null; units_per_box: string | null; batch: string | null; batch_status: string | null; open_order: boolean;
    }>(
      `SELECT ao_id, ao, status, scheduled::text AS scheduled, item, oe_list, qty::text AS qty,
              units_per_box::text AS units_per_box, batch, batch_status, open_order
         FROM report_snap_forecast_ao WHERE run_id = $1 ORDER BY scheduled NULLS FIRST, ao_id`,
      [run.id]
    );
    // Every retained good run up to this one: its rate, Ready + Planned in time, and its Sage invoices.
    const points = await q<{
      id: string | number; today: string; fx_rate: string; access: ForecastAccess | null; ready_cad: string | null;
      planned_cad: string | null; cad_this: string; usd_this: string; cad_last: string; usd_last: string;
    }>(
      `SELECT r.id, r.today::text AS today, r.fx_rate::text AS fx_rate, s.access,
              s.ready_cad::text AS ready_cad, s.planned_cad::text AS planned_cad,
              coalesce(sum(v.net_before_tax) FILTER (WHERE v.currency = 'CAD' AND v.this_month), 0)::text AS cad_this,
              coalesce(sum(v.net_before_tax) FILTER (WHERE v.currency = 'USD' AND v.this_month), 0)::text AS usd_this,
              coalesce(sum(v.net_before_tax) FILTER (WHERE v.currency = 'CAD' AND NOT v.this_month), 0)::text AS cad_last,
              coalesce(sum(v.net_before_tax) FILTER (WHERE v.currency = 'USD' AND NOT v.this_month), 0)::text AS usd_last
         FROM report_refresh_run r
         LEFT JOIN report_snap_forecast_summary s ON s.run_id = r.id
         LEFT JOIN report_snap_revenue v ON v.run_id = r.id
        WHERE r.status = 'succeeded' AND r.id <= $1
        GROUP BY r.id, r.today, r.fx_rate, s.access, s.ready_cad, s.planned_cad
        ORDER BY r.id`,
      [run.id]
    );
    const history: ForecastRunPoint[] = points.map((p) => ({
      runId: Number(p.id),
      today: p.today,
      rate: p.fx_rate,
      readyPlannedCents: p.access === "read" ? toCents(p.ready_cad) + toCents(p.planned_cad) : null,
      sage: {
        cadThisMonth: toCents(p.cad_this),
        usdThisMonth: toCents(p.usd_this),
        cadLastMonth: toCents(p.cad_last),
        usdLastMonth: toCents(p.usd_last),
      },
    }));
    return {
      data: {
        access: summary.access,
        missing: summary.missing,
        categoryMissing: summary.category_missing,
        lines: lines.map((l) => ({
          orderNo: l.order_no, lineNo: l.line_no, customerCode: l.customer_code, customer: l.customer, po: l.po, item: l.item,
          description: l.description, expected: l.expected, qty: l.qty, unit: l.unit, unitPrice: l.unit_price, currency: l.currency,
          category: l.category, laterQty: l.later_qty,
        })),
        aos: aos.map((a) => ({
          id: a.ao_id, ao: a.ao, status: a.status, scheduled: a.scheduled, item: a.item, oeList: a.oe_list, qty: a.qty,
          unitsPerBox: a.units_per_box, batch: a.batch, batchStatus: a.batch_status, openOrder: a.open_order,
        })),
      },
      history,
    };
  });
}
