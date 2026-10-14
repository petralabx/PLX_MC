// Goals & Production persistence in Mission Control's own Postgres (migration
// 039): refresh runs and their snapshots, configuration, the USD/CAD history and
// manual entries. All SQL is parameterized; table and column names are fixed
// literals. Server-only.

import { appendEventTx } from "@/lib/compliance/repo";
import { query, withTransaction, type TxQuery } from "@/lib/db";

import { FX_SERIES } from "./fx";
import { toCents } from "./money";
import type {
  Datasets,
  FtlCustomer,
  FxRate,
  FxSource,
  GoalSettings,
  IsoDate,
  ManualEntry,
  RefreshRun,
  RefreshTrigger,
  RunStatus,
  SnapshotData,
} from "./types";

/** A user may start a refresh at most once per this many seconds. */
export const RATE_LIMIT_SECONDS = 300;
/** A run still "running" after this long died with its function; the next claim fails it. */
export const STALE_RUN_MINUTES = 10;
/** Runs (and their snapshots) are kept this long. */
export const RETENTION_DAYS = 90;
/** Reference and customer lists are the large datasets: only the newest good runs keep them. */
export const LIST_RETENTION_RUNS = 3;

const REFRESH_LOCK_KEY = "reporting-goals-refresh";

// ─── Runs ───────────────────────────────────────────────────────────────────

interface RunRow {
  id: string | number;
  trigger: RefreshTrigger;
  requested_by: string;
  today: string;
  status: RunStatus;
  step: string | null;
  started_at: Date | string;
  finished_at: Date | string | null;
  error: string | null;
  production_cutoff: string | null;
  sage_cutoff: string | null;
  fx_rate: string | null;
  fx_rate_date: string | null;
  fx_source: FxSource | null;
  row_counts: Record<string, number> | null;
}

const RUN_COLUMNS = `id, trigger, requested_by, today::text AS today, status, step, started_at, finished_at,
  error, production_cutoff::text AS production_cutoff, sage_cutoff::text AS sage_cutoff,
  fx_rate::text AS fx_rate, fx_rate_date::text AS fx_rate_date, fx_source, row_counts`;

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toRun(row: RunRow): RefreshRun {
  return {
    id: Number(row.id),
    trigger: row.trigger,
    requestedBy: row.requested_by,
    today: row.today,
    status: row.status,
    step: row.step,
    startedAt: iso(row.started_at),
    finishedAt: row.finished_at ? iso(row.finished_at) : null,
    error: row.error,
    productionCutoff: row.production_cutoff,
    sageCutoff: row.sage_cutoff,
    fxRate: row.fx_rate,
    fxRateDate: row.fx_rate_date,
    fxSource: row.fx_source,
    rowCounts: row.row_counts ?? {},
  };
}

export type ClaimOutcome =
  | { kind: "claimed"; run: RefreshRun }
  | { kind: "running"; run: RefreshRun }
  | { kind: "rate_limited"; run: RefreshRun; retryAfterSeconds: number };

/**
 * Claim the right to refresh. The advisory lock serializes the check-and-insert;
 * the one-running-row unique index (migration 039) is the durable guard, so a
 * crashed function cannot hold the lock — its row is failed as abandoned after
 * STALE_RUN_MINUTES. Users are limited to one refresh per RATE_LIMIT_SECONDS.
 */
export async function claimRun(input: {
  trigger: RefreshTrigger;
  requestedBy: string;
  today: IsoDate;
}): Promise<ClaimOutcome> {
  return withTransaction(async (q) => {
    await q(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [REFRESH_LOCK_KEY]);
    await q(
      `UPDATE report_refresh_run
          SET status = 'failed', step = NULL, finished_at = now(), error = $1
        WHERE status = 'running' AND started_at < now() - make_interval(mins => $2)`,
      [`abandoned: no result within ${STALE_RUN_MINUTES} minutes`, STALE_RUN_MINUTES]
    );
    const [running] = await q<RunRow>(`SELECT ${RUN_COLUMNS} FROM report_refresh_run WHERE status = 'running' LIMIT 1`);
    if (running) return { kind: "running", run: toRun(running) };
    if (input.trigger === "user") {
      const [recent] = await q<RunRow & { age_seconds: number | string }>(
        `SELECT ${RUN_COLUMNS}, EXTRACT(EPOCH FROM (now() - started_at))::float8 AS age_seconds
           FROM report_refresh_run ORDER BY id DESC LIMIT 1`
      );
      const age = recent ? Number(recent.age_seconds) : Infinity;
      if (recent && age < RATE_LIMIT_SECONDS) {
        return { kind: "rate_limited", run: toRun(recent), retryAfterSeconds: Math.ceil(RATE_LIMIT_SECONDS - age) };
      }
    }
    const [created] = await q<RunRow>(
      `INSERT INTO report_refresh_run (trigger, requested_by, today, step)
       VALUES ($1, $2, $3, 'claimed') RETURNING ${RUN_COLUMNS}`,
      [input.trigger, input.requestedBy, input.today]
    );
    return { kind: "claimed", run: toRun(created) };
  });
}

export async function setRunStep(runId: number, step: string): Promise<void> {
  await query(`UPDATE report_refresh_run SET step = $2 WHERE id = $1 AND status = 'running'`, [runId, step]);
}

export async function getRun(runId: number): Promise<RefreshRun | null> {
  const [row] = await query<RunRow>(`SELECT ${RUN_COLUMNS} FROM report_refresh_run WHERE id = $1`, [runId]);
  return row ? toRun(row) : null;
}

/** The newest successful run (what the page shows) and the newest run of any status. */
export async function latestRuns(): Promise<{ succeeded: RefreshRun | null; latest: RefreshRun | null }> {
  const [succeeded] = await query<RunRow>(
    `SELECT ${RUN_COLUMNS} FROM report_refresh_run WHERE status = 'succeeded' ORDER BY id DESC LIMIT 1`
  );
  const [latest] = await query<RunRow>(`SELECT ${RUN_COLUMNS} FROM report_refresh_run ORDER BY id DESC LIMIT 1`);
  return { succeeded: succeeded ? toRun(succeeded) : null, latest: latest ? toRun(latest) : null };
}

function runActor(run: RefreshRun): string {
  return run.trigger === "cron" ? "cron:reporting-goals" : `human:${run.requestedBy}`;
}

// ─── Snapshot writes ────────────────────────────────────────────────────────

type Column = readonly [name: string, pgType: string];

/** Bulk insert through unnest(): one round trip per table. */
async function insertRows(q: TxQuery, table: string, columns: readonly Column[], rows: readonly unknown[][]): Promise<void> {
  if (rows.length === 0) return;
  const names = columns.map(([name]) => name).join(", ");
  const arrays = columns.map(([, type], i) => `$${i + 1}::${type}[]`).join(", ");
  await q(
    `INSERT INTO ${table} (${names}) SELECT * FROM unnest(${arrays})`,
    columns.map((_, i) => rows.map((row) => row[i]))
  );
}

async function insertSnapshot(q: TxQuery, runId: number, d: Datasets): Promise<void> {
  const id = (rows: unknown[][]) => rows.map((row) => [runId, ...row]);
  await insertRows(
    q,
    "report_snap_goal_summary",
    [["run_id", "bigint"], ["large_done", "integer"], ["large_scheduled_ahead", "integer"], ["large_open_past_date", "integer"]],
    id([[d.goalSummary.largeDone, d.goalSummary.largeScheduledAhead, d.goalSummary.largeOpenPastDate]])
  );
  await insertRows(
    q,
    "report_snap_daily",
    [["run_id", "bigint"], ["day", "date"], ["large_done", "integer"], ["large_open", "integer"],
      ["cad_this", "numeric"], ["usd_this", "numeric"], ["cad_last", "numeric"], ["usd_last", "numeric"]],
    id(d.daily.map((r) => [r.day, r.largeDone, r.largeOpen, r.cadThis, r.usdThis, r.cadLast, r.usdLast]))
  );
  await insertRows(
    q,
    "report_snap_truckload",
    [["run_id", "bigint"], ["code", "text"], ["shipment", "text"], ["ship_date", "date"],
      ["product_usd", "numeric"], ["product_cad", "numeric"], ["this_month", "boolean"]],
    id(d.truckloads.map((r) => [r.code, r.shipment, r.shipDate, r.productUsd, r.productCad, r.thisMonth]))
  );
  await insertRows(
    q,
    "report_snap_revenue",
    [["run_id", "bigint"], ["currency", "text"], ["this_month", "boolean"], ["invoices", "integer"], ["net_before_tax", "numeric"]],
    id(d.revenue.map((r) => [r.currency, r.thisMonth, r.invoices, r.netBeforeTax]))
  );
  await insertRows(
    q,
    "report_snap_shipment",
    [["run_id", "bigint"], ["row_no", "integer"], ["invoice", "text"], ["shipment", "text"], ["order_no", "text"],
      ["po", "text"], ["customer_code", "text"], ["customer", "text"], ["ship_date", "date"], ["currency", "text"],
      ["product_value", "numeric"], ["other_charges", "numeric"], ["net_before_tax", "numeric"]],
    id(d.shipments.map((r, i) => [i + 1, r.invoice, r.shipment, r.orderNo, r.po, r.customerCode, r.customer,
      r.shipDate, r.currency, r.productValue, r.otherCharges, r.netBeforeTax]))
  );
  await insertRows(
    q,
    "report_snap_batch",
    [["run_id", "bigint"], ["batch_id", "text"], ["batch", "text"], ["product", "text"], ["status", "text"],
      ["status_qc", "text"], ["line", "text"], ["day", "date"], ["kg", "numeric"]],
    id(d.batches.map((r) => [r.id, r.batch, r.product, r.status, r.statusQc, r.line, r.date, r.kg]))
  );
  await insertRows(
    q,
    "report_snap_batch_history",
    [["run_id", "bigint"], ["batch_id", "text"], ["batch", "text"], ["day", "date"], ["kg", "numeric"], ["status_qc", "text"]],
    id(d.batchHistory.map((r) => [r.id, r.batch, r.date, r.kg, r.statusQc]))
  );
  await insertRows(
    q,
    "report_snap_reference",
    [["run_id", "bigint"], ["kind", "text"], ["ref", "text"]],
    id(d.references.map((r) => [r.kind, r.ref]))
  );
  await insertRows(
    q,
    "report_snap_customer",
    [["run_id", "bigint"], ["code", "text"], ["name", "text"], ["currency", "text"]],
    id(d.customers.map((r) => [r.code, r.name, r.currency]))
  );
}

export function rowCounts(d: Datasets): Record<string, number> {
  return {
    daily: d.daily.length,
    truckloads: d.truckloads.length,
    revenue: d.revenue.length,
    shipments: d.shipments.length,
    batches: d.batches.length,
    batchHistory: d.batchHistory.length,
    references: d.references.length,
    customers: d.customers.length,
  };
}

export interface ResolvedRate {
  rate: string;
  date: IsoDate;
  source: FxSource;
}

/**
 * Store every dataset and mark the run succeeded in one transaction, so a
 * failure part-way never leaves a half snapshot. Prunes old runs afterwards.
 */
export async function completeRun(run: RefreshRun, datasets: Datasets, fx: ResolvedRate, ms: number): Promise<RefreshRun> {
  const counts = rowCounts(datasets);
  return withTransaction(async (q) => {
    await insertSnapshot(q, run.id, datasets);
    const [done] = await q<RunRow>(
      `UPDATE report_refresh_run
          SET status = 'succeeded', step = NULL, finished_at = now(), error = NULL,
              production_cutoff = $2, sage_cutoff = $3, fx_rate = $4, fx_rate_date = $5, fx_source = $6,
              row_counts = $7
        WHERE id = $1 AND status = 'running'
        RETURNING ${RUN_COLUMNS}`,
      [run.id, datasets.cutoffs.productionCutoff, datasets.cutoffs.sageCutoff, fx.rate, fx.date, fx.source, JSON.stringify(counts)]
    );
    if (!done) throw new Error(`run ${run.id} is no longer running (abandoned after ${STALE_RUN_MINUTES} minutes)`);
    await q(
      `DELETE FROM report_refresh_run WHERE status <> 'running' AND started_at < now() - make_interval(days => $1)`,
      [RETENTION_DAYS]
    );
    for (const table of ["report_snap_reference", "report_snap_customer"]) {
      await q(
        `DELETE FROM ${table}
          WHERE run_id NOT IN (SELECT id FROM report_refresh_run WHERE status = 'succeeded' ORDER BY id DESC LIMIT $1)`,
        [LIST_RETENTION_RUNS]
      );
    }
    await appendEventTx(q, {
      kind: "reporting.goals.refresh.succeeded",
      actor: runActor(run),
      payload: { runId: run.id, trigger: run.trigger, today: run.today, ms, rowCounts: counts, fxSource: fx.source },
    });
    return toRun(done);
  });
}

export async function failRun(run: RefreshRun, failure: { code: string; message: string }, ms: number): Promise<RefreshRun> {
  return withTransaction(async (q) => {
    const [failed] = await q<RunRow>(
      `UPDATE report_refresh_run
          SET status = 'failed', step = NULL, finished_at = now(), error = $2
        WHERE id = $1 AND status = 'running'
        RETURNING ${RUN_COLUMNS}`,
      [run.id, `${failure.code}: ${failure.message}`]
    );
    await appendEventTx(q, {
      kind: "reporting.goals.refresh.failed",
      actor: runActor(run),
      payload: { runId: run.id, trigger: run.trigger, today: run.today, ms, code: failure.code },
    });
    if (failed) return toRun(failed);
    const [current] = await q<RunRow>(`SELECT ${RUN_COLUMNS} FROM report_refresh_run WHERE id = $1`, [run.id]);
    return toRun(current);
  });
}

// ─── Snapshot reads ─────────────────────────────────────────────────────────

/** The page's datasets for one run (cutoffs come from the run row). */
export async function loadSnapshot(run: RefreshRun): Promise<SnapshotData> {
  // One connection, sequential reads: the snapshot is immutable once written.
  return withTransaction(async (q) => {
    const [summary] = await q<{ large_done: number; large_scheduled_ahead: number; large_open_past_date: number }>(
      `SELECT large_done, large_scheduled_ahead, large_open_past_date FROM report_snap_goal_summary WHERE run_id = $1`,
      [run.id]
    );
    const daily = await q<{ day: string; large_done: number; large_open: number; cad_this: string; usd_this: string; cad_last: string; usd_last: string }>(
      `SELECT day::text AS day, large_done, large_open, cad_this::text AS cad_this, usd_this::text AS usd_this,
              cad_last::text AS cad_last, usd_last::text AS usd_last
         FROM report_snap_daily WHERE run_id = $1 ORDER BY day`,
      [run.id]
    );
    const truckloads = await q<{ code: string; shipment: string; ship_date: string; product_usd: string; product_cad: string; this_month: boolean }>(
      `SELECT code, shipment, ship_date::text AS ship_date, product_usd::text AS product_usd,
              product_cad::text AS product_cad, this_month
         FROM report_snap_truckload WHERE run_id = $1 ORDER BY ship_date, code, shipment`,
      [run.id]
    );
    const revenue = await q<{ currency: string; this_month: boolean; invoices: number; net_before_tax: string }>(
      `SELECT currency, this_month, invoices, net_before_tax::text AS net_before_tax
         FROM report_snap_revenue WHERE run_id = $1 ORDER BY this_month DESC, currency`,
      [run.id]
    );
    const shipments = await q<{
      invoice: string; shipment: string | null; order_no: string | null; po: string | null; customer_code: string | null;
      customer: string | null; ship_date: string; currency: string; product_value: string; other_charges: string; net_before_tax: string;
    }>(
      `SELECT invoice, shipment, order_no, po, customer_code, customer, ship_date::text AS ship_date, currency,
              product_value::text AS product_value, other_charges::text AS other_charges, net_before_tax::text AS net_before_tax
         FROM report_snap_shipment WHERE run_id = $1 ORDER BY row_no`,
      [run.id]
    );
    const batches = await q<{ batch_id: string; batch: string; product: string | null; status: string; status_qc: string | null; line: string | null; day: string; kg: string }>(
      `SELECT batch_id, batch, product, status, status_qc, line, day::text AS day, kg::text AS kg
         FROM report_snap_batch WHERE run_id = $1 ORDER BY day, batch`,
      [run.id]
    );
    const history = await q<{ batch_id: string; batch: string; day: string; kg: string; status_qc: string | null }>(
      `SELECT batch_id, batch, day::text AS day, kg::text AS kg, status_qc
         FROM report_snap_batch_history WHERE run_id = $1 ORDER BY day, batch`,
      [run.id]
    );
    return {
      cutoffs: { productionCutoff: run.productionCutoff, sageCutoff: run.sageCutoff },
      goalSummary: {
        largeDone: summary?.large_done ?? 0,
        largeScheduledAhead: summary?.large_scheduled_ahead ?? 0,
        largeOpenPastDate: summary?.large_open_past_date ?? 0,
      },
      daily: daily.map((r) => ({
        day: r.day, largeDone: r.large_done, largeOpen: r.large_open,
        cadThis: r.cad_this, usdThis: r.usd_this, cadLast: r.cad_last, usdLast: r.usd_last,
      })),
      truckloads: truckloads.map((r) => ({
        code: r.code, shipment: r.shipment, shipDate: r.ship_date,
        productUsd: r.product_usd, productCad: r.product_cad, thisMonth: r.this_month,
      })),
      revenue: revenue.map((r) => ({
        currency: r.currency, thisMonth: r.this_month, invoices: r.invoices, netBeforeTax: r.net_before_tax,
      })),
      shipments: shipments.map((r) => ({
        invoice: r.invoice, shipment: r.shipment, orderNo: r.order_no, po: r.po, customerCode: r.customer_code,
        customer: r.customer, shipDate: r.ship_date, currency: r.currency, productValue: r.product_value,
        otherCharges: r.other_charges, netBeforeTax: r.net_before_tax,
      })),
      batches: batches.map((r) => ({
        id: r.batch_id, batch: r.batch, product: r.product, status: r.status, statusQc: r.status_qc,
        line: r.line, date: r.day, kg: r.kg,
      })),
      batchHistory: history.map((r) => ({ id: r.batch_id, batch: r.batch, date: r.day, kg: r.kg, statusQc: r.status_qc })),
    };
  });
}

/** Which of these normalized references the run's FileMaker and Sage lists contain. */
export async function loadReferenceMatches(
  runId: number,
  refs: readonly string[]
): Promise<{ filemaker: Set<string>; sage: Set<string> }> {
  const out = { filemaker: new Set<string>(), sage: new Set<string>() };
  const wanted = [...new Set(refs.filter(Boolean))];
  if (wanted.length === 0) return out;
  const rows = await query<{ kind: "filemaker" | "sage"; ref: string }>(
    `SELECT kind, ref FROM report_snap_reference WHERE run_id = $1 AND ref = ANY($2::text[])`,
    [runId, wanted]
  );
  for (const row of rows) out[row.kind].add(row.ref);
  return out;
}

// ─── Configuration ──────────────────────────────────────────────────────────

export interface GoalsConfig {
  settings: GoalSettings;
  ftlCustomers: FtlCustomer[];
  holidays: Set<IsoDate>;
}

export async function loadConfig(): Promise<GoalsConfig> {
  const settingRows = await query<{ key: string; value: string | null }>(
    `SELECT key, value::text AS value FROM report_goal_setting`
  );
  const setting = new Map(settingRows.map((r) => [r.key, r.value]));
  const required = (key: string): string => {
    const value = setting.get(key);
    if (value === undefined || value === null) throw new Error(`report_goal_setting.${key} is not set`);
    return value;
  };
  const truckTarget = setting.get("full_truckloads_per_month");
  const settings: GoalSettings = {
    largeBatchesPerWorkingDay: Number(required("large_batches_per_working_day")),
    largeBatchMinKg: Number(required("large_batch_min_kg")),
    fullTruckloadMinUsdCents: toCents(required("full_truckload_min_usd")),
    revenueTargetCadCents: toCents(required("revenue_target_cad")),
    fullTruckloadsPerMonth: truckTarget === undefined || truckTarget === null ? null : Number(truckTarget),
  };
  const customers = await query<{ code: string; display_name: string; name_patterns: string[]; sort_order: number }>(
    `SELECT code, display_name, name_patterns, sort_order FROM report_ftl_customer WHERE active ORDER BY sort_order, code`
  );
  const holidays = await query<{ day: string }>(`SELECT day::text AS day FROM report_holiday`);
  return {
    settings,
    ftlCustomers: customers.map((c) => ({
      code: c.code,
      displayName: c.display_name,
      namePatterns: c.name_patterns,
      sortOrder: c.sort_order,
    })),
    holidays: new Set(holidays.map((h) => h.day)),
  };
}

// ─── USD/CAD history ────────────────────────────────────────────────────────

export async function upsertFxRates(rates: readonly FxRate[]): Promise<void> {
  if (rates.length === 0) return;
  await query(
    `INSERT INTO report_fx_rate (series, rate_date, rate)
     SELECT $1, d, r FROM unnest($2::date[], $3::numeric[]) AS t(d, r)
     ON CONFLICT (series, rate_date) DO UPDATE SET rate = EXCLUDED.rate, fetched_at = now()`,
    [FX_SERIES, rates.map((r) => r.date), rates.map((r) => r.rate)]
  );
}

export async function latestStoredRate(onOrBefore: IsoDate): Promise<FxRate | null> {
  const [row] = await query<{ rate_date: string; rate: string }>(
    `SELECT rate_date::text AS rate_date, rate::text AS rate FROM report_fx_rate
      WHERE series = $1 AND rate_date <= $2 ORDER BY rate_date DESC LIMIT 1`,
    [FX_SERIES, onOrBefore]
  );
  return row ? { date: row.rate_date, rate: row.rate } : null;
}

export async function loadRates(from: IsoDate, to: IsoDate): Promise<FxRate[]> {
  const rows = await query<{ rate_date: string; rate: string }>(
    `SELECT rate_date::text AS rate_date, rate::text AS rate FROM report_fx_rate
      WHERE series = $1 AND rate_date BETWEEN $2 AND $3 ORDER BY rate_date`,
    [FX_SERIES, from, to]
  );
  return rows.map((r) => ({ date: r.rate_date, rate: r.rate }));
}

// ─── Manual entries (read; the writes are in entries.ts) ────────────────────

export interface EntryRow {
  entry_id: string;
  type: string;
  day: string | null;
  reference: string | null;
  customer: string | null;
  customer_code: string | null;
  product: string | null;
  kg: string | null;
  product_value: string | null;
  freight: string | null;
  currency: string | null;
  note: string | null;
  entered_by: string;
  entered_at: Date | string;
  updated_by: string;
  updated_at: Date | string;
  source: string;
}

/** The report_manual_entry columns an EntryRow holds (SELECT and RETURNING lists). */
export const ENTRY_SQL_COLUMNS = `entry_id, type, day::text AS day, reference, customer, customer_code, product,
  kg::text AS kg, product_value::text AS product_value, freight::text AS freight, currency, note,
  entered_by, entered_at, updated_by, updated_at, source`;

export function toEntry(r: EntryRow): ManualEntry {
  return {
    entryId: r.entry_id,
    type: r.type,
    date: r.day,
    reference: r.reference,
    customer: r.customer,
    customerCode: r.customer_code,
    product: r.product,
    kg: r.kg,
    productValue: r.product_value,
    freight: r.freight,
    currency: r.currency,
    note: r.note,
    enteredBy: r.entered_by,
    enteredAt: iso(r.entered_at),
    updatedBy: r.updated_by,
    updatedAt: iso(r.updated_at),
    source: r.source,
  };
}

/** Live (not deleted) manual entries, oldest first; pass `q` to read inside a transaction. */
export async function listEntries(q: TxQuery = query): Promise<ManualEntry[]> {
  const rows = await q<EntryRow>(
    `SELECT ${ENTRY_SQL_COLUMNS} FROM report_manual_entry WHERE deleted_at IS NULL ORDER BY id`
  );
  return rows.map(toEntry);
}
