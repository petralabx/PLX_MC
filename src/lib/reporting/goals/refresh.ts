// Refresh orchestration: claim → USD/CAD rate → every dataset query in one
// read-only REPEATABLE READ transaction on the reporting replica (or, when
// configured, through plx-reporting-mcp, one statement at a time: TASK-3489) →
// all snapshots stored in one Mission Control transaction. A failure is
// recorded on the run and the page keeps showing the last good one. Server-only.

import { reportingMcpConfigured } from "@/lib/secrets";

import { previousMonthStart, torontoDate } from "./calendar";
import { readForecast } from "./forecast-read";
import { fetchUsdCadRates, type FetchRates } from "./fx";
import { batchHistoryQuery } from "./queries/batch-history";
import { batchesQuery } from "./queries/batches";
import { customersQuery } from "./queries/customers";
import { cutoffsQuery } from "./queries/cutoffs";
import { dailyQuery } from "./queries/daily";
import { missingColumns } from "./queries/read-access";
import { referencesQuery } from "./queries/references";
import { revenueByCurrencyQuery } from "./queries/revenue-by-currency";
import type { DatasetQuery } from "./queries/shared";
import { SHIPMENT_LINE_COLUMNS, shipmentLinesQuery } from "./queries/shipment-lines";
import { shipmentsQuery } from "./queries/shipments";
import { truckloadsQuery } from "./queries/truckloads";
import { latestRateOnOrBefore } from "./rules";
import { ATTEMPT_TIMEOUT_MS, withReportingSnapshot, type SourceQuery } from "./source-db";
import { withReportingMcp } from "./source-mcp";
import {
  claimRun,
  completeRun,
  failRun,
  latestStoredRate,
  loadConfig,
  setRunStep,
  upsertFxRates,
  type ClaimOutcome,
  type GoalsConfig,
  type ResolvedRate,
} from "./store";
import type { Datasets, IsoDate, RefreshRun, RefreshTrigger, ShipmentLinesDataset } from "./types";

/** Time a refresh may take in total: the routes' maxDuration (300 s) less a margin. */
export const REFRESH_BUDGET_MS = 280_000;
/** Waits before the second and third attempt (brief: retry twice with backoff). */
export const RETRY_BACKOFF_MS: readonly number[] = [5_000, 15_000];

export type RefreshStep = "exchange-rate" | "reading-sources" | "saving";

export interface RefreshDeps {
  fetchRates?: FetchRates;
  /** Reads every dataset (default: readDatasets on the reporting replica). */
  readSources?: (today: IsoDate, config: GoalsConfig, attemptTimeoutMs: number) => Promise<Datasets>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  budgetMs?: number;
  attemptTimeoutMs?: number;
  backoffMs?: readonly number[];
}

/** A refresh failure with a stable code (what the run row and mc_events record). */
export class RefreshFailure extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message);
  }
}

/** Claim a refresh for `trigger`; today is the Toronto date of `now`. */
export function startRefresh(trigger: RefreshTrigger, requestedBy: string, now: Date = new Date()): Promise<ClaimOutcome> {
  return claimRun({ trigger, requestedBy, today: torontoDate(now) });
}

/**
 * The lines of this month's Sage invoices (TASK-3144), in the refresh's own
 * transaction: the catalog check first, then the query, or neither. Missing
 * grants never fail the refresh.
 */
async function readShipmentLines(q: SourceQuery, today: IsoDate): Promise<ShipmentLinesDataset> {
  const missing = await missingColumns(q, SHIPMENT_LINE_COLUMNS);
  if (missing.length > 0) return { access: "missing", missing, lines: [] };
  return { access: "read", missing: [], lines: shipmentLinesQuery.map(await q(shipmentLinesQuery.sql, [today])) };
}

/**
 * Read every dataset for `today` from the replica: through plx-reporting-mcp
 * when REPORTING_MCP_URL and REPORTING_MCP_TOKEN are set, else in one
 * consistent transaction on REPORTING_DATABASE_URL.
 */
export async function readDatasets(
  today: IsoDate,
  config: GoalsConfig,
  attemptTimeoutMs: number = ATTEMPT_TIMEOUT_MS
): Promise<Datasets> {
  const codes = config.ftlCustomers.map((c) => c.code);
  const withSource = reportingMcpConfigured() ? withReportingMcp : withReportingSnapshot;
  return withSource(async (q: SourceQuery) => {
    const read = async <R extends object, O>(dataset: DatasetQuery<R, O>, params: unknown[]): Promise<O> =>
      dataset.map(await q<R>(dataset.sql, params));
    return {
      cutoffs: await read(cutoffsQuery, [today]),
      daily: await read(dailyQuery, [today]),
      truckloads: await read(truckloadsQuery, [today, codes]),
      revenue: await read(revenueByCurrencyQuery, [today]),
      shipments: await read(shipmentsQuery, [today]),
      batches: await read(batchesQuery, [today]),
      batchHistory: await read(batchHistoryQuery, [today]),
      references: await read(referencesQuery, [today]),
      customers: await read(customersQuery, []),
      // Only when the login can read Sage's invoice lines (TASK-3144).
      shipmentLines: await readShipmentLines(q, today),
      // Last, and only when the login can read its tables (TASK-3151).
      forecast: await readForecast(q, today),
    };
  }, attemptTimeoutMs);
}

// Errors worth another attempt: a replica recovery conflict or serialization
// failure, a cancelled statement, the server restarting or refusing
// connections, and dropped sockets. Permission, syntax and data errors are not.
const TRANSIENT_SQLSTATES = new Set(["40001", "40P01", "57014", "57P01", "57P02", "57P03", "53300", "08000", "08001", "08003", "08004", "08006"]);
const TRANSIENT_NODE_CODES = new Set(["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE", "EAI_AGAIN"]);
// The reporting MCP (source-mcp.ts): rate limited, the gateway or service down, or unreachable.
const TRANSIENT_MCP_CODE = /^mcp_(http_(429|5\d\d)|network)$/;

export function isTransient(err: unknown): boolean {
  const code = (err as { code?: unknown })?.code;
  if (typeof code === "string" && (TRANSIENT_SQLSTATES.has(code) || TRANSIENT_NODE_CODES.has(code) || TRANSIENT_MCP_CODE.test(code))) return true;
  const message = err instanceof Error ? err.message : "";
  return /Connection terminated|timeout exceeded when trying to connect/i.test(message);
}

function describe(err: unknown): { code: string; message: string } {
  const code = (err as { code?: unknown })?.code;
  const message = err instanceof Error ? err.message : String(err);
  return {
    code: typeof code === "string" && code ? code : "error",
    // Run outcomes only: pg messages name objects, not row contents. Bounded.
    message: message.replace(/\s+/g, " ").slice(0, 300),
  };
}

async function resolveRate(today: IsoDate, fetchRates: FetchRates): Promise<ResolvedRate> {
  try {
    const rates = await fetchRates(previousMonthStart(today), today);
    await upsertFxRates(rates);
    const latest = latestRateOnOrBefore(rates, today);
    if (latest) return { rate: latest.rate, date: latest.date, source: "boc" };
    throw new Error("the Bank of Canada returned no USD/CAD rate");
  } catch (err) {
    console.warn("[reporting-goals] Bank of Canada rate unavailable (%s); using the last stored rate", describe(err).message);
    const stored = await latestStoredRate(today);
    if (!stored) {
      throw new RefreshFailure("fx_unavailable", "No USD/CAD rate: the Bank of Canada fetch failed and no rate is stored yet.");
    }
    return { rate: stored.rate, date: stored.date, source: "stored" };
  }
}

/**
 * Run a claimed refresh to the end. Source, rate and timeout failures are
 * recorded on the run (never thrown); only a Mission Control database failure
 * propagates. Retries a transient source error at most twice, and only while
 * another full attempt still fits in the time budget.
 */
export async function runRefresh(run: RefreshRun, deps: RefreshDeps = {}): Promise<RefreshRun> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const attemptTimeoutMs = deps.attemptTimeoutMs ?? ATTEMPT_TIMEOUT_MS;
  const backoff = deps.backoffMs ?? RETRY_BACKOFF_MS;
  const readSources = deps.readSources ?? readDatasets;
  const started = now();
  const deadline = started + (deps.budgetMs ?? REFRESH_BUDGET_MS);
  try {
    await setRunStep(run.id, "exchange-rate");
    const config = await loadConfig();
    const fx = await resolveRate(run.today, deps.fetchRates ?? ((start, end) => fetchUsdCadRates(start, end)));
    await setRunStep(run.id, "reading-sources");
    let datasets: Datasets | undefined;
    for (let attempt = 0; !datasets; attempt += 1) {
      try {
        datasets = await readSources(run.today, config, attemptTimeoutMs);
      } catch (err) {
        const wait = backoff[attempt];
        if (wait === undefined || !isTransient(err) || now() + wait + attemptTimeoutMs > deadline) throw err;
        console.warn("[reporting-goals] run=%s attempt %s failed (%s); retrying in %s ms", run.id, attempt + 1, describe(err).code, wait);
        await sleep(wait);
      }
    }
    await setRunStep(run.id, "saving");
    const done = await completeRun(run, datasets, fx, now() - started);
    console.log("[reporting-goals] refresh run=%s trigger=%s ok ms=%s rows=%j", run.id, run.trigger, now() - started, done.rowCounts);
    return done;
  } catch (err) {
    const failure = err instanceof RefreshFailure ? { code: err.code, message: err.message } : describe(err);
    console.error("[reporting-goals] refresh run=%s trigger=%s failed code=%s", run.id, run.trigger, failure.code);
    return failRun(run, failure, now() - started);
  }
}
