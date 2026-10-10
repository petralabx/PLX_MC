"use client";

// Dashboard live section (TASK-2592): the In flight panel (which agent holds
// which task right now, and what last happened on it) and the Live activity
// strip. Both come from GET /api/in-flight, polled every 20 s while the tab is
// visible and paused while it is hidden. When a poll reports a task written
// since the last look, the store's snapshot reloads (at most every two minutes)
// so the tiles and bars above move too. New rows and events animate in; the
// motion lives in mc-dashboard.css behind prefers-reduced-motion.

import { useEffect, useMemo, useRef, useState } from "react";

import { api } from "@/lib/api";
import type { InFlightReport, InFlightTask, LiveEvent } from "@/lib/compliance";
import { STAGES, STAGE_IDX } from "@/lib/mc-data";
import { useMcVersion } from "@/lib/mc-data/hooks";
import { allTasks, bucketById, projectById, refreshState } from "@/lib/mc-data/store";

import { stageChipTone } from "./project-overview.helpers";
import type { Nav } from "./route";

export const POLL_MS = 20_000;
/** The snapshot behind the tiles reloads at most this often. */
export const SNAPSHOT_GAP_MS = 120_000;
const TASKS_SHOWN = 8;
const EVENTS_SHOWN = 10;

const fmt = (n: number) => n.toLocaleString("en-US");
const plural = (n: number, one: string, many: string) => `${fmt(n)} ${n === 1 ? one : many}`;

/** "4 min", "3 hr", "2 days" (never under a minute). */
export function duration(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${Math.max(minutes, 1)} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"}`;
}

/** "just now", "25 s ago", "4 min ago", "3 hr ago". */
export function ago(at: string | number, nowMs: number): string {
  const ms = nowMs - (typeof at === "number" ? at : Date.parse(at));
  if (ms < 10_000) return "just now";
  if (ms < 60_000) return `${Math.floor(ms / 1000)} s ago`;
  return `${duration(ms)} ago`;
}

/** "in 45 min", "in 5 hr"; "now" once the time has passed. */
export function until(at: string, nowMs: number): string {
  const ms = Date.parse(at) - nowMs;
  return ms <= 0 ? "now" : `in ${duration(ms)}`;
}

/** The checkouts on one task by agent: "Cursor ×2 · Claude Code". */
export function agentsText(task: Pick<InFlightTask, "checkouts">): string {
  const counts = new Map<string, number>();
  for (const c of task.checkouts) counts.set(c.agent, (counts.get(c.agent) ?? 0) + 1);
  return [...counts].map(([agent, n]) => (n > 1 ? `${agent} ×${n}` : agent)).join(" · ");
}

/** "21 open checkouts on 17 tasks: 14 Claude Code, 7 Cursor." */
export function flightSummary(tasks: readonly Pick<InFlightTask, "checkouts">[]): string {
  const counts = new Map<string, number>();
  for (const task of tasks) for (const c of task.checkouts) counts.set(c.agent, (counts.get(c.agent) ?? 0) + 1);
  const checkouts = [...counts.values()].reduce((sum, n) => sum + n, 0);
  const agents = [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([agent, n]) => `${fmt(n)} ${agent}`)
    .join(", ");
  return `${plural(checkouts, "open checkout", "open checkouts")} on ${plural(tasks.length, "task", "tasks")}: ${agents}.`;
}

// A row is "new" when its task got activity since the last poll; an event, when
// it wasn't in the last poll. Keys carry both so one set covers the two lists.
const taskKey = (t: InFlightTask) => `t:${t.taskId}:${t.lastActivity.seq || t.lastActivity.ts}`;
const eventKey = (e: LiveEvent) => `e:${e.seq}`;
const keysOf = (r: InFlightReport) => [...r.tasks.map(taskKey), ...r.events.map(eventKey)];
const NOTHING_FRESH: ReadonlySet<string> = new Set();

/** What `next` brings that `prev` didn't; nothing on the first report, so a page load doesn't flash. */
export function freshKeys(prev: InFlightReport | null, next: InFlightReport): ReadonlySet<string> {
  if (!prev) return NOTHING_FRESH;
  const before = new Set(keysOf(prev));
  return new Set(keysOf(next).filter((key) => !before.has(key)));
}

export interface PollerDeps {
  load: () => Promise<InFlightReport>;
  onReport: (report: InFlightReport, at: number) => void;
  onError: (message: string) => void;
  /** Reload the snapshot behind the tiles and bars. */
  refresh: () => void;
  visible: () => boolean;
}

/**
 * The poll loop, kept free of React and the DOM so it can be tested with fake
 * timers: one load at a time, the next one POLL_MS after the last finished,
 * nothing scheduled while the tab is hidden.
 */
export function createInFlightPoller(deps: PollerDeps) {
  let stopped = false;
  let busy = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let seenWrite: string | null = null;
  let reloadedAt = -Infinity;

  // The first marker is the baseline for the snapshot already on screen; a
  // newer one reloads it, at most every SNAPSHOT_GAP_MS (a change inside the
  // gap waits for a later poll).
  const follow = (writtenAt: string | null) => {
    if (writtenAt === null) return;
    if (seenWrite === null) {
      seenWrite = writtenAt;
      return;
    }
    if (writtenAt <= seenWrite || Date.now() - reloadedAt < SNAPSHOT_GAP_MS) return;
    seenWrite = writtenAt;
    reloadedAt = Date.now();
    deps.refresh();
  };

  const tick = async () => {
    if (stopped || busy) return;
    busy = true;
    clearTimeout(timer);
    try {
      const report = await deps.load();
      if (stopped) return;
      deps.onReport(report, Date.now());
      follow(report.tasksUpdatedAt);
    } catch (err) {
      if (!stopped) deps.onError(err instanceof Error ? err.message : String(err));
    } finally {
      busy = false;
      if (!stopped && deps.visible()) timer = setTimeout(() => void tick(), POLL_MS);
    }
  };

  return {
    /** Poll now (start, Retry); ignored while a poll is running. */
    poll: () => void tick(),
    /** The tab was shown (poll at once) or hidden (stop scheduling). */
    visibilityChanged: () => {
      if (deps.visible()) void tick();
      else clearTimeout(timer);
    },
    stop: () => {
      stopped = true;
      clearTimeout(timer);
    },
  };
}

export interface LiveView {
  report: InFlightReport | null;
  /** When the last successful poll landed (ms). */
  at: number | null;
  /** The last poll's failure; the next success clears it. */
  error: string | null;
  /** Keys that weren't in the previous report. */
  fresh: ReadonlySet<string>;
  retry: () => void;
}

function useInFlight(): LiveView {
  const [state, setState] = useState<Omit<LiveView, "retry">>({
    report: null,
    at: null,
    error: null,
    fresh: NOTHING_FRESH,
  });
  const poller = useRef<ReturnType<typeof createInFlightPoller> | null>(null);

  useEffect(() => {
    const p = createInFlightPoller({
      load: () => api<InFlightReport>("/in-flight"),
      onReport: (report, at) => setState((prev) => ({ report, at, error: null, fresh: freshKeys(prev.report, report) })),
      onError: (error) => setState((prev) => ({ ...prev, error, fresh: NOTHING_FRESH })),
      refresh: () => void refreshState(),
      visible: () => document.visibilityState === "visible",
    });
    poller.current = p;
    const onVisibility = () => p.visibilityChanged();
    document.addEventListener("visibilitychange", onVisibility);
    p.poll();
    return () => {
      p.stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return { ...state, retry: () => poller.current?.poll() };
}

// A clock for the relative times, so "updated 20 s ago" keeps counting between polls.
function useNow(stepMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), stepMs);
    return () => clearInterval(id);
  }, [stepMs]);
  return now;
}

const FEED_TONE: Record<string, string> = {
  checkout: "acc",
  "pr.opened": "acc",
  "task.progress": "info",
  "pr.synchronized": "info",
  "task.completed": "ok",
  "task.promoted": "ok",
  "pr.merged": "ok",
  "gate.passed": "ok",
  "gate.blocked": "warn",
  "pr.closed": "warn",
};

function LiveBadge({ at, error, now }: { at: number | null; error: string | null; now: number }) {
  if (at === null) return <span className="dash-livebadge">{error ? "Not connected" : "Connecting…"}</span>;
  return (
    <span className={`dash-livebadge ${error ? "off" : "on"}`}>
      <span className="dot" aria-hidden="true" />
      {error ? "Paused" : "Live"} · updated {ago(at, now)}
    </span>
  );
}

function FlightRow({
  task,
  where,
  fresh,
  now,
  nav,
}: {
  task: InFlightTask;
  where: string;
  fresh: boolean;
  now: number;
  nav: Nav;
}) {
  const stage = task.stage ? STAGES[STAGE_IDX[task.stage]] : null;
  return (
    <li className={`dash-flight-row${fresh ? " dash-new" : ""}`}>
      <div className="dash-flight-top">
        <span className="dash-agents">{agentsText(task)}</span>
        {stage && task.stage && <span className={`pv-chip ${stageChipTone({ stage: task.stage })}`}>{stage.name}</span>}
      </div>
      <button type="button" className="dash-link dash-flight-title" onClick={() => nav("task", { taskId: task.taskId })}>
        <span className="id">{task.taskId}</span> {task.title ?? "Not in Mission Control"}
      </button>
      {where && <div className="dash-flight-where">{where}</div>}
      <div className="dash-flight-last">
        {task.lastActivity.text} · <time dateTime={task.lastActivity.ts}>{ago(task.lastActivity.ts, now)}</time>
      </div>
      {(task.multiple || task.quiet || task.expiringSoon) && (
        <div className="dash-flags">
          {task.multiple && <span className="dash-flag warn">{task.checkouts.length} open checkouts</span>}
          {task.quiet && (
            <span className="dash-flag">No activity for {duration(now - Date.parse(task.lastActivity.ts))}</span>
          )}
          {task.expiringSoon && <span className="dash-flag warn">Checkout ends {until(task.expiresAt, now)}</span>}
        </div>
      )}
    </li>
  );
}

export function DashboardLive({ projectId, nav }: { projectId: string | null; nav: Nav }) {
  const live = useInFlight();
  const now = useNow(5_000);
  return <LivePanels live={live} now={now} projectId={projectId} nav={nav} />;
}

/** The two cards for one poll state; split from the hook so it renders in tests. */
export function LivePanels({
  live,
  now,
  projectId,
  nav,
}: {
  live: LiveView;
  now: number;
  projectId: string | null;
  nav: Nav;
}) {
  const version = useMcVersion();
  // The report carries ids; names come from the store (re-read after any change).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const taskIndex = useMemo(() => new Map(allTasks().map((t) => [t.id, t])), [version]);
  const [showAllTasks, setShowAllTasks] = useState(false);
  const [showAllEvents, setShowAllEvents] = useState(false);

  const projectOf = (bucketId: string | null | undefined) => (bucketId ? (bucketById(bucketId)?.project ?? null) : null);
  const bucketOfTask = (taskId: string | null) => (taskId ? taskIndex.get(taskId)?.bucket : undefined);
  const focusName = projectId ? (projectById(projectId)?.name ?? projectId) : null;

  const tasks = (live.report?.tasks ?? []).filter(
    (t) => !projectId || projectOf(t.bucketId ?? bucketOfTask(t.taskId)) === projectId
  );
  const events = (live.report?.events ?? []).filter((e) => !projectId || projectOf(bucketOfTask(e.taskId)) === projectId);
  const loading = live.at === null && live.error === null;
  const failed = live.at === null && live.error !== null;

  const where = (t: InFlightTask) => {
    const bucket = t.bucketId ? bucketById(t.bucketId) : undefined;
    const project = bucket?.project ? projectById(bucket.project) : undefined;
    const repo = t.checkouts[0]?.repo.split("/").pop();
    return [project?.name, bucket?.name, repo].filter(Boolean).join(" · ");
  };

  let summary: string;
  if (loading) summary = "Loading which agents are working on what…";
  else if (failed) summary = "Live activity isn’t available right now.";
  else if (tasks.length === 0)
    summary = focusName ? `No agent has a task in ${focusName} checked out right now.` : "No agent has a task checked out right now.";
  else summary = focusName ? `In ${focusName}: ${flightSummary(tasks)}` : flightSummary(tasks);

  const problem = live.error && (
    <p className="dash-live-error">
      {live.at === null ? "Couldn’t load live activity" : "Live updates paused"}: {live.error}{" "}
      <button type="button" className="tl-link" onClick={live.retry}>
        Retry
      </button>
    </p>
  );

  return (
    <div className="dash-live">
      <section className="chartcard" aria-labelledby="dash-flight-title">
        <div className="dash-live-h">
          <h2 className="chartcard-title" id="dash-flight-title">
            In flight
          </h2>
          <LiveBadge at={live.at} error={live.error} now={now} />
        </div>
        <p className="dash-note">{summary}</p>
        {problem}
        {tasks.length > 0 && (
          <ul className="dash-flight" aria-label="Tasks agents have checked out">
            {tasks.slice(0, showAllTasks ? undefined : TASKS_SHOWN).map((t) => (
              <FlightRow key={t.taskId} task={t} where={where(t)} fresh={live.fresh.has(taskKey(t))} now={now} nav={nav} />
            ))}
          </ul>
        )}
        {tasks.length > TASKS_SHOWN && (
          <button type="button" className="tl-link dash-more" onClick={() => setShowAllTasks((v) => !v)}>
            {showAllTasks ? "Show fewer" : `Show all ${fmt(tasks.length)} tasks`}
          </button>
        )}
      </section>

      <section className="chartcard" aria-labelledby="dash-feed-title">
        <h2 className="chartcard-title" id="dash-feed-title">
          Live activity
        </h2>
        <p className="dash-note">Checkouts, progress and pull request events from the last 24 hours, newest first.</p>
        {events.length === 0 ? (
          !loading && !failed && <p className="dash-empty">Nothing has happened in this view in the last 24 hours.</p>
        ) : (
          <ol className="dash-feed">
            {events.slice(0, showAllEvents ? undefined : EVENTS_SHOWN).map((e) => {
              const title = e.taskId ? taskIndex.get(e.taskId)?.title : undefined;
              return (
                <li
                  key={e.seq}
                  className={`dash-feed-item t-${FEED_TONE[e.kind] ?? "muted"}${live.fresh.has(eventKey(e)) ? " dash-new" : ""}`}
                >
                  <span className="dot" aria-hidden="true" />
                  <span className="dash-feed-body">
                    <span className="dash-feed-line">
                      <b>{e.by}</b> · {e.text}
                    </span>
                    {e.taskId && (
                      <button
                        type="button"
                        className="dash-link dash-feed-task"
                        onClick={() => nav("task", { taskId: e.taskId ?? undefined })}
                      >
                        {e.taskId}
                        {title ? ` · ${title}` : ""}
                      </button>
                    )}
                  </span>
                  <time dateTime={e.ts}>{ago(e.ts, now)}</time>
                </li>
              );
            })}
          </ol>
        )}
        {events.length > EVENTS_SHOWN && (
          <button type="button" className="tl-link dash-more" onClick={() => setShowAllEvents((v) => !v)}>
            {showAllEvents ? "Show fewer" : `Show all ${fmt(events.length)} events`}
          </button>
        )}
      </section>
    </div>
  );
}
