// Goals & Production page — pure display helpers: number and date wording, the
// refresh status lines, the progress-bar maths and the batch list's search,
// filters and sort. No React, no I/O (tests/reporting-goals-page.test.ts).

import type {
  BatchListRow,
  BatchStage,
  GoalSettings,
  GoalsModel,
  GoalsPage,
  IsoDate,
  RefreshRun,
  RevenueRateBasis,
} from "@/lib/reporting/goals";
import { formatAmount, formatDollars } from "@/lib/reporting/goals/money";

/** A page model with a good run behind it (every section can render). */
export type ReadyPage = GoalsPage & {
  state: "ready";
  run: RefreshRun;
  model: GoalsModel;
  settings: GoalSettings;
  fx: NonNullable<GoalsPage["fx"]>;
};

export function isReady(page: GoalsPage | null): page is ReadyPage {
  return !!page && page.state === "ready" && !!page.run && !!page.model && !!page.settings && !!page.fx;
}

export const REPORT_TZ = "America/Toronto";
/** Users may start one refresh per 5 minutes (the server enforces it; the page shows when). */
export const REFRESH_GAP_MS = 5 * 60_000;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const count = (n: number) => n.toLocaleString("en-US");
/** Whole dollars, as on the cards and in the takeaway ("$367,014"). */
export const dollars = formatDollars;
/** Exact dollars and cents ("$1,234.56"). */
export function cents(c: number): string {
  return `${c < 0 ? "-" : ""}$${formatAmount(Math.abs(c))}`;
}
/** Exact amount without a symbol, for columns whose heading names the currency ("31,394.40"). */
export const amount = formatAmount;
/** A Sage unit price as entered, at least to the cent ("48.00", "0.85", "1.6638"). */
export const price = (p: string) => Number(p).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 });
export const usd = (c: number) => `US${formatDollars(c)}`;
/** Whole kg ("91,702"); kg sums carry up to 3 decimal places. */
export const wholeKg = (kg: number) => count(Math.round(kg));
const COMPACT = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
/** Chart axis dollars ("$250K", "$1M"). */
export const compactDollars = (c: number) => `$${COMPACT.format(c / 100)}`;
/** Chart axis kg ("20K", "1.2M"). */
export const compactKg = (kg: number) => COMPACT.format(kg);
/** Needed-per-day figures show one decimal ("2.6"). */
export const oneDecimal = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
/** A stored rate without trailing zeros ("1.421900" → "1.4219"). */
export const rate = (r: string) => r.replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, "");
/** A stored decimal at `digits` places with thousands separators ("24500.00" → "24,500.00"); text that isn't a number as it is. */
export const decimal = (v: string | null, digits: number) =>
  v === null || v.trim() === "" || !Number.isFinite(Number(v))
    ? (v ?? "")
    : Number(v).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** File bytes as base64, for an upload inside JSON (the shared api() helper sends JSON only). */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...Array.from(bytes.subarray(i, i + 0x8000)));
  return btoa(binary);
}

/** "Oct 14" from an ISO date (no time zone involved). */
export function day(iso: IsoDate | null): string {
  if (!iso) return "—";
  const [, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

const TIME = new Intl.DateTimeFormat("en-US", { timeZone: REPORT_TZ, hour: "numeric", minute: "2-digit" });
const DATE_TIME = new Intl.DateTimeFormat("en-US", {
  timeZone: REPORT_TZ,
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** "9:42 AM" in Toronto. */
export const clock = (ts: string) => TIME.format(new Date(ts));
/** "Oct 14, 6:00 AM" in Toronto. */
export const when = (ts: string) => DATE_TIME.format(new Date(ts));

/** How a revenue rate reads in a sentence (TASK-3780): "the Bank of Canada rate 1.4021 (Oct 22)", "the Sage rate 1.25". */
export function revenueRateLabel(basis: RevenueRateBasis, page: Pick<ReadyPage, "fx" | "settings">): string {
  if (basis === "sage") return page.settings.sageUsdCadRate ? `the Sage rate ${rate(page.settings.sageUsdCadRate)}` : "the Sage rate";
  return `the ${page.fx.stale ? "last stored " : ""}Bank of Canada rate ${rate(page.fx.rate)} (${day(page.fx.date)})`;
}

/**
 * The Bank of Canada choice on the rate switch: "Today’s rate" when the page
 * shows today's refresh, "Bank of Canada" for an earlier one (this morning's
 * failed), "Last stored rate" when the run couldn't fetch one.
 */
export function bocRateName(page: Pick<ReadyPage, "fx" | "run">, today: IsoDate): string {
  if (page.fx.stale) return "Last stored rate";
  return page.run.today === today ? "Today’s rate" : "Bank of Canada";
}

/** "1 row", "3 rows". */
export const plural = (n: number, one: string, many: string) => `${count(n)} ${n === 1 ? one : many}`;

export const RUN_STEPS: Record<string, string> = {
  claimed: "Starting",
  "exchange-rate": "Getting the Bank of Canada rate",
  "reading-sources": "Reading FileMaker and Sage",
  saving: "Saving the snapshot",
};

export function stepText(step: string | null): string {
  return (step && RUN_STEPS[step]) || "Refreshing";
}

/** "Refreshed 9:42 AM · FileMaker through Oct 14 · Sage through Oct 14". */
export function refreshedText(run: RefreshRun): string {
  return `Refreshed ${clock(run.finishedAt ?? run.startedAt)} · FileMaker through ${day(run.productionCutoff)} · Sage through ${day(run.sageCutoff)}`;
}

/** Names the queries behind a figure and the run they came from (tooltips and source lines). */
export function sourceText(run: Pick<RefreshRun, "id" | "finishedAt" | "startedAt">, queries: readonly string[]): string {
  const names = queries.length === 1 ? `query ${queries[0]}` : `queries ${queries.join(", ")}`;
  return `From ${names} · run #${run.id}, ${when(run.finishedAt ?? run.startedAt)}`;
}

/** The most recently started of the runs the page knows about (any may be missing). */
export function newestRun<R extends Pick<RefreshRun, "startedAt">>(...runs: (R | null | undefined)[]): R | null {
  let newest: R | null = null;
  for (const run of runs) if (run && (!newest || Date.parse(run.startedAt) > Date.parse(newest.startedAt))) newest = run;
  return newest;
}

/** When the next user refresh is allowed (5 minutes after the newest run started), or null if now. */
export function nextRefreshAt(newest: Pick<RefreshRun, "startedAt"> | null, nowMs: number): number | null {
  if (!newest) return null;
  const at = Date.parse(newest.startedAt) + REFRESH_GAP_MS;
  return at > nowMs ? at : null;
}

// ─── Progress bars ────────────────────────────────────────────────────────

export interface BarParts {
  /** Shares of the track, 0–1, in order: system, by hand, remaining schedule. */
  system: number;
  byHand: number;
  schedule: number;
  /** Where the "due so far" (or last month) tick sits, 0–1; null for none. */
  tick: number | null;
}

/** Splits a goal's track; the segments never overflow it, whatever the numbers. */
export function barParts(input: { inSystem: number; byHand: number; schedule?: number; scale: number; tickAt?: number | null }): BarParts {
  const scale = input.scale > 0 ? input.scale : 1;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const system = clamp(input.inSystem / scale);
  const byHand = clamp(Math.min(1 - system, input.byHand / scale));
  const schedule = clamp(Math.min(1 - system - byHand, (input.schedule ?? 0) / scale));
  const tick = input.tickAt === null || input.tickAt === undefined ? null : clamp(input.tickAt / scale);
  return { system, byHand, schedule, tick };
}

export const pct = (share: number) => `${(share * 100).toFixed(2)}%`;

// ─── Batch list ───────────────────────────────────────────────────────────

export const STAGE_LABELS: Record<BatchStage, string> = {
  completed: "Completed",
  completed_by_hand: "Completed (by hand)",
  scheduled: "Scheduled",
  open_past_date: "Open past date",
};

export type BatchFilter = "all" | "completed" | "by_hand" | "scheduled" | "open_past_date";

export const BATCH_FILTERS: { key: BatchFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "completed", label: "Completed" },
  { key: "by_hand", label: "By hand" },
  { key: "scheduled", label: "Scheduled" },
  { key: "open_past_date", label: "Open past date" },
];

export function inFilter(row: BatchListRow, filter: BatchFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "completed":
      return row.stage === "completed" || row.stage === "completed_by_hand";
    case "by_hand":
      return row.source === "By hand";
    case "scheduled":
      return row.stage === "scheduled";
    case "open_past_date":
      return row.stage === "open_past_date";
  }
}

export type BatchSortKey = "batch" | "product" | "stage" | "date" | "kg" | "band" | "line" | "status";
export interface BatchSort {
  key: BatchSortKey;
  dir: 1 | -1;
}
export const DEFAULT_BATCH_SORT: BatchSort = { key: "date", dir: 1 };

const STAGE_ORDER: Record<BatchStage, number> = { completed: 0, completed_by_hand: 1, open_past_date: 2, scheduled: 3 };

function sortValue(row: BatchListRow, key: BatchSortKey): number | string {
  switch (key) {
    case "kg":
      return row.kg;
    case "stage":
      return STAGE_ORDER[row.stage];
    case "band":
      return row.kg;
    case "date":
      return row.date;
    case "product":
      return row.product ?? "";
    case "line":
      return row.line ?? "";
    case "status":
      return row.status;
    case "batch":
      return row.batch;
  }
}

export function filterBatches(
  rows: readonly BatchListRow[],
  opts: { filter: BatchFilter; line1Only: boolean; query: string }
): BatchListRow[] {
  const needle = opts.query.trim().toLowerCase();
  return rows.filter(
    (row) =>
      inFilter(row, opts.filter) &&
      (!opts.line1Only || row.line1) &&
      (!needle || `${row.batch} ${row.product ?? ""} ${row.line ?? ""} ${row.status}`.toLowerCase().includes(needle))
  );
}

/** Sorted copy; ties fall back to date, then batch, so the order is stable. */
export function sortBatches(rows: readonly BatchListRow[], sort: BatchSort): BatchListRow[] {
  const cmp = (a: number | string, b: number | string) =>
    typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), undefined, { numeric: true });
  return [...rows].sort(
    (a, b) =>
      cmp(sortValue(a, sort.key), sortValue(b, sort.key)) * sort.dir ||
      cmp(a.date, b.date) ||
      cmp(a.batch, b.batch)
  );
}

export function nextSort(current: BatchSort, key: BatchSortKey): BatchSort {
  if (current.key === key) return { key, dir: current.dir === 1 ? -1 : 1 };
  return { key, dir: key === "kg" ? -1 : 1 };
}
