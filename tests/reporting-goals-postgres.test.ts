// Goals & Production against real Postgres: migrations 039 and 042 on a
// disposable PG16, a synthetic reporting replica (silver.batches as a view, Sage
// columns as space-padded text) loaded from the 2026-10-14 fixtures, and the
// shipped read-only grant script. Disposable local PG16 only: no external URLs
// or credentials are consumed.

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";

import { Client, type ClientConfig, type Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { main as migrate } from "../scripts/migrate.mjs";
import { POSTGRES_IMAGE, ensurePostgresImage } from "../scripts/lib/postgres-image.mjs";

const state = vi.hoisted(() => ({ mcUrl: "", reportingUrl: "" }));
vi.mock("@/lib/secrets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/secrets")>()),
  databaseUrl: () => state.mcUrl,
  databaseConfigured: () => true,
  reportingDatabaseUrl: () => state.reportingUrl,
  reportingDatabaseConfigured: () => true,
}));
vi.mock("@/lib/db/tls", () => ({ resolveDbSsl: () => false }));

import {
  centsToDecimal,
  loadConfig,
  loadGoalsView,
  normalizeRef,
  readDatasets,
  runRefresh,
  startRefresh,
  toCents,
  type Datasets,
  type RefreshRun,
} from "@/lib/reporting/goals";

import { FORECAST_CATEGORY_COLUMNS, FORECAST_COLUMNS, forecastRows, type ForecastView } from "@/lib/reporting/goals";
import { SHIPMENT_LINE_COLUMNS, invoiceLines, loadShipmentLines } from "@/lib/reporting/goals";
import { loadForecast } from "@/lib/reporting/goals/forecast-store";
import { forecastAosQuery } from "@/lib/reporting/goals/queries/forecast-assembly-orders";
import { missingColumns, type ColumnList } from "@/lib/reporting/goals/queries/read-access";
import type { SourceQuery } from "@/lib/reporting/goals/source-db";

import { createForecastSourceTables, loadForecastSource } from "./reporting-goals-forecast-replica";
import { DATASETS, FORECAST, SHIPMENT_LINES, TODAY } from "./reporting-goals-helpers";
import { createShipmentLineSourceTables, loadShipmentLineSource } from "./reporting-goals-shipment-lines-replica";
import source from "./fixtures/reporting-goals/2026-10-14/source.json";
import entries from "./fixtures/reporting-goals/2026-10-14/entries.json";

class LocalClient extends Client {
  constructor(options: ClientConfig) {
    super({ ...options, ssl: false });
  }
}

const NAME = `plx-mc-goals-pg-${randomBytes(4).toString("hex")}`;
const RATE = [{ date: TODAY, rate: "1.4219" }];
const fetchRates = async () => RATE;
const noSleep = async () => {};
const money = (cents: number) => centsToDecimal(cents);
let started = false;
let adminUrl = "";
let admin: Client;
let reportingAdmin: Client;

async function connect(url: string): Promise<Client> {
  for (let attempt = 0; ; attempt++) {
    const client = new LocalClient({ connectionString: url });
    try {
      await client.connect();
      return client;
    } catch {
      await client.end().catch(() => undefined);
      if (attempt >= 60) throw new Error("local PG16 unavailable");
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

async function loadReplica(db: Client): Promise<void> {
  await db.query(`
    CREATE SCHEMA silver;
    CREATE SCHEMA sage;
    CREATE TABLE public.batch (
      id bigint PRIMARY KEY, display_batch_number text, status text, status_qc text, line text,
      date_completed date, date_scheduled date, planned_qty numeric, actual_qty numeric,
      cal_title text, updated_at timestamptz, unit_cost numeric
    );
    CREATE VIEW silver.batches AS SELECT * FROM public.batch;
    CREATE TABLE sage.oe_invoice_header (
      invnumber text, shinumber text, ordnumber text, ponumber text, customer text, bilname text,
      shipdate text, invdate text, insourcurr text, invitmtot text, invdiscamt text, invmisc text,
      invnetnotx text, audtdate text, inrate text DEFAULT '1.25'
    );
    CREATE TABLE sage.ar_customer (idcust text, namecust text, codecurn text, swactv text DEFAULT '1');
  `);
  for (const b of source.batches) {
    await db.query(
      `INSERT INTO public.batch (id, display_batch_number, status, status_qc, line, date_completed, date_scheduled,
         planned_qty, actual_qty, cal_title, updated_at, unit_cost)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, 1.23)`,
      [b.id, b.display_batch_number, b.status, b.status_qc, b.line, b.date_completed, b.date_scheduled,
        b.planned_qty, b.actual_qty, b.cal_title, b.updated_at]
    );
  }
  for (const i of source.invoices) {
    await db.query(
      `INSERT INTO sage.oe_invoice_header (invnumber, shinumber, ordnumber, ponumber, customer, bilname, shipdate,
         invdate, insourcurr, invitmtot, invdiscamt, invmisc, invnetnotx, audtdate)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [i.invnumber, i.shinumber, i.ordnumber, i.ponumber, i.customer, i.bilname, i.shipdate, i.invdate,
        i.insourcurr, i.invitmtot, i.invdiscamt, i.invmisc, i.invnetnotx, i.audtdate]
    );
  }
  for (const c of source.customers) {
    await db.query(`INSERT INTO sage.ar_customer (idcust, namecust, codecurn) VALUES ($1, $2, $3)`, [c.idcust, c.namecust, c.codecurn]);
  }
  // Empty until the revenue forecast's and the shipment lines' tests load them (the grant script grants on them).
  await createForecastSourceTables(db);
  await createShipmentLineSourceTables(db);
  // The shipped grant script, as a DBA would run it (psql variable filled in).
  const grants = readFileSync(path.join(__dirname, "..", "docs", "modules", "reporting-goals", "readonly-grants.sql"), "utf8");
  await db.query(grants.replace(":'password'", "'disposable-test-password'"));
}

async function mcQuery<R>(text: string, params: unknown[] = []): Promise<R[]> {
  return (await admin.query(text, params)).rows as R[];
}

async function allowNextUserRefresh(): Promise<void> {
  await mcQuery(`UPDATE report_refresh_run SET started_at = started_at - interval '10 minutes'`);
}

/** Run a shipped grant script on the replica with psql, as a DBA would (each variable as -v name=value). */
function psqlScript(file: string, vars: Record<string, string> = {}): void {
  const script = readFileSync(path.join(__dirname, "..", "docs", "modules", "reporting-goals", file), "utf8");
  const run = spawnSync(
    "docker",
    ["exec", "-i", NAME, "psql", "-U", "postgres", "-d", "reporting_goals", "-v", "ON_ERROR_STOP=1",
      ...Object.entries(vars).flatMap(([name, value]) => ["-v", `${name}=${value}`]), "-f", "-"],
    { input: script, encoding: "utf8" }
  );
  expect(run.status, run.stderr).toBe(0);
}

beforeAll(async () => {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  const password = randomBytes(12).toString("hex");
  expect(ensurePostgresImage()).toMatchObject({ ok: true });
  const run = spawnSync("docker", ["run", "-d", "--name", NAME, "-e", `POSTGRES_PASSWORD=${password}`, "-p", `127.0.0.1:${port}:5432`, POSTGRES_IMAGE], { encoding: "utf8" });
  expect(run.status, run.stderr).toBe(0);
  started = true;
  adminUrl = `postgres://postgres:${password}@127.0.0.1:${port}/postgres`;
  const bootstrap = await connect(adminUrl);
  await bootstrap.query("CREATE DATABASE mc_goals");
  await bootstrap.query("CREATE DATABASE reporting_goals");
  await bootstrap.end();

  state.mcUrl = adminUrl.replace(/\/postgres$/, "/mc_goals");
  expect(await migrate({ env: { NODE_ENV: "test", PLX_MC_DATABASE_URL: state.mcUrl }, ClientClass: LocalClient, log: () => {} })).toBe(0);
  admin = await connect(state.mcUrl);

  reportingAdmin = await connect(adminUrl.replace(/\/postgres$/, "/reporting_goals"));
  await loadReplica(reportingAdmin);
  state.reportingUrl = `postgres://mc_goals_ro:disposable-test-password@127.0.0.1:${port}/reporting_goals`;
}, 120_000);

afterAll(async () => {
  const pools = globalThis as typeof globalThis & { __plxMcPool?: Pool; __plxReportingPool?: Pool };
  await pools.__plxMcPool?.end();
  await pools.__plxReportingPool?.end();
  delete pools.__plxMcPool;
  delete pools.__plxReportingPool;
  await admin?.end();
  await reportingAdmin?.end();
  if (started) expect(spawnSync("docker", ["rm", "-f", NAME]).status).toBe(0);
});

/**
 * Compare datasets with money and kg as exact values (Sage keeps three
 * decimals), independent of collation-dependent ordering of equal sort keys.
 */
function canonical(d: Datasets) {
  const cents = (v: string) => toCents(v);
  const sorted = <T>(rows: T[]) => rows.map((r) => JSON.stringify(r)).sort();
  return {
    cutoffs: d.cutoffs,
    daily: d.daily.map((r) => ({ ...r, cadThis: cents(r.cadThis), usdThis: cents(r.usdThis), cadLast: cents(r.cadLast), usdLast: cents(r.usdLast) })),
    truckloads: sorted(d.truckloads.map((r) => ({ ...r, productUsd: cents(r.productUsd), productCad: cents(r.productCad) }))),
    revenue: sorted(d.revenue.map((r) => ({ ...r, netBeforeTax: cents(r.netBeforeTax) }))),
    shipments: sorted(d.shipments.map((r) => ({ ...r, productValue: cents(r.productValue), otherCharges: cents(r.otherCharges), netBeforeTax: cents(r.netBeforeTax) }))),
    batches: sorted(d.batches.map((r) => ({ ...r, kg: Number(r.kg) }))),
    batchHistory: sorted(d.batchHistory.map((r) => ({ ...r, kg: Number(r.kg) }))),
    references: d.references.map((r) => `${r.kind}:${normalizeRef(r.ref)}`).sort(),
    customers: sorted(d.customers),
  };
}

describe("reporting replica access", () => {
  it("reads only the granted columns and never writes", async () => {
    const ro = await connect(state.reportingUrl);
    try {
      await expect(ro.query("SELECT inrate FROM sage.oe_invoice_header LIMIT 1")).rejects.toMatchObject({ code: "42501" });
      await expect(ro.query("SELECT unit_cost FROM silver.batches LIMIT 1")).rejects.toMatchObject({ code: "42501" });
      await expect(ro.query("INSERT INTO sage.ar_customer (idcust) VALUES ('X')")).rejects.toMatchObject({ code: "25006" });
    } finally {
      await ro.end();
    }
  });

  it("returns the fixture datasets for 2026-10-14 through the read-only login", async () => {
    const datasets = await readDatasets(TODAY, await loadConfig());
    expect(canonical(datasets)).toEqual(canonical(DATASETS));
    expect(datasets.cutoffs.productionCutoff).toBe(TODAY);
  });

  it("keeps invoices without a shipment number as separate shipments, each in its own month", async () => {
    // Three US$10,000 invoices to A1 American with no shipment number: one in
    // September, two this month. Grouped together they would read as a
    // US$30,000 full load in September; each is really a partial load.
    const blank = [
      ["IN-NOSHIP-1", "", "20260925"],
      ["IN-NOSHIP-2", "   ", "20261013"],
      ["IN-NOSHIP-3", "", "20261014"],
    ];
    for (const [invnumber, shinumber, day] of blank) {
      await reportingAdmin.query(
        `INSERT INTO sage.oe_invoice_header (invnumber, shinumber, ordnumber, ponumber, customer, bilname, shipdate,
           invdate, insourcurr, invitmtot, invdiscamt, invmisc, invnetnotx, audtdate)
         VALUES ($1, $2, '', '', 'A1TEXT11    ', 'A1 American', $3, $3, 'USD', '10000.000', '0.000', '0.000', '10000.000', $3)`,
        [invnumber, shinumber, day]
      );
    }
    try {
      const datasets = await readDatasets(TODAY, await loadConfig());
      const loads = datasets.truckloads.filter((t) => t.shipment.includes("IN-NOSHIP"));
      expect(loads.map((t) => [t.shipment, t.thisMonth, toCents(t.productUsd)]).sort()).toEqual([
        ["invoice:IN-NOSHIP-1", false, 1_000_000],
        ["invoice:IN-NOSHIP-2", true, 1_000_000],
        ["invoice:IN-NOSHIP-3", true, 1_000_000],
      ]);
      // Every other shipment is exactly as before.
      expect(canonical({ ...datasets, truckloads: datasets.truckloads.filter((t) => !loads.includes(t)) }).truckloads).toEqual(
        canonical(DATASETS).truckloads
      );
    } finally {
      await reportingAdmin.query(`DELETE FROM sage.oe_invoice_header WHERE invnumber LIKE 'IN-NOSHIP-%'`);
    }
  });
});

describe("refresh and page model", () => {
  let first: RefreshRun;

  it("stores a snapshot the page reproduces exactly", async () => {
    const claim = await startRefresh("cron", "cron", new Date("2026-10-14T10:00:00Z"));
    expect(claim.kind).toBe("claimed");
    first = await runRefresh(claim.run, { fetchRates, sleep: noSleep });
    expect(first).toMatchObject({ status: "succeeded", today: TODAY, productionCutoff: TODAY, sageCutoff: TODAY, fxRate: "1.421900", fxRateDate: TODAY, fxSource: "boc", error: null });
    expect(first.rowCounts).toMatchObject({ batches: 94, shipments: 70, daily: 31, batchHistory: 16 });

    const view = await loadGoalsView();
    expect(view.state).toBe("ready");
    expect(view.run?.id).toBe(first.id);
    const model = view.model!;
    // Line 1 bulk from the stored batch list (tests/fixtures/reporting-goals/2026-10-14/expected.json).
    expect(model.line1).toMatchObject({
      totalKg: 72_652,
      dueSoFarKg: 180_000,
      targetKg: 420_000,
      scheduledFromTodayKg: 136_555,
      openPastDateKg: 76_940,
      ifAllRunKg: 286_147,
    });
    expect(model.truckloads.full.total).toBe(2);
    expect(model.truckloads.lastMonth).toMatchObject({ full: 7, partial: 5 });
    expect(money(model.revenue.totalCents)).toBe("367014.16");
    expect(money(model.revenue.dueSoFarCents)).toBe("428571.43");
    expect(money(model.revenue.neededPerDayCents)).toBe("48691.22");
    expect(money(model.revenue.lastMonthCadCents)).toBe("1007365.11");
    expect(model.takeaway).toBe(
      "72,652 kg of Line 1 bulk against 180,000 kg due so far, 2 full truckloads, and $367,014 of the $428,571 revenue due so far."
    );
    // The retired large-batch snapshot is no longer written; the daily rows take 042's defaults.
    expect(await mcQuery(`SELECT 1 FROM report_snap_goal_summary WHERE run_id = $1`, [first.id])).toEqual([]);
    expect(await mcQuery(`SELECT DISTINCT large_done, large_open FROM report_snap_daily WHERE run_id = $1`, [first.id])).toEqual([
      { large_done: 0, large_open: 0 },
    ]);

    const events = await mcQuery<{ kind: string; actor: string }>(`SELECT kind, actor FROM mc_events WHERE kind LIKE 'reporting.goals.%' ORDER BY seq`);
    expect(events).toEqual([{ kind: "reporting.goals.refresh.succeeded", actor: "cron:reporting-goals" }]);
  });

  it("counts manual entries live against the stored references", async () => {
    for (const e of entries as Array<Record<string, string | undefined>>) {
      await mcQuery(
        `INSERT INTO report_manual_entry (entry_id, type, day, reference, customer, product, kg, product_value, freight,
           currency, note, entered_by, updated_by, source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'vince@petrasoap.com','vince@petrasoap.com','ui')`,
        [e.entryId, e.type, e.date, e.reference, e.customer ?? null, e.product ?? null, e.kg ?? null,
          e.productValue ?? null, e.freight ?? null, e.currency ?? null, e.note ?? null]
      );
    }
    const model = (await loadGoalsView()).model!;
    expect(Object.fromEntries(model.entries.map((e) => [e.entryId, e.status]))).toEqual({
      M001: "counted", M002: "counted", M003: "counted", M004: "in_sage", M005: "in_filemaker", M006: "not_this_month", M007: "counted",
    });
    expect(model.line1).toMatchObject({ byHandKg: 19_050, totalKg: 91_702, openPastDateKg: 66_940, ifAllRunKg: 295_197 });
    expect(model.line1.neededPerDayKg.toFixed(2)).toBe("25253.69");
    expect(model.truckloads.full.total).toBe(3);
    expect(money(model.revenue.totalCents)).toBe("408628.08");
    expect(money(model.revenue.neededPerDayCents)).toBe("45490.15");
    // A soft-deleted entry stops counting.
    await mcQuery(`UPDATE report_manual_entry SET deleted_at = now(), deleted_by = 'vince@petrasoap.com' WHERE entry_id = 'M007'`);
    expect(money((await loadGoalsView()).model!.revenue.totalCents)).toBe("403628.08");
  });

  it("keeps the last good snapshot when a refresh fails, and records why", async () => {
    await reportingAdmin.query("REVOKE SELECT ON sage.oe_invoice_header FROM mc_goals_ro");
    try {
      await allowNextUserRefresh();
      const claim = await startRefresh("user", "vince@petrasoap.com", new Date("2026-10-14T15:00:00Z"));
      expect(claim.kind).toBe("claimed");
      const failed = await runRefresh(claim.run, { fetchRates, sleep: noSleep });
      expect(failed.status).toBe("failed");
      expect(failed.error).toMatch(/^42501: permission denied for table oe_invoice_header/);
      const view = await loadGoalsView();
      expect(view.run?.id).toBe(first.id);
      expect(view.latestAttempt).toMatchObject({ id: failed.id, status: "failed" });
      expect(money(view.model!.revenue.inSystemCents)).toBe("367014.16");
      const [event] = await mcQuery<{ actor: string; payload: { code: string } }>(
        `SELECT actor, payload FROM mc_events WHERE kind = 'reporting.goals.refresh.failed' ORDER BY seq DESC LIMIT 1`
      );
      expect(event).toMatchObject({ actor: "human:vince@petrasoap.com", payload: { code: "42501" } });
    } finally {
      // The table-level REVOKE took the column grants with it: restore readonly-grants.sql's.
      await reportingAdmin.query(`GRANT SELECT (invnumber, shinumber, ordnumber, ponumber, customer, bilname, shipdate, insourcurr,
        invitmtot, invdiscamt, invmisc, invnetnotx, audtdate, invuniq) ON sage.oe_invoice_header TO mc_goals_ro`);
    }
  });

  it("retries a transient error twice at most, and only within the time budget", async () => {
    const real = (today: string, config: Parameters<typeof readDatasets>[1], timeout: number) => readDatasets(today, config, timeout);
    const transient = () => Object.assign(new Error("canceling statement due to conflict with recovery"), { code: "40001" });

    await allowNextUserRefresh();
    let calls = 0;
    const waits: number[] = [];
    let claim = await startRefresh("user", "vince@petrasoap.com", new Date("2026-10-14T15:10:00Z"));
    const recovered = await runRefresh(claim.run, {
      fetchRates,
      sleep: async (ms) => { waits.push(ms); },
      readSources: (...args) => (++calls === 1 ? Promise.reject(transient()) : real(...args)),
    });
    expect(recovered.status).toBe("succeeded");
    expect(calls).toBe(2);
    expect(waits).toEqual([5_000]);

    await allowNextUserRefresh();
    calls = 0;
    claim = await startRefresh("user", "vince@petrasoap.com", new Date("2026-10-14T15:20:00Z"));
    const gaveUp = await runRefresh(claim.run, { fetchRates, sleep: noSleep, readSources: () => (calls++, Promise.reject(transient())) });
    expect(gaveUp.status).toBe("failed");
    expect(calls).toBe(3);

    await allowNextUserRefresh();
    calls = 0;
    claim = await startRefresh("user", "vince@petrasoap.com", new Date("2026-10-14T15:30:00Z"));
    const noTime = await runRefresh(claim.run, { fetchRates, sleep: noSleep, budgetMs: 60_000, readSources: () => (calls++, Promise.reject(transient())) });
    expect(noTime.status).toBe("failed");
    expect(calls).toBe(1); // another 120 s attempt would not fit in 60 s

    await allowNextUserRefresh();
    calls = 0;
    claim = await startRefresh("user", "vince@petrasoap.com", new Date("2026-10-14T15:40:00Z"));
    const permanent = await runRefresh(claim.run, {
      fetchRates,
      sleep: noSleep,
      readSources: () => (calls++, Promise.reject(Object.assign(new Error("column does not exist"), { code: "42703" }))),
    });
    expect(permanent.error).toMatch(/^42703:/);
    expect(calls).toBe(1);
  });

  it("falls back to the last stored rate, and fails without one", async () => {
    await allowNextUserRefresh();
    const down = async () => { throw new Error("getaddrinfo ENOTFOUND www.bankofcanada.ca"); };
    let claim = await startRefresh("user", "vince@petrasoap.com", new Date("2026-10-14T16:00:00Z"));
    const fallback = await runRefresh(claim.run, { fetchRates: down, sleep: noSleep });
    expect(fallback).toMatchObject({ status: "succeeded", fxRate: "1.421900", fxSource: "stored" });
    expect((await loadGoalsView()).fx).toMatchObject({ source: "stored", stale: true });

    await mcQuery(`DELETE FROM report_fx_rate WHERE series = 'FXUSDCAD'`);
    await allowNextUserRefresh();
    claim = await startRefresh("user", "vince@petrasoap.com", new Date("2026-10-14T16:10:00Z"));
    const noRate = await runRefresh(claim.run, { fetchRates: down, sleep: noSleep });
    expect(noRate.status).toBe("failed");
    expect(noRate.error).toMatch(/^fx_unavailable:/);
    await mcQuery(`INSERT INTO report_fx_rate (series, rate_date, rate) VALUES ('FXUSDCAD', $1, 1.4219)`, [TODAY]);
  });
});

describe("claims, limits and retention", () => {
  it("allows one running refresh, limits users to one per 5 minutes, and fails abandoned runs", async () => {
    await allowNextUserRefresh();
    const claimed = await startRefresh("user", "vince@petrasoap.com");
    expect(claimed.kind).toBe("claimed");
    expect((await startRefresh("cron", "cron")).kind).toBe("running");
    expect((await startRefresh("user", "someone@petrasoap.com")).kind).toBe("running");

    // The running row is 11 minutes old: its function died; the next claim fails it.
    await mcQuery(`UPDATE report_refresh_run SET started_at = now() - interval '11 minutes' WHERE id = $1`, [claimed.run.id]);
    const afterStale = await startRefresh("cron", "cron");
    expect(afterStale.kind).toBe("claimed");
    const [abandoned] = await mcQuery<{ status: string; error: string }>(`SELECT status, error FROM report_refresh_run WHERE id = $1`, [claimed.run.id]);
    expect(abandoned).toEqual({ status: "failed", error: "abandoned: no result within 10 minutes" });

    await runRefresh(afterStale.run, { fetchRates, sleep: noSleep });
    const limited = await startRefresh("user", "vince@petrasoap.com");
    expect(limited.kind).toBe("rate_limited");
    if (limited.kind === "rate_limited") {
      expect(limited.retryAfterSeconds).toBeGreaterThan(290);
      expect(limited.retryAfterSeconds).toBeLessThanOrEqual(300);
    }
    // The schedule is never rate limited.
    const cron = await startRefresh("cron", "cron");
    expect(cron.kind).toBe("claimed");
    if (cron.kind === "claimed") await runRefresh(cron.run, { fetchRates, sleep: noSleep });
  });

  it("prunes runs after 90 days and keeps the large lists for the last three good runs", async () => {
    const [{ id: oldest }] = await mcQuery<{ id: string }>(`SELECT id FROM report_refresh_run ORDER BY id LIMIT 1`);
    await mcQuery(`UPDATE report_refresh_run SET started_at = now() - interval '91 days' WHERE id = $1`, [oldest]);
    await allowNextUserRefresh();
    const claim = await startRefresh("user", "vince@petrasoap.com");
    await runRefresh(claim.run, { fetchRates, sleep: noSleep });

    expect(await mcQuery(`SELECT id FROM report_refresh_run WHERE id = $1`, [oldest])).toEqual([]);
    expect(await mcQuery(`SELECT 1 FROM report_snap_batch WHERE run_id = $1`, [oldest])).toEqual([]);
    const withLists = await mcQuery<{ run_id: string }>(`SELECT DISTINCT run_id FROM report_snap_reference ORDER BY run_id DESC`);
    const lastGood = await mcQuery<{ id: string }>(`SELECT id FROM report_refresh_run WHERE status = 'succeeded' ORDER BY id DESC LIMIT 3`);
    expect(withLists.map((r) => String(r.run_id))).toEqual(lastGood.map((r) => String(r.id)));
    const customers = await mcQuery<{ run_id: string }>(`SELECT DISTINCT run_id FROM report_snap_customer ORDER BY run_id DESC`);
    expect(customers.map((r) => String(r.run_id))).toEqual(lastGood.map((r) => String(r.id)));
  });
});

describe("migration 042: Line 1 bulk settings, expand only", () => {
  const RETIRED = ["large_batches_per_working_day", "large_batch_min_kg"];

  it("seeds the Line 1 settings beside 039's retired large-batch rows, and reads only the Line 1 ones", async () => {
    const rows = await mcQuery<{ key: string; value: string; updated_by: string }>(
      `SELECT key, value::text AS value, updated_by FROM report_goal_setting WHERE key = ANY($1::text[]) ORDER BY key COLLATE "C"`,
      [[...RETIRED, "line1_kg_per_working_day", "line1_min_kg"]]
    );
    expect(rows).toEqual([
      { key: "large_batch_min_kg", value: "7500", updated_by: "migration:039" },
      { key: "large_batches_per_working_day", value: "2", updated_by: "migration:039" },
      { key: "line1_kg_per_working_day", value: "20000", updated_by: "migration:042" },
      { key: "line1_min_kg", value: "5000", updated_by: "migration:042" },
    ]);
    const { settings } = await loadConfig();
    expect(settings).toEqual({
      line1KgPerWorkingDay: 20_000,
      line1MinKg: 5_000,
      fullTruckloadMinUsdCents: 1_800_000,
      revenueTargetCadCents: 100_000_000,
      fullTruckloadsPerMonth: null,
    });
    const line1 = (await loadGoalsView()).model!.line1;
    // The retired rows change nothing, even unset; an unset Line 1 row is an error, never a silent 0.
    await mcQuery(`UPDATE report_goal_setting SET value = NULL WHERE key = ANY($1::text[])`, [RETIRED]);
    try {
      expect((await loadConfig()).settings).toEqual(settings);
      expect((await loadGoalsView()).model!.line1).toEqual(line1);
      await mcQuery(`UPDATE report_goal_setting SET value = NULL WHERE key = 'line1_min_kg'`);
      await expect(loadConfig()).rejects.toThrow("report_goal_setting.line1_min_kg is not set");
    } finally {
      await mcQuery(
        `UPDATE report_goal_setting
            SET value = CASE key WHEN 'large_batches_per_working_day' THEN 2 WHEN 'large_batch_min_kg' THEN 7500 ELSE 5000 END
          WHERE key = ANY($1::text[])`,
        [[...RETIRED, "line1_min_kg"]]
      );
    }
    expect((await loadConfig()).settings).toEqual(settings);
  });

  it("still takes the previous release's large-batch snapshot writes", async () => {
    // Production applies 042 before the new code deploys: until then the live release writes these.
    const [{ id }] = await mcQuery<{ id: string }>(
      `INSERT INTO report_refresh_run (trigger, requested_by, today, status, finished_at, error)
       VALUES ('cron', 'cron', $1, 'failed', now(), 'test: previous release') RETURNING id`,
      [TODAY]
    );
    try {
      await mcQuery(
        `INSERT INTO report_snap_goal_summary (run_id, large_done, large_scheduled_ahead, large_open_past_date) VALUES ($1, 6, 11, 7)`,
        [id]
      );
      await mcQuery(
        `INSERT INTO report_snap_daily (run_id, day, large_done, large_open, cad_this, usd_this, cad_last, usd_last)
         VALUES ($1, $2, 1, 4, 0, 0, 0, 0)`,
        [id, TODAY]
      );
      expect(await mcQuery(`SELECT large_done, large_open FROM report_snap_daily WHERE run_id = $1`, [id])).toEqual([
        { large_done: 1, large_open: 4 },
      ]);
    } finally {
      await mcQuery(`DELETE FROM report_refresh_run WHERE id = $1`, [id]);
    }
  });
});

describe("revenue forecast (TASK-3151)", () => {
  const sortedJson = <T>(rows: T[]) => rows.map((r) => JSON.stringify(r)).sort();
  // Every forecast column but silver.batches' (granted with the report itself), as the refresh names them.
  const NEW_COLUMNS = FORECAST_COLUMNS.filter(([schema, table]) => `${schema}.${table}` !== "silver.batches");
  const missingNames = NEW_COLUMNS.flatMap(([schema, table, columns]) => columns.map((c) => `${schema}.${table}.${c}`));

  function ready(view: ForecastView | null) {
    if (view?.state !== "ready") throw new Error(`forecast is ${view?.state ?? "missing"}`);
    return view;
  }

  beforeAll(async () => {
    await loadForecastSource(reportingAdmin);
  });

  it("never reads Sage's COMPLETE flags or FileMaker's calculated leftovers", async () => {
    const ro = await connect(state.reportingUrl);
    try {
      await expect(ro.query("SELECT complete FROM sage.oe_order_header LIMIT 1")).rejects.toMatchObject({ code: "42501" });
      await expect(ro.query("SELECT complete FROM sage.oe_order_detail LIMIT 1")).rejects.toMatchObject({ code: "42501" });
      await expect(ro.query("SELECT qtymfgleftoe_c FROM public.assembly_order LIMIT 1")).rejects.toMatchObject({ code: "42501" });
    } finally {
      await ro.end();
    }
  });

  it("returns the fixture's open order lines and assembly orders through the read-only login", async () => {
    // Left out by the SQL: a quote, a standing order, a TEST order (reference) and one whose description
    // says test, a line due next month, a line with no expected date, a misc charge, a "C" line, fully
    // shipped lines (one with Sage's COMPLETE = 1, one on an order whose COMPLETE enum says 4) and a line
    // whose posted shipment covers it. Kept: an order whose COMPLETE enum says 3 but still has quantity
    // to ship, a future order, and a line dated by its order (its own expdate is 0). OR1000160001's
    // November line of the same item rides on its October line as laterQty.
    const { forecast } = await readDatasets(TODAY, await loadConfig());
    expect(forecast.access).toBe("read");
    expect(forecast.missing).toEqual([]);
    expect(forecast.lines).toEqual(FORECAST.data.lines);
    // AOs: oelist_c, else FileMaker's order-entry link (AO-26301E); the bulk batch through idbatch, else
    // idbatch_pre (AO-26307B); none for an old AO on a closed order or one due next month only.
    expect(sortedJson(forecast.aos)).toEqual(sortedJson(FORECAST.data.aos));
  });

  it("links every AO to its order-entry orders in one pass, not a lookup per AO", async () => {
    // The query reads every AO, and the login's statement timeout is 120 s: on 30,000 synthetic AOs a
    // lookup per AO took 78 s, one grouped pass 2 s.
    const ro = await connect(state.reportingUrl);
    try {
      const plan = await ro.query<{ "QUERY PLAN": string }>(`EXPLAIN ${forecastAosQuery.sql}`, [TODAY]);
      expect(plan.rows.map((r) => r["QUERY PLAN"]).join("\n")).not.toMatch(/SubPlan/);
    } finally {
      await ro.end();
    }
  });

  it("without its grants (an existing login), the forecast waits for read access and everything else refreshes", async () => {
    for (const [schema, table, columns] of NEW_COLUMNS) {
      await reportingAdmin.query(`REVOKE SELECT (${columns.map((c) => `"${c}"`).join(", ")}) ON ${schema}.${table} FROM mc_goals_ro`);
    }
    await allowNextUserRefresh();
    const claim = await startRefresh("user", "vince@petrasoap.com", new Date("2026-10-14T17:00:00Z"));
    expect(claim.kind).toBe("claimed");
    const run = await runRefresh(claim.run, { fetchRates, sleep: noSleep });
    expect(run).toMatchObject({ status: "succeeded", error: null });
    expect(run.rowCounts).toMatchObject({ batches: 94, shipments: 70, daily: 31, forecastLines: 0, forecastAos: 0 });

    const [summary] = await mcQuery<{ access: string; missing: string[]; lines: number; ready_cad: string | null }>(
      `SELECT access, missing, lines, ready_cad::text AS ready_cad FROM report_snap_forecast_summary WHERE run_id = $1`,
      [run.id]
    );
    expect(summary).toEqual({ access: "missing", missing: missingNames, lines: 0, ready_cad: null });
    expect(await mcQuery(`SELECT 1 FROM report_snap_forecast_line WHERE run_id = $1`, [run.id])).toEqual([]);
    const [event] = await mcQuery<{ payload: { runId: number; forecast: string } }>(
      `SELECT payload FROM mc_events WHERE kind = 'reporting.goals.refresh.succeeded' ORDER BY seq DESC LIMIT 1`
    );
    expect(event.payload).toMatchObject({ runId: run.id, forecast: "missing" });

    const view = await loadGoalsView();
    expect(view.run?.id).toBe(run.id);
    expect(view.forecast).toEqual({
      state: "waiting_for_access",
      missing: NEW_COLUMNS.map(([schema, table, columns]) => ({ relation: `${schema}.${table}`, columns: [...columns] })),
    });
    expect(money(view.model!.revenue.inSystemCents)).toBe("367014.16");
  });

  it("after readonly-grants-forecast.sql (re-runnable), the next refresh stores the datasets and the run's summary", async () => {
    psqlScript("readonly-grants-forecast.sql");
    psqlScript("readonly-grants-forecast.sql");
    await allowNextUserRefresh();
    const claim = await startRefresh("user", "vince@petrasoap.com", new Date("2026-10-14T17:10:00Z"));
    const run = await runRefresh(claim.run, { fetchRates, sleep: noSleep });
    expect(run).toMatchObject({ status: "succeeded", error: null });
    expect(run.rowCounts).toMatchObject({ batches: 94, forecastLines: 15, forecastAos: 21 });

    const [summary] = await mcQuery(
      `SELECT access, missing, lines, ready_cad::text AS ready, planned_cad::text AS planned, late_cad::text AS late,
              not_planned_cad::text AS not_planned
         FROM report_snap_forecast_summary WHERE run_id = $1`,
      [run.id]
    );
    expect(summary).toEqual({
      access: "read", missing: [], lines: 15, ready: "53762.80", planned: "64627.53", late: "27917.55", not_planned: "12785.70",
    });
    // The datasets come back from storage exactly as they were read.
    const stored = await loadForecast(run);
    expect(stored?.data.lines).toEqual(FORECAST.data.lines);
    expect(sortedJson(stored?.data.aos ?? [])).toEqual(sortedJson(FORECAST.data.aos));

    const view = await loadGoalsView();
    const forecast = ready(view.forecast);
    // Stored and read back, the rows are exactly what the fixture's datasets give.
    expect(forecast.rows).toEqual(forecastRows(FORECAST.data, TODAY, run.fxRate!));
    expect(forecast.invoicedCents).toBe(view.model!.revenue.totalCents);
    expect(forecast.theoreticalCents - forecast.invoicedCents).toBe(11_839_033);
    expect(money(forecast.atRiskCents)).toBe("40703.25");
    expect(forecast.unordered).toEqual({ count: 2, pieces: 8400 });
    // Only October is on record, and the oldest month on record never counts (runs are kept 90 days, so its
    // first runs may be gone): the hit rate starts with November.
    expect([forecast.realistic, forecast.measuredFrom]).toEqual([null, "2026-11-01"]);
  });

  it("measures the hit rate once a month is complete, from the stored summaries", async () => {
    // September's first good run: 5,000 CAD invoiced so far, 900,000 ready + planned. An August run from before
    // the forecast is on record, so September's first runs are too. Run ids follow time (claims are serialized),
    // so the backdated runs take ids -1 and 0. Today's run closes September.
    await mcQuery(
      `INSERT INTO report_refresh_run (id, trigger, requested_by, today, status, started_at, finished_at, fx_rate, fx_rate_date, fx_source)
       VALUES (-1, 'cron', 'cron', '2026-08-31', 'succeeded', now() - interval '46 days', now() - interval '46 days', 1.38, '2026-08-28', 'boc')`
    );
    const [sep] = await mcQuery<{ id: string }>(
      `INSERT INTO report_refresh_run (id, trigger, requested_by, today, status, started_at, finished_at, fx_rate, fx_rate_date, fx_source)
       VALUES (0, 'cron', 'cron', '2026-09-01', 'succeeded', now() - interval '45 days', now() - interval '45 days', 1.37, '2026-08-31', 'boc')
       RETURNING id`
    );
    await mcQuery(
      `INSERT INTO report_snap_revenue (run_id, currency, this_month, invoices, net_before_tax) VALUES ($1, 'CAD', true, 1, 5000)`,
      [sep.id]
    );
    await mcQuery(
      `INSERT INTO report_snap_forecast_summary (run_id, access, lines, ready_cad, planned_cad, late_cad, not_planned_cad)
       VALUES ($1, 'read', 40, 500000, 400000, 10, 20)`,
      [sep.id]
    );
    const view = await loadGoalsView();
    const forecast = ready(view.forecast);
    // Closed by today's run: September is 683,025.94 CAD + US$228,102.66 × 1.37 (312,500.64), less the 5,000 at its first run.
    expect(forecast.realistic!.months).toEqual([
      expect.objectContaining({ month: "2026-09-01", firstRunId: Number(sep.id), readyPlannedCents: 90_000_000, invoicedAfterCents: 99_052_658 }),
    ]);
    expect(forecast.measuredFrom).toBe("2026-09-01");
    expect(forecast.realistic!.cents).toBe(forecast.invoicedCents + Math.round((11_839_033 * 99_052_658) / 90_000_000));
  });

  it("goes with its run: pruning a run deletes its forecast rows and summary", async () => {
    const [waiting] = await mcQuery<{ run_id: string }>(
      `SELECT run_id FROM report_snap_forecast_summary WHERE access = 'missing' ORDER BY run_id DESC LIMIT 1`
    );
    const [read] = await mcQuery<{ run_id: string }>(
      `SELECT run_id FROM report_snap_forecast_summary WHERE access = 'read' AND lines = 15 ORDER BY run_id DESC LIMIT 1`
    );
    await mcQuery(`UPDATE report_refresh_run SET started_at = now() - interval '91 days' WHERE id = ANY($1::bigint[])`, [[waiting.run_id, read.run_id]]);
    await allowNextUserRefresh();
    const claim = await startRefresh("user", "vince@petrasoap.com", new Date("2026-10-14T17:20:00Z"));
    await runRefresh(claim.run, { fetchRates, sleep: noSleep });
    for (const table of ["report_snap_forecast_summary", "report_snap_forecast_line", "report_snap_forecast_ao"]) {
      expect(await mcQuery(`SELECT 1 FROM ${table} WHERE run_id = ANY($1::bigint[])`, [[waiting.run_id, read.run_id]]), table).toEqual([]);
    }
  });

  it("without Sage's item category (a login granted before TASK-3177), the forecast fills in and only the category filter waits", async () => {
    await reportingAdmin.query(`REVOKE SELECT ("category") ON sage.oe_order_detail FROM mc_goals_ro`);
    try {
      await allowNextUserRefresh();
      const claim = await startRefresh("user", "vince@petrasoap.com", new Date("2026-10-14T17:30:00Z"));
      const run = await runRefresh(claim.run, { fetchRates, sleep: noSleep });
      expect(run).toMatchObject({ status: "succeeded", error: null });
      expect(run.rowCounts).toMatchObject({ forecastLines: 15, forecastAos: 21 });
      const [summary] = await mcQuery(
        `SELECT access, missing, category_missing FROM report_snap_forecast_summary WHERE run_id = $1`,
        [run.id]
      );
      expect(summary).toEqual({ access: "read", missing: [], category_missing: ["sage.oe_order_detail.category"] });
      const forecast = ready((await loadGoalsView()).forecast);
      expect(forecast.categoryMissing).toEqual(["sage.oe_order_detail.category"]);
      expect(forecast.rows).toHaveLength(18);
      expect(forecast.rows.every((r) => r.category === null && r.channel === null)).toBe(true);
      expect(money(forecast.atRiskCents)).toBe("40703.25");
    } finally {
      psqlScript("readonly-grants-forecast.sql");
    }
    // Re-running the forecast's grant script grants the category: the next refresh stores it, upper case and trimmed.
    await allowNextUserRefresh();
    const claim = await startRefresh("user", "vince@petrasoap.com", new Date("2026-10-14T17:40:00Z"));
    const run = await runRefresh(claim.run, { fetchRates, sleep: noSleep });
    const [summary] = await mcQuery(`SELECT category_missing FROM report_snap_forecast_summary WHERE run_id = $1`, [run.id]);
    expect(summary).toEqual({ category_missing: [] });
    expect((await loadForecast(run))?.data.lines).toEqual(FORECAST.data.lines);
  });
});

describe("shipment lines (TASK-3144)", () => {
  // What readonly-grants-shipment-lines.sql grants an existing login: the header's join key and every detail
  // column (the header's invnumber and shipdate came with the report), as the refresh names them.
  const NEW_COLUMNS = SHIPMENT_LINE_COLUMNS.map(
    ([schema, table, columns]) => [schema, table, table === "oe_invoice_header" ? columns.filter((c) => c === "invuniq") : [...columns]] as const
  );
  const missingNames = NEW_COLUMNS.flatMap(([schema, table, columns]) => columns.map((c) => `${schema}.${table}.${c}`));
  const offInvoices = (lines: typeof SHIPMENT_LINES, rows: Parameters<typeof invoiceLines>[0]) =>
    [...invoiceLines(rows, lines).entries()].filter(([, v]) => !v.agrees).map(([key]) => key);

  beforeAll(async () => {
    await loadShipmentLineSource(reportingAdmin);
  });

  it("never reads Sage's costs or how the invoice discount is spread over the lines", async () => {
    const ro = await connect(state.reportingUrl);
    try {
      for (const column of ["unitcost", "exticost", "hdrdisc"]) {
        await expect(ro.query(`SELECT ${column} FROM sage.oe_invoice_detail LIMIT 1`), column).rejects.toMatchObject({ code: "42501" });
      }
    } finally {
      await ro.end();
    }
  });

  it("returns the lines of exactly this month's invoices through the read-only login, by invoice and line number", async () => {
    // Left out by the SQL: two September invoices' lines (one shipped Sep 30 and dated Oct 1) and a line whose
    // invoice isn't on the replica. Kept, from rows inserted out of order: charges (the code from MISCCHARGE, or
    // ITEM when that is blank), a line with a blank line type (an item), line numbers past 96 in number order,
    // and quantities, prices and amounts as Sage keeps them.
    const { shipmentLines } = await readDatasets(TODAY, await loadConfig());
    expect(shipmentLines).toEqual({ access: "read", missing: [], lines: SHIPMENT_LINES });
  });

  it("without its grants (an existing login), the lines wait for read access and everything else refreshes", async () => {
    for (const [schema, table, columns] of NEW_COLUMNS) {
      await reportingAdmin.query(`REVOKE SELECT (${columns.map((c) => `"${c}"`).join(", ")}) ON ${schema}.${table} FROM mc_goals_ro`);
    }
    await allowNextUserRefresh();
    const claim = await startRefresh("user", "vince@petrasoap.com", new Date("2026-10-14T18:00:00Z"));
    expect(claim.kind).toBe("claimed");
    const run = await runRefresh(claim.run, { fetchRates, sleep: noSleep });
    expect(run).toMatchObject({ status: "succeeded", error: null });
    expect(run.rowCounts).toMatchObject({ batches: 94, shipments: 70, shipmentLines: 0, forecastLines: 15 });

    const [summary] = await mcQuery<{ access: string; missing: string[]; lines: number }>(
      `SELECT access, missing, lines FROM report_snap_shipment_line_summary WHERE run_id = $1`,
      [run.id]
    );
    expect(summary).toEqual({ access: "missing", missing: missingNames, lines: 0 });
    expect(await mcQuery(`SELECT 1 FROM report_snap_shipment_line WHERE run_id = $1`, [run.id])).toEqual([]);
    const [event] = await mcQuery<{ payload: { runId: number; shipmentLines: string; forecast: string } }>(
      `SELECT payload FROM mc_events WHERE kind = 'reporting.goals.refresh.succeeded' ORDER BY seq DESC LIMIT 1`
    );
    expect(event.payload).toMatchObject({ runId: run.id, shipmentLines: "missing", forecast: "read" });

    const view = await loadGoalsView();
    expect(view.run?.id).toBe(run.id);
    expect(view.shipmentLines).toEqual({
      state: "waiting_for_access",
      missing: NEW_COLUMNS.map(([schema, table, columns]) => ({ relation: `${schema}.${table}`, columns: [...columns] })),
    });
    expect(view.shipments.filter((r) => r.source === "Sage")).toHaveLength(70);
    expect(money(view.model!.revenue.inSystemCents)).toBe("367014.16");
    expect(await loadShipmentLines(run.id)).toEqual({ access: "missing", missing: missingNames, lines: [] });
  });

  it("after readonly-grants-shipment-lines.sql (re-runnable), the next refresh stores the lines, read back exactly", async () => {
    psqlScript("readonly-grants-shipment-lines.sql");
    psqlScript("readonly-grants-shipment-lines.sql");
    await allowNextUserRefresh();
    const claim = await startRefresh("user", "vince@petrasoap.com", new Date("2026-10-14T18:10:00Z"));
    const run = await runRefresh(claim.run, { fetchRates, sleep: noSleep });
    expect(run).toMatchObject({ status: "succeeded", error: null });
    expect(run.rowCounts).toMatchObject({ shipments: 70, shipmentLines: 133 });

    const [summary] = await mcQuery(`SELECT access, missing, lines FROM report_snap_shipment_line_summary WHERE run_id = $1`, [run.id]);
    expect(summary).toEqual({ access: "read", missing: [], lines: 133 });
    // Stored and read back with Sage's own scales (4-decimal quantities, 6-decimal prices, 3-decimal amounts).
    const stored = await loadShipmentLines(run.id);
    expect(stored).toEqual({ access: "read", missing: [], lines: SHIPMENT_LINES });

    // The page says they're there without carrying them; the list's rows and the stored lines reconcile as on the page.
    const view = await loadGoalsView();
    expect(view.shipmentLines).toEqual({ state: "ready", lines: 133 });
    expect(JSON.stringify(view)).not.toContain("Fuel surcharge");
    expect(offInvoices(stored!.lines, view.shipments)).toEqual(["sage:IN1000180353", "sage:IN1000180370", "sage:IN1000180368"]);
  });

  it("goes with its run: pruning a run deletes its lines and their summary", async () => {
    const [read] = await mcQuery<{ run_id: string }>(
      `SELECT run_id FROM report_snap_shipment_line_summary WHERE access = 'read' AND lines = 133 ORDER BY run_id DESC LIMIT 1`
    );
    const [waiting] = await mcQuery<{ run_id: string }>(
      `SELECT run_id FROM report_snap_shipment_line_summary WHERE access = 'missing' ORDER BY run_id DESC LIMIT 1`
    );
    await mcQuery(`UPDATE report_refresh_run SET started_at = now() - interval '91 days' WHERE id = ANY($1::bigint[])`, [[read.run_id, waiting.run_id]]);
    await allowNextUserRefresh();
    const claim = await startRefresh("user", "vince@petrasoap.com", new Date("2026-10-14T18:20:00Z"));
    await runRefresh(claim.run, { fetchRates, sleep: noSleep });
    for (const table of ["report_snap_shipment_line_summary", "report_snap_shipment_line"]) {
      expect(await mcQuery(`SELECT 1 FROM ${table} WHERE run_id = ANY($1::bigint[])`, [[read.run_id, waiting.run_id]]), table).toEqual([]);
    }
    expect(await loadShipmentLines(Number(read.run_id))).toBeNull();
  });
});

describe("grant scripts for another role (TASK-3558)", () => {
  // Through plx-reporting-mcp the refresh's read-access checks run as the MCP server's own role, not mc_goals_ro.
  // The forecast's and the invoice lines' scripts grant the role psql's -v role names (here one that needs quoting).
  const ROLE = "reporting-mcp-ro";
  // What each script grants: every column its dataset reads but those readonly-grants.sql grants with the report.
  const FORECAST_GRANTED: ColumnList = [...FORECAST_COLUMNS, ...FORECAST_CATEGORY_COLUMNS].filter(
    ([schema, table]) => `${schema}.${table}` !== "silver.batches"
  );
  const LINES_GRANTED: ColumnList = SHIPMENT_LINE_COLUMNS.map(
    ([schema, table, columns]) => [schema, table, table === "oe_invoice_header" ? columns.filter((c) => c === "invuniq") : [...columns]] as const
  );
  const names = (list: ColumnList) => list.flatMap(([schema, table, columns]) => columns.map((c) => `${schema}.${table}.${c}`));
  let asRole: Client;
  const q: SourceQuery = async (text, params) => (await asRole.query(text, params)).rows;

  beforeAll(async () => {
    await reportingAdmin.query(`CREATE ROLE "${ROLE}" LOGIN PASSWORD 'disposable-mcp-password'`);
    asRole = await connect(state.reportingUrl.replace("mc_goals_ro:disposable-test-password", `${ROLE}:disposable-mcp-password`));
  });

  afterAll(async () => {
    await asRole?.end();
  });

  it("with -v role, both scripts grant that role exactly the columns their datasets read (re-runnable)", async () => {
    // Before the scripts run for it, the role reads none of these columns.
    expect(await missingColumns(q, FORECAST_GRANTED)).toEqual(names(FORECAST_GRANTED));
    expect(await missingColumns(q, LINES_GRANTED)).toEqual(names(LINES_GRANTED));
    for (const file of ["readonly-grants-forecast.sql", "readonly-grants-shipment-lines.sql"]) {
      psqlScript(file, { role: ROLE });
      psqlScript(file, { role: ROLE });
    }
    // The refresh's own check, through the role's own login, finds nothing missing.
    expect(await missingColumns(q, FORECAST_GRANTED)).toEqual([]);
    expect(await missingColumns(q, LINES_GRANTED)).toEqual([]);
    // Column-level SELECT on exactly those columns: nothing at table level, nothing else.
    const columns = await reportingAdmin.query<{ name: string; privilege: string }>(
      `SELECT table_schema || '.' || table_name || '.' || column_name AS name, privilege_type AS privilege
         FROM information_schema.column_privileges WHERE grantee = $1`,
      [ROLE]
    );
    expect(columns.rows.every((r) => r.privilege === "SELECT")).toBe(true);
    expect(columns.rows.map((r) => r.name).sort()).toEqual([...names(FORECAST_GRANTED), ...names(LINES_GRANTED)].sort());
    expect((await reportingAdmin.query(`SELECT 1 FROM information_schema.table_privileges WHERE grantee = $1`, [ROLE])).rows).toEqual([]);
  });
});
