"use client";

// Goals & Production (Reporting → Goals & production, TASK-2896): this month's
// three goals — large batches, full truckloads and revenue — from the latest
// good refresh of FileMaker and Sage plus the entries made by hand, with the
// day-by-day charts, tables and the rules behind every number. One read of
// GET /api/reporting/goals (one consistent snapshot); Editors can refresh,
// which this page follows step by step until the new snapshot is in, and add,
// edit, delete and import the entries made by hand (./entries.tsx, TASK-2897).
// Module contract: docs/modules/reporting-goals/README.md.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { api, ApiClientError } from "@/lib/api";
import type { EvaluatedEntry, GoalsPage, RefreshRun } from "@/lib/reporting/goals";

import { DailyBatchesChart, DailyRevenueChart, DailyTable, SizeHistoryChart } from "./charts";
import { DeleteEntryDialog, EntryDialog, ImportDialog } from "./entries";
import { GoalCards } from "./goal-cards";
import {
  clock,
  day,
  dollars,
  isReady,
  newestRun,
  nextRefreshAt,
  refreshedText,
  sourceText,
  stepText,
  when,
  type ReadyPage,
} from "./helpers";
import { watchRun } from "./run-watch";
import { Section, type SectionState } from "./section";
import {
  BatchList,
  CompletedTiles,
  EntriesTable,
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

export function GoalsView() {
  const [page, setPage] = useState<GoalsPage | null>(null);
  const [status, setStatus] = useState<SectionState>("loading");
  const [loadError, setLoadError] = useState<{ code: string; message: string } | null>(null);
  const [refresh, setRefresh] = useState<Refresh>({ kind: "idle" });
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
  const load = useCallback(
    (): Promise<GoalsPage | null> =>
      api<GoalsPage>("/reporting/goals")
        .then((data) => {
          setPage(data);
          setStatus("ready");
          setLoadError(null);
          return data;
        })
        .catch((err: Error) => {
          setStatus((prev) => (prev === "ready" ? prev : "failed"));
          setLoadError({ code: err instanceof ApiClientError ? err.code : "error", message: err.message });
          return null;
        }),
    []
  );

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
          setRefresh(done.status === "succeeded" ? { kind: "done", run: done } : { kind: "failed", message: done.error ?? "no reason recorded." });
          void load();
        },
        onLost: (message) => setRefresh({ kind: "lost", message }),
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

  const retry = () => {
    setStatus((prev) => (prev === "failed" ? "loading" : prev));
    void load();
  };

  /** An entry was added, saved, deleted or imported: say so and reload the page model. */
  const entryWritten = (message: string, then?: () => void) => {
    setEntryDialog(null);
    setEntryNotice(message);
    void load().then(() => then?.());
  };

  async function startRefresh() {
    setEntryNotice("");
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

  const ready = isReady(page) ? page : null;
  const busy = refresh.kind === "starting" || refresh.kind === "running";
  const newest = newestRun(page?.latestAttempt, page?.run, followed);
  const waitUntil = busy ? null : nextRefreshAt(newest, now);
  const editor = page?.viewer.editor ?? false;
  const line = refreshLine(refresh, ready);
  const entryActions: EntryActions | undefined = editor
    ? { onEdit: (entry) => setEntryDialog({ kind: "edit", entry }), onDelete: (entry) => setEntryDialog({ kind: "delete", entry }) }
    : undefined;
  // Without a Goals role (or a session) there is nothing to retry: say what is missing.
  const noAccess = !page && loadError && (loadError.code === "forbidden" || loadError.code === "not_authenticated") ? loadError : null;

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
        {editor && page?.state !== "not_configured" ? (
          <div className="r">
            <button
              type="button"
              className="btn"
              onClick={() => void startRefresh()}
              disabled={busy || waitUntil !== null}
              aria-describedby="goals-refresh-status"
            >
              {busy ? "Refreshing…" : "Refresh"}
            </button>
            {ready ? (
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
          </div>
        ) : page && !ready ? (
          <NotReady page={page} editor={editor} />
        ) : (
          <Body page={ready} status={status} onRetry={retry} entryActions={entryActions} />
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
              largeBatchMinKg={ready.settings.largeBatchMinKg}
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
}: {
  page: ReadyPage | null;
  status: SectionState;
  onRetry: () => void;
  entryActions?: EntryActions;
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

      <Section id="goals" title="This month’s goals" state={state} onRetry={onRetry} resetKey={page} size="lg" bare>
        {ready((p) => (
          <GoalCards page={p} />
        ))}
      </Section>

      <Section
        id="daily"
        title="Day by day"
        note="Weekends and holidays are shaded. Point at or tap a day for its numbers, or open the table under the charts."
        source={src("daily")}
        state={state}
        onRetry={onRetry} resetKey={page}
        size="lg"
      >
        {ready((p) => (
          <>
            <div className="gp-charts">
              <figure className="gp-chart">
                <figcaption>Large batches per day</figcaption>
                <DailyBatchesChart page={p} />
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

      <Section id="truckloads" title="Truckloads by customer" source={src("truckloads")} state={state} onRetry={onRetry} resetKey={page}>
        {ready((p) => (
          <TruckloadTable page={p} />
        ))}
      </Section>

      <Section
        id="entries"
        title="Entries by hand"
        note="Everything your team entered by hand, with its status. Entries that no longer count are dimmed."
        source={src("entries")}
        state={state}
        onRetry={onRetry} resetKey={page}
      >
        {ready((p) => (
          <EntriesTable page={p} actions={entryActions} />
        ))}
      </Section>

      <Section
        id="sizes"
        title="Batches completed by size"
        note="Completed this month (FileMaker), with the pace per 20 working days. The chart compares the last three full months with this month’s pace."
        source={src("sizes")}
        state={state}
        onRetry={onRetry} resetKey={page}
        size="lg"
      >
        {ready((p) => (
          <>
            <CompletedTiles tiles={p.model.sizes.completed} />
            <SizeHistoryChart page={p} />
          </>
        ))}
      </Section>

      <Section id="scheduled" title="Scheduled from today by size" source={src("batches")} state={state} onRetry={onRetry} resetKey={page} size="sm">
        {ready((p) => (
          <ScheduledTiles tiles={p.model.sizes.scheduledFromToday} openPastDate={p.model.sizes.openPastDate} />
        ))}
      </Section>

      <Section
        id="batches"
        title="Batch list"
        note="Every batch this month. Select a column heading to sort."
        source={src("batches")}
        state={state}
        onRetry={onRetry} resetKey={page}
        size="lg"
      >
        {ready((p) => (
          <BatchList page={p} />
        ))}
      </Section>

      <Section id="rules" title="How these numbers are worked out" state={state} onRetry={onRetry} resetKey={page} size="sm" bare>
        {ready((p) => (
          <div className="gp-rules">
            <RulesText page={p} />
          </div>
        ))}
      </Section>
    </>
  );
}
