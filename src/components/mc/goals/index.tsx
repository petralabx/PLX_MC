"use client";

// Goals & Production (Reporting → Goals & production, TASK-2896): this month's
// three goals — Line 1 bulk, full truckloads and revenue — from the latest
// good refresh of FileMaker and Sage plus the entries made by hand, with the
// day-by-day charts, tables and the rules behind every number. One read of
// GET /api/reporting/goals (one consistent snapshot); Editors can refresh,
// which this page follows step by step until the new snapshot is in, and add,
// edit, delete and import the entries made by hand (./entries.tsx, TASK-2897).
// Viewers and Editors can export it all to Excel (GET /api/reporting/goals/export).
// US dollar revenue shows at today's Bank of Canada rate or at the fixed Sage
// rate (TASK-3780): the choice lives in the URL (`fx=sage`), and the page model
// and the export are asked for at it (`?fx=sage`), so every figure agrees.
// Sections other than the goal cards open from a tab bar (TASK-4094). The
// cards stay pinned under the top bar. The open section is `tab=` (absent =
// Revenue → By class), kept alongside `fx`, `scope` and `sales`.
// The salesperson filter (TASK-4277) works the same way (`sales=GGC,SM`).
// Module contract: docs/modules/reporting-goals/README.md.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { api, apiDownload, ApiClientError } from "@/lib/api";
import { signInAgainAction } from "@/lib/auth/actions";
import type { EvaluatedEntry, GoalsPage, RefreshRun, RevenueRateBasis, RevenueScope } from "@/lib/reporting/goals";
import { torontoDate } from "@/lib/reporting/goals/calendar";
import { workbookFileName } from "@/lib/reporting/goals/excel/layout";
import { salesParam } from "@/lib/reporting/goals/salesperson-filter";

import type { Route, ScreenProps } from "../route";

import { DailyLine1Chart, DailyRevenueChart, DailyTable, SizeHistoryChart } from "./charts";
import { CustomerRevenueSection } from "./customers";
import { DeleteEntryDialog, EntryDialog, ImportDialog } from "./entries";
import { ForecastSection } from "./forecast";
import { GoalCards } from "./goal-cards";
import {
  bocRateName,
  clock,
  day,
  dollars,
  isReady,
  newestRun,
  nextRefreshAt,
  rate,
  revenueRateLabel,
  refreshedText,
  sourceText,
  stepText,
  when,
  type ReadyPage,
} from "./helpers";
import { watchRun } from "./run-watch";
import { SalespeopleNote, SalespeoplePicker } from "./salespeople";
import { Section, type SectionState } from "./section";
import { SectionNav } from "./section-nav";
import { activeGoalsTab, DEFAULT_GOALS_TAB, type GoalsTab } from "./tabs";
import { ShipmentList } from "./shipments";
import {
  BatchList,
  CompletedTiles,
  EntriesTable,
  RevenueByClassTable,
  RulesText,
  ScheduledTiles,
  TruckloadTable,
  type EntryActions,
} from "./tables";

type Refresh =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "running"; run: RefreshRun }
  | { kind: "done"; run: RefreshRun }
  | { kind: "failed"; message: string }
  | { kind: "refused"; message: string }
  | { kind: "lost"; message: string };

/** The entries dialog an Editor has open. */
type EntryDialogState =
  | { kind: "add" }
  | { kind: "edit"; entry: EvaluatedEntry }
  | { kind: "delete"; entry: EvaluatedEntry }
  | { kind: "import" }
  | null;

/** After a delete the row and its button are gone: keep focus in the entries section. */
function focusEntries(): void {
  (
    document.querySelector<HTMLElement>("[data-testid='goals-entries'] [role='region']") ??
    document.querySelector<HTMLElement>("[data-testid='goals-add-entry']")
  )?.focus();
}

function useNow(stepMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), stepMs);
    return () => clearInterval(id);
  }, [stepMs]);
  return now;
}

function refreshLine(refresh: Refresh, page: ReadyPage | null): string {
  switch (refresh.kind) {
    case "idle":
      return "";
    case "starting":
      return "Starting a refresh…";
    case "running":
      return `${stepText(refresh.run.step)}…`;
    case "done":
      return refreshedText(refresh.run);
    case "failed":
      return `The refresh failed: ${refresh.message}${page ? ` Still showing the data from ${when(page.run.finishedAt ?? page.run.startedAt)}.` : ""}`;
    case "refused":
      return refresh.message;
    case "lost":
      return `Lost track of the refresh (${refresh.message}). Reload the page to see its result.`;
  }
}

type Download =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "done"; fileName: string }
  | { kind: "failed"; message: string };

function downloadLine(download: Download): string {
  switch (download.kind) {
    case "idle":
      return "";
    case "working":
      return "Preparing the Excel workbook…";
    case "done":
      return `Downloaded ${download.fileName}.`;
    case "failed":
      return `The export failed: ${download.message}`;
  }
}

/** A refresh's progress and result take the status line back from a finished export. */
const clearFinished = (download: Download): Download => (download.kind === "working" ? download : { kind: "idle" });

/** Hands a downloaded file to the browser under its name. */
function saveFile(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoked once the browser has taken the file (as the architecture canvas does for its SVG).
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * A Goals path (the page model or the workbook) at a revenue rate and for some
 * salespeople: today's rate and every customer need no query, so the default
 * request stays exactly as it was.
 */
function goalsPath(base: string, basis: RevenueRateBasis, sales: readonly string[]): string {
  const params = new URLSearchParams();
  if (basis === "sage") params.set("fx", "sage");
  if (sales.length > 0) params.set("sales", sales.join(","));
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

/** Goals URL parts. The default section is left out, so `/?screen=goals` stays the same link. */
function goalsLocation(
  basis: RevenueRateBasis,
  scope: RevenueScope,
  tab: GoalsTab,
  sales: readonly string[],
): Omit<Route, "screen"> {
  const salesValue = (salesParam(sales.join(",")) ?? []).join(",");
  return {
    ...(basis === "sage" ? { fx: "sage" as const } : {}),
    ...(scope === "mfg" ? { scope: "mfg" as const } : {}),
    ...(tab !== DEFAULT_GOALS_TAB ? { tab } : {}),
    ...(salesValue ? { sales: salesValue } : {}),
  };
}

export function GoalsView({ route, nav }: ScreenProps) {
  const basis: RevenueRateBasis = route.fx === "sage" ? "sage" : "boc";
  // Manufacturing customers only (`scope=mfg`): a display choice on the loaded page, so it needs no new read.
  const scope: RevenueScope = route.scope === "mfg" ? "mfg" : "all";
  const tab = activeGoalsTab(route.tab);
  // Some salespeople's customers only (`sales=`, TASK-4277): a malformed link shows every customer.
  const salesKey = (salesParam(route.sales ?? null) ?? []).join(",");
  const sales = salesKey ? salesKey.split(",") : [];
  // load() reads the chosen rate and salespeople from here, so it keeps one identity and a change never stops a refresh being followed.
  const basisRef = useRef(basis);
  const salesRef = useRef(salesKey);
  useEffect(() => {
    basisRef.current = basis;
    salesRef.current = salesKey;
  });
  // Every read is numbered; only the newest one is shown, so a slower answer at the other rate never overwrites it.
  const loadSeq = useRef(0);
  const [page, setPage] = useState<GoalsPage | null>(null);
  const [status, setStatus] = useState<SectionState>("loading");
  // The rate and salespeople the failed read asked for, so a failure for one choice is never shown as another's.
  const [loadError, setLoadError] = useState<{ code: string; message: string; basis: RevenueRateBasis; sales: string } | null>(null);
  const [refresh, setRefresh] = useState<Refresh>({ kind: "idle" });
  const [download, setDownload] = useState<Download>({ kind: "idle" });
  // The run this page started or attached to: it counts toward the 5-minute
  // limit even before the reloaded page model carries it (or if that reload fails).
  const [followed, setFollowed] = useState<RefreshRun | null>(null);
  const [entryDialog, setEntryDialog] = useState<EntryDialogState>(null);
  // The last entry write's result ("Added M008."), announced with the refresh status.
  const [entryNotice, setEntryNotice] = useState("");
  const watcher = useRef<{ stop: () => void } | null>(null);
  const now = useNow(15_000);

  // setState only runs in promise continuations and handlers, never in an
  // effect's synchronous body (react-hooks/set-state-in-effect).
  const load = useCallback((): Promise<GoalsPage | null> => {
    const seq = ++loadSeq.current;
    const wanted = basisRef.current;
    const wantedSales = salesRef.current;
    return api<GoalsPage>(goalsPath("/reporting/goals", wanted, wantedSales ? wantedSales.split(",") : []))
      .then((data) => {
        if (seq !== loadSeq.current) return data;
        setPage(data);
        setStatus("ready");
        setLoadError(null);
        return data;
      })
      .catch((err: Error) => {
        if (seq !== loadSeq.current) return null;
        setStatus((prev) => (prev === "ready" ? prev : "failed"));
        setLoadError({ code: err instanceof ApiClientError ? err.code : "error", message: err.message, basis: wanted, sales: wantedSales });
        return null;
      });
  }, []);

  const follow = useCallback(
    (run: RefreshRun) => {
      watcher.current?.stop();
      setRefresh({ kind: "running", run });
      setFollowed(run);
      watcher.current = watchRun(run.id, {
        load: (id) => api<RefreshRun>(`/reporting/goals/runs/${id}`),
        onStep: (next) => setRefresh({ kind: "running", run: next }),
        onDone: (done) => {
          setFollowed(done);
          setDownload(clearFinished);
          setRefresh(done.status === "succeeded" ? { kind: "done", run: done } : { kind: "failed", message: done.error ?? "no reason recorded." });
          void load();
        },
        onLost: (message) => {
          setDownload(clearFinished);
          setRefresh({ kind: "lost", message });
        },
      });
    },
    [load]
  );

  useEffect(() => {
    void load().then((data) => {
      if (data?.latestAttempt?.status === "running") follow(data.latestAttempt);
    });
    return () => watcher.current?.stop();
  }, [load, follow]);

  // A new rate or salespeople (the switches, or Back and Forward) read the page model again; the first render's read is above.
  const loadedChoice = useRef(`${basis}|${salesKey}`);
  useEffect(() => {
    if (loadedChoice.current === `${basis}|${salesKey}`) return;
    loadedChoice.current = `${basis}|${salesKey}`;
    void load();
  }, [basis, salesKey, load]);

  const retry = () => {
    setStatus((prev) => (prev === "failed" ? "loading" : prev));
    void load();
  };

  /** An entry was added, saved, deleted or imported: say so and reload the page model. */
  const entryWritten = (message: string, then?: () => void) => {
    setEntryDialog(null);
    setDownload(clearFinished);
    setEntryNotice(message);
    void load().then(() => then?.());
  };

  async function startRefresh() {
    setEntryNotice("");
    setDownload(clearFinished);
    setRefresh({ kind: "starting" });
    try {
      const { run } = await api<{ run: RefreshRun }>("/reporting/goals/refresh", { method: "POST", body: "{}" });
      follow(run);
    } catch (err) {
      if (err instanceof ApiClientError && err.code === "refresh_running") {
        const data = await load();
        if (data?.latestAttempt?.status === "running") {
          follow(data.latestAttempt);
          return;
        }
      }
      setRefresh({ kind: "refused", message: err instanceof Error ? err.message : String(err) });
    }
  }

  /** The workbook at the rate, and for the salespeople, the figures on screen are at (not ones still loading). */
  async function exportWorkbook(today: string, shown: RevenueRateBasis, shownSales: readonly string[]) {
    setEntryNotice("");
    setDownload({ kind: "working" });
    try {
      const { blob, fileName } = await apiDownload(goalsPath("/reporting/goals/export", shown, shownSales));
      const name = fileName ?? workbookFileName(today, shown, shownSales);
      saveFile(blob, name);
      setDownload({ kind: "done", fileName: name });
    } catch (err) {
      setDownload({ kind: "failed", message: err instanceof Error ? err.message : String(err) });
    }
  }

  const ready = isReady(page) ? page : null;
  const busy = refresh.kind === "starting" || refresh.kind === "running";
  const newest = newestRun(page?.latestAttempt, page?.run, followed);
  const waitUntil = busy ? null : nextRefreshAt(newest, now);
  const editor = page?.viewer.editor ?? false;
  const canRefresh = editor && page?.state !== "not_configured";
  const line = downloadLine(download) || refreshLine(refresh, ready);
  const entryActions: EntryActions | undefined = editor
    ? { onEdit: (entry) => setEntryDialog({ kind: "edit", entry }), onDelete: (entry) => setEntryDialog({ kind: "delete", entry }) }
    : undefined;
  // Without a Goals role (or a session) there is nothing to retry: say what is missing.
  const noAccess = !page && loadError && (loadError.code === "forbidden" || loadError.code === "not_authenticated") ? loadError : null;
  // The rate the figures on screen are at, and the one asked for; they differ while the other rate loads (or if it failed).
  const shownBasis = ready?.model.revenue.basis ?? basis;
  const rateWaiting = ready && shownBasis !== basis ? revenueRateLabel(basis, ready) : null;
  const rateFailed = loadError?.basis === basis && (rateWaiting !== null || (!ready && basis === "sage"));
  // The salespeople the figures on screen are for (none: every customer), and whether the ones picked are still loading.
  const salespeople = ready?.salespeople ?? null;
  const shownSales = salespeople?.applied ? salespeople.selected : [];
  const salesWaiting = !!ready && (salespeople?.selected ?? []).join(",") !== salesKey;
  const salesFailed = salesWaiting && loadError?.sales === salesKey;
  const chooseBasis = (next: RevenueRateBasis) => {
    if (next === basis) return;
    // A new read starts: an earlier failure (at either rate) no longer describes what's on screen.
    setLoadError(null);
    nav("goals", goalsLocation(next, scope, tab, sales));
  };
  const chooseScope = (next: RevenueScope) => {
    if (next === scope) return;
    nav("goals", goalsLocation(basis, next, tab, sales));
  };
  const chooseSales = (next: readonly string[]) => {
    setLoadError(null);
    nav("goals", goalsLocation(basis, scope, tab, next));
  };
  const chooseTab = (next: GoalsTab) => {
    if (next === tab) return;
    nav("goals", goalsLocation(basis, scope, next, sales));
  };
  // After a tab change, bring the section out from under the pinned cards.
  // The first render is the page the link opened, so it stays where it is.
  const tabLanded = useRef(false);
  useEffect(() => {
    if (!tabLanded.current) {
      tabLanded.current = true;
      return;
    }
    const panel = document.getElementById("goals-panel");
    const sticky = document.querySelector(".gp-sticky");
    if (!panel || !sticky) return;
    const delta = panel.getBoundingClientRect().top - (sticky.getBoundingClientRect().bottom + 8);
    if (delta < -4 || panel.getBoundingClientRect().top > window.innerHeight * 0.55) window.scrollBy(0, delta);
  }, [tab]);
  const retryRate = () => {
    setLoadError(null);
    void load();
  };

  return (
    <div className="mc-main" data-testid="goals-screen">
      <div className="ph ph-compact">
        <div>
          <span className="kk">Reporting</span>
          <h1>
            {ready ? `${ready.model.month.label} ` : ""}
            <em>goals &amp; production</em>
          </h1>
          {/* One line in every state, so a failed load moves nothing below it. */}
          <p className="sub" data-testid="goals-as-of">
            {ready
              ? `Data as of ${when(ready.run.finishedAt ?? ready.run.startedAt)} · FileMaker through ${day(ready.model.cutoffs.productionCutoff)} · Sage through ${day(ready.model.cutoffs.sageCutoff)}`
              : status === "loading"
                ? "Loading the latest refresh…"
                : loadError && !page
                  ? `Couldn’t load the report: ${loadError.message}`
                  : " "}
          </p>
        </div>
        {canRefresh || ready ? (
          <div className="r">
            {canRefresh ? (
              <button
                type="button"
                className="btn"
                onClick={() => void startRefresh()}
                disabled={busy || waitUntil !== null}
                aria-describedby="goals-refresh-status"
              >
                {busy ? "Refreshing…" : "Refresh"}
              </button>
            ) : null}
            {ready ? (
              <button
                type="button"
                className={canRefresh ? "btn ghost" : "btn"}
                onClick={() => void exportWorkbook(ready.model.today, shownBasis, shownSales)}
                disabled={download.kind === "working"}
                aria-describedby="goals-refresh-status"
              >
                {download.kind === "working" ? "Exporting…" : "Export to Excel"}
              </button>
            ) : null}
            {ready && editor ? (
              <>
                <button type="button" className="btn ghost" data-testid="goals-import" onClick={() => setEntryDialog({ kind: "import" })}>
                  Import manual entries
                </button>
                <button type="button" className="btn ghost" data-testid="goals-add-entry" onClick={() => setEntryDialog({ kind: "add" })}>
                  Add entry
                </button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="insights goals">
        <p className="gp-legend">
          <span className="sw" aria-hidden="true" />
          Amber marks figures your team entered by hand that aren’t in FileMaker or Sage yet.
        </p>
        {ready ? (
          <div className="gp-tools gp-rate" data-testid="goals-rate">
            <span id="goals-rate-label">US dollars at</span>
            <div className="gp-seg" role="group" aria-labelledby="goals-rate-label">
              <button
                type="button"
                aria-pressed={basis === "boc"}
                title={ready.fx.stale ? `Last stored Bank of Canada rate, ${day(ready.fx.date)}` : `Bank of Canada, ${day(ready.fx.date)}`}
                onClick={() => chooseBasis("boc")}
              >
                {bocRateName(ready, torontoDate(new Date(now)))} <span className="ct">{rate(ready.fx.rate)}</span>
              </button>
              <button
                type="button"
                aria-pressed={basis === "sage"}
                title="The fixed rate Sage books US dollar sales at"
                // Without a usable Sage rate there is nothing to switch to (the read would only answer config_error).
                disabled={!ready.settings.sageUsdCadRate && basis !== "sage"}
                onClick={() => chooseBasis("sage")}
              >
                Sage rate <span className="ct">{ready.settings.sageUsdCadRate ? rate(ready.settings.sageUsdCadRate) : "not set"}</span>
              </button>
            </div>
            <span className="gp-rate-status" role="status" data-testid="goals-rate-status">
              {rateWaiting
                ? rateFailed
                  ? `Couldn’t load revenue at ${rateWaiting}. The figures below are still at ${revenueRateLabel(shownBasis, ready)}.`
                  : `Loading revenue at ${rateWaiting}…`
                : ""}
            </span>
            {rateFailed ? (
              <button type="button" className="btn ghost" data-testid="goals-rate-retry" onClick={retryRate}>
                Try again
              </button>
            ) : null}
          </div>
        ) : rateFailed ? (
          // A link at the Sage rate that can't load has no page to show the switch on: offer the way back.
          <div className="gp-tools gp-rate" data-testid="goals-rate">
            <span role="status">Couldn’t load revenue at the Sage rate.</span>
            <button type="button" className="btn ghost" onClick={() => chooseBasis("boc")}>
              Show the Bank of Canada rate
            </button>
          </div>
        ) : null}
        {ready ? (
          <div className="gp-tools gp-rate" data-testid="goals-scope">
            <span id="goals-scope-label">Customers</span>
            <div className="gp-seg" role="group" aria-labelledby="goals-scope-label">
              <button type="button" aria-pressed={scope === "all"} onClick={() => chooseScope("all")}>
                All
              </button>
              <button
                type="button"
                aria-pressed={scope === "mfg"}
                title="Every customer class but Exclusive Distribution"
                onClick={() => chooseScope("mfg")}
              >
                Manufacturing customers
              </button>
            </div>
          </div>
        ) : null}
        {ready && salespeople ? (
          <SalespeoplePicker view={salespeople} picked={sales} waiting={salesWaiting} failed={salesFailed} onPick={chooseSales} onRetry={retryRate} />
        ) : null}
        {ready && salespeople ? <SalespeopleNote view={salespeople} /> : null}
        {ready ? <p className="gp-takeaway">{ready.model.takeaway}</p> : null}
        <p id="goals-refresh-status" className="gp-status" role="status">
          {line ||
            (editor && waitUntil !== null && ready ? `Refreshed recently. Refresh is available again at ${clock(new Date(waitUntil).toISOString())}.` : "")}
          {entryNotice ? (
            <span className="gp-entry-notice" data-testid="goals-entries-status">
              {entryNotice}
            </span>
          ) : null}
        </p>
        {loadError && page ? (
          <p className="gp-notice" data-testid="goals-load-error">
            Couldn’t reload the page data: {loadError.message} Showing what was loaded before.
          </p>
        ) : null}

        {noAccess ? (
          <div className="empty gp-empty-state" data-testid="goals-no-access">
            <h3>No access</h3>
            <p>{noAccess.message}</p>
            <p>Roles are read when you sign in. If you were given access recently, sign in again.</p>
            <form action={signInAgainAction.bind(null, "goals")}>
              <button type="submit" className="btn" data-testid="goals-sign-in-again">
                Sign in again
              </button>
            </form>
          </div>
        ) : page && !ready ? (
          <NotReady page={page} editor={editor} />
        ) : (
          <Body page={ready} status={status} onRetry={retry} entryActions={entryActions} scope={scope} tab={tab} onTab={chooseTab} />
        )}

        {ready && editor && entryDialog ? (
          entryDialog.kind === "import" ? (
            <ImportDialog onClose={() => setEntryDialog(null)} onImported={(message) => entryWritten(message)} />
          ) : entryDialog.kind === "delete" ? (
            <DeleteEntryDialog
              entry={entryDialog.entry}
              onClose={() => setEntryDialog(null)}
              onDeleted={(message) => entryWritten(message, focusEntries)}
            />
          ) : (
            <EntryDialog
              entry={entryDialog.kind === "edit" ? entryDialog.entry : null}
              line1MinKg={ready.settings.line1MinKg}
              onClose={() => setEntryDialog(null)}
              onSaved={(message) => entryWritten(message)}
            />
          )
        ) : null}
      </div>
    </div>
  );
}

function NotReady({ page, editor }: { page: GoalsPage; editor: boolean }) {
  const attempt = page.latestAttempt;
  return (
    <div className="empty gp-empty-state" data-testid="goals-not-ready">
      {page.state === "not_configured" ? (
        <>
          <h3>Not connected yet</h3>
          <p>
            Goals &amp; production reads FileMaker and Sage from the reporting database, and that connection isn’t set
            up yet. Ask a Mission Control administrator to finish the setup in the module guide.
          </p>
        </>
      ) : (
        <>
          <h3>No data yet</h3>
          <p>
            The report fills in after its first refresh, which runs every weekday at 6:00 AM Toronto time
            {editor ? ", or now with Refresh." : "."}
          </p>
          {attempt?.status === "failed" ? (
            <p className="gp-notice">
              The last refresh, at {when(attempt.startedAt)}, failed: {attempt.error ?? "no reason recorded"}.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

function Body({
  page,
  status,
  onRetry,
  entryActions,
  scope = "all",
  tab,
  onTab,
}: {
  page: ReadyPage | null;
  status: SectionState;
  onRetry: () => void;
  entryActions?: EntryActions;
  scope?: RevenueScope;
  tab: GoalsTab;
  onTab: (tab: GoalsTab) => void;
}) {
  const state: SectionState = page ? "ready" : status === "ready" ? "failed" : status;
  const src = (key: string) => (page ? sourceText(page.run, page.sections[key] ?? []) : null);
  const ready = (render: (p: ReadyPage) => ReactNode) => (page ? render(page) : null);
  const behind = page && (page.model.behind.production || page.model.behind.sage);
  const failedAttempt = page?.latestAttempt?.status === "failed" ? page.latestAttempt : null;

  return (
    <>
      {behind && page ? (
        <div className="gp-banner" role="note" data-testid="goals-behind">
          <b>Data is behind.</b>{" "}
          {[
            page.model.behind.production ? `FileMaker runs through ${day(page.model.cutoffs.productionCutoff)}` : null,
            page.model.behind.sage ? `Sage runs through ${day(page.model.cutoffs.sageCutoff)}` : null,
          ]
            .filter(Boolean)
            .join(" and ")}
          . Anything after that is missing until the system catches up, unless your team entered it by hand.
        </div>
      ) : null}
      {failedAttempt && page ? (
        <p className="gp-notice" data-testid="goals-failed-run">
          The last refresh, at {when(failedAttempt.startedAt)}, failed: {failedAttempt.error ?? "no reason recorded"}. This
          page still shows run #{page.run.id} from {when(page.run.finishedAt ?? page.run.startedAt)}.
        </p>
      ) : null}

      <div className="gp-sticky">
        <div className="gp-sticky-kpis" tabIndex={0} role="region" aria-label="Goal summary">
          <Section id="goals" title="This month’s goals" state={state} onRetry={onRetry} resetKey={page} size="lg" bare>
            {ready((p) => (
              <GoalCards page={p} scope={scope} />
            ))}
          </Section>
        </div>
        <SectionNav active={tab} onSelect={onTab} />
      </div>
      <div role="tabpanel" id="goals-panel" aria-labelledby={`goals-tab-${tab}`} data-testid="goals-panel">
        <ReportPanel tab={tab} page={page} state={state} onRetry={onRetry} entryActions={entryActions} src={src} ready={ready} />
      </div>
    </>
  );
}

function ReportPanel({
  tab,
  page,
  state,
  onRetry,
  entryActions,
  src,
  ready,
}: {
  tab: GoalsTab;
  page: ReadyPage | null;
  state: SectionState;
  onRetry: () => void;
  entryActions?: EntryActions;
  src: (key: string) => string | null;
  ready: (render: (p: ReadyPage) => ReactNode) => ReactNode;
}) {
  switch (tab) {
    case "classes":
      return (
        <Section
          id="classes"
          title="Revenue by customer class"
          note="The Revenue card’s month split by each customer’s class, from Vince’s 5 Oct list."
          source={src("classes")}
          state={state}
          onRetry={onRetry}
          resetKey={page}
        >
          {ready((p) => (
            <RevenueByClassTable page={p} />
          ))}
        </Section>
      );
    case "daily":
      return (
        <Section
          id="daily"
          title="Day by day"
          note="Weekends and holidays are shaded. Point at or tap a day for its numbers, or open the table under the charts."
          source={src("daily")}
          state={state}
          onRetry={onRetry}
          resetKey={page}
          size="lg"
        >
          {ready((p) => (
            <>
              <div className="gp-charts">
                <figure className="gp-chart">
                  <figcaption>Line 1 bulk kg per day</figcaption>
                  <DailyLine1Chart page={p} />
                </figure>
                <figure className="gp-chart">
                  <figcaption>Revenue against the {dollars(p.settings.revenueTargetCadCents)} target (CAD)</figcaption>
                  <DailyRevenueChart page={p} />
                </figure>
              </div>
              <DailyTable page={p} />
            </>
          ))}
        </Section>
      );
    case "truckloads":
      return (
        <Section id="truckloads" title="Truckloads by customer" source={src("truckloads")} state={state} onRetry={onRetry} resetKey={page}>
          {ready((p) => (
            <TruckloadTable page={p} />
          ))}
        </Section>
      );
    case "entries":
      return (
        <Section
          id="entries"
          title="Entries by hand"
          note="Everything your team entered by hand, with its status. Entries that no longer count are dimmed."
          source={src("entries")}
          state={state}
          onRetry={onRetry}
          resetKey={page}
        >
          {ready((p) => (
            <EntriesTable page={p} actions={entryActions} />
          ))}
        </Section>
      );
    case "sizes":
      return (
        <Section
          id="sizes"
          title="Batches completed by size"
          note="Completed this month (FileMaker), with the pace per 20 working days. The chart compares the last three full months with this month’s pace."
          source={src("sizes")}
          state={state}
          onRetry={onRetry}
          resetKey={page}
          size="lg"
        >
          {ready((p) => (
            <>
              <CompletedTiles tiles={p.model.sizes.completed} />
              <SizeHistoryChart page={p} />
            </>
          ))}
        </Section>
      );
    case "scheduled":
      return (
        <Section id="scheduled" title="Scheduled from today by size" source={src("batches")} state={state} onRetry={onRetry} resetKey={page} size="sm">
          {ready((p) => (
            <ScheduledTiles tiles={p.model.sizes.scheduledFromToday} openPastDate={p.model.sizes.openPastDate} />
          ))}
        </Section>
      );
    case "batches":
      return (
        <Section
          id="batches"
          title="Batch list"
          note="Every batch this month. Select a column heading to sort."
          source={src("batches")}
          state={state}
          onRetry={onRetry}
          resetKey={page}
          size="lg"
        >
          {ready((p) => (
            <BatchList page={p} />
          ))}
        </Section>
      );
    case "shipments":
      return (
        <Section
          id="shipments"
          title="Shipments this month"
          note="Every Sage invoice shipped this month, and the shipments entered by hand that count. The totals follow the search and filters."
          source={src("shipments")}
          state={state}
          onRetry={onRetry}
          resetKey={page}
          size="lg"
        >
          {ready((p) => (
            <ShipmentList page={p} />
          ))}
        </Section>
      );
    case "customers":
      return (
        <Section
          id="customers"
          title="Revenue by customer"
          note={"Potential revenue from production for open orders, and this month's invoiced revenue, by customer and week (weeks start Monday). Amounts in CAD at the page's rate." /* pragma: allowlist secret */}
          source={src("customers")}
          state={state}
          onRetry={onRetry}
          resetKey={page}
          size="lg"
        >
          {ready((p) => (
            <CustomerRevenueSection page={p} />
          ))}
        </Section>
      );
    case "forecast":
      return (
        <Section
          id="forecast"
          title="Revenue forecast"
          note={`This month’s open Sage orders, matched to FileMaker’s plan through their assembly orders. Amounts in CAD at ${
            page?.model.revenue.basis === "sage" ? `the Sage rate ${rate(page.model.revenue.rate)}` : "the run’s Bank of Canada rate"
          }.`}
          source={src("forecast")}
          state={state}
          onRetry={onRetry}
          resetKey={page}
          size="lg"
        >
          {ready((p) => (
            <ForecastSection page={p} />
          ))}
        </Section>
      );
    case "rules":
      return (
        <Section id="rules" title="How these numbers are worked out" state={state} onRetry={onRetry} resetKey={page} size="sm" bare>
          {ready((p) => (
            <div className="gp-rules">
              <RulesText page={p} />
            </div>
          ))}
        </Section>
      );
    default: {
      const exhaustive: never = tab;
      return exhaustive;
    }
  }
}
