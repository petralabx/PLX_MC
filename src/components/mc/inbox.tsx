// Home — "What needs me today" (Wave 6 — colleague UX). A prioritized list for
// the signed-in viewer with one action per row: approvals waiting on them,
// routing proposals they own (flagged), their overdue tasks, and — for
// owners/admins — tasks with no accountable owner and SharePoint sync issues.
// The derivation is pure (needs-me.ts); this screen loads and renders it. The
// notifications inbox and "Assigned to me" stay below, so nothing is lost.
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { api, ApiClientError } from "@/lib/api";
import { tasksForUser, type Human } from "@/lib/mc-data";
import { useMcVersion, useViewer } from "@/lib/mc-data/hooks";
import {
  allTasks,
  hydrate,
  inboxNotifications,
  markRead,
  storeSyncCounts,
  unreadCount,
  viewerId,
  viewerSettled,
} from "@/lib/mc-data/store";

import {
  approvalsLoadError,
  fetchPendingApprovals,
  onApprovalsChanged,
  type PendingApprovalRow,
} from "./approvals-inbox";
import { Confidence } from "./atoms";
import {
  approvalRows,
  approvalsWaitingOn,
  isOwnerOrAdmin,
  overdueFor,
  overdueRows,
  routingRows,
  sectionView,
  syncIssuesFor,
  syncRows,
  todayGridDay,
  unownedRows,
  unownedTasks,
  viewerLoadState,
  type NeedsRow,
  type SectionLoad,
} from "./needs-me";
import type { Nav, Route, ScreenProps } from "./route";
import type { InboxListResponse, InboxProposalSummary } from "./routing-inbox";
import { routingInboxEnabled } from "./routing-inbox/flag";

// Time-of-day greeting for the signed-in viewer. `hour` is null until the
// client clock is read (SSR has no viewer timezone), and an unresolved viewer
// is greeted without a name rather than as someone else.
export function greeting(hour: number | null, viewer: Human | null): string {
  const part =
    hour === null ? "Hello" : hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const firstName = viewer?.name.split(" ")[0];
  return firstName ? `${part}, ${firstName}` : part;
}

const noSubscribe = () => () => {};

// Rows shown per section before "See all".
const SECTION_LIMIT = 5;

// One section: exactly one of loading / error-with-retry / empty / its rows.
export function NeedsSection({
  id,
  title,
  empty,
  load,
  onRetry,
  nav,
  more,
}: {
  id: string;
  title: string;
  empty: string;
  load: SectionLoad<NeedsRow>;
  onRetry: () => void;
  nav: Nav;
  /** Where "See all" goes when there are more rows than fit. */
  more?: Route;
}) {
  const view = sectionView(load);
  const rows = load.status === "ready" ? load.rows : [];
  const go = (to: Route) => {
    const { screen, ...extra } = to;
    nav(screen, extra);
  };
  return (
    <section className="needs-sec" aria-labelledby={`needs-${id}`} data-needs={id}>
      <div className="grouphd">
        <h2 className="nm" id={`needs-${id}`}>
          {title}
        </h2>
        {view === "list" ? <span className="ct">{rows.length}</span> : null}
      </div>
      {view === "loading" ? (
        <div className="needs-state" role="status">
          Loading…
        </div>
      ) : null}
      {view === "error" && load.status === "error" ? (
        <div className="needs-state err" role="alert">
          <span>{load.message}</span>
          <button type="button" className="btn ghost sm" onClick={onRetry}>
            Retry
          </button>
        </div>
      ) : null}
      {view === "empty" ? <div className="needs-state">{empty}</div> : null}
      {rows.slice(0, SECTION_LIMIT).map((row) => (
        <button type="button" className="nrow" key={row.key} onClick={() => go(row.to)}>
          <span className="dot" aria-hidden="true" />
          <span className="nrow-main">
            <span className="tag">{row.tag}</span>
            {row.id ? <span className="id">{row.id}</span> : null}
            <span className="body">{row.title}</span>
          </span>
          <span className="nrow-meta">
            {row.meta ? <span className="age">{row.meta}</span> : null}
            <span className="nrow-act">{row.action} →</span>
          </span>
        </button>
      ))}
      {more && rows.length > SECTION_LIMIT ? (
        <button type="button" className="needs-more splink" onClick={() => go(more)}>
          See all {rows.length} →
        </button>
      ) : null}
    </section>
  );
}

const VIEWER_ERROR = "We couldn't confirm who's signed in, so we can't tell what needs you.";

function routingLoadError(err: unknown): string {
  return err instanceof ApiClientError ? err.message : "Failed to load routing decisions.";
}

export function InboxView({ nav, openNewTask }: ScreenProps & { openNewTask?: () => void }) {
  useMcVersion();
  const viewer = useViewer();
  // Server snapshot null → SSR and the hydrating render agree; the client
  // re-renders with its local hour / today straight after.
  const hour = useSyncExternalStore(noSubscribe, () => new Date().getHours(), () => null);
  const today = useSyncExternalStore(noSubscribe, () => todayGridDay(new Date()), () => null);
  const who = viewerLoadState(viewer, viewerSettled());
  const tasks = allTasks();
  const mine = tasksForUser(viewerId(), tasks).slice(0, 5);
  const unread = unreadCount();
  const notifications = inboxNotifications();

  const routingOn = routingInboxEnabled();
  const [approvals, setApprovals] = useState<SectionLoad<PendingApprovalRow>>({ status: "loading" });
  const [routing, setRouting] = useState<SectionLoad<InboxProposalSummary>>({ status: "loading" });

  const loadApprovals = useCallback((): Promise<void> => {
    return fetchPendingApprovals().then(
      (rows) => setApprovals({ status: "ready", rows }),
      (err: unknown) => setApprovals({ status: "error", message: approvalsLoadError(err) })
    );
  }, []);

  // Personal scope = proposals this viewer is accountable for (server-side).
  const loadRouting = useCallback((): Promise<void> => {
    return api<InboxListResponse>("/routing/inbox?scope=personal").then(
      (data) =>
        setRouting(
          data.offline
            ? { status: "error", message: "Routing decisions are unavailable right now." }
            : { status: "ready", rows: data.proposals }
        ),
      (err: unknown) => setRouting({ status: "error", message: routingLoadError(err) })
    );
  }, []);

  useEffect(() => {
    void loadApprovals();
  }, [loadApprovals]);

  // A decision made elsewhere (the Approvals screen, the pinned live column).
  useEffect(() => onApprovalsChanged(loadApprovals), [loadApprovals]);

  useEffect(() => {
    if (routingOn) void loadRouting();
  }, [routingOn, loadRouting]);

  const retryApprovals = () => {
    setApprovals({ status: "loading" });
    void loadApprovals();
  };
  const retryRouting = () => {
    setRouting({ status: "loading" });
    void loadRouting();
  };
  const retryViewer = () => {
    void hydrate();
  };

  // Every section waits on the viewer (and, for dates, the client clock): an
  // unknown viewer is loading or an error with Retry — never an empty "all clear".
  function scoped<T>(
    load: SectionLoad<T>,
    derive: (rows: T[], viewer: Human, today: number) => NeedsRow[]
  ): SectionLoad<NeedsRow> {
    if (who === "error") return { status: "error", message: VIEWER_ERROR };
    if (who === "loading" || !viewer || today === null) return { status: "loading" };
    if (load.status !== "ready") return load;
    return { status: "ready", rows: derive(load.rows, viewer, today) };
  }
  const fromStore: SectionLoad<never> = { status: "ready", rows: [] };
  // Team-wide sections are for owners/admins only — hidden, not empty, for others.
  const admin = viewer ? isOwnerOrAdmin(viewer) : false;
  const syncIssues = viewer ? syncIssuesFor(viewer, storeSyncCounts()) : null;

  return (
    <div className="mc-main" data-testid="inbox-screen">
      <div className="ph">
        <div>
          <span className="kk">{greeting(hour, viewer)}</span>
          <h1>
            What needs <em>me</em> today
          </h1>
          <a className="vision-link" href="/presentations/plx-platform-vision.html">
            Platform vision · team briefing ↗
          </a>
          <p className="sub">
            One action per row — decide what&apos;s waiting on you, then clear overdue work. Agents
            work in the background; everything resolves to a task. Notifications are below.
          </p>
        </div>
        <div className="r">
          <button type="button" className="btn ghost" onClick={() => nav("feed")}>
            Agent activity ◉
          </button>
          <button type="button" className="btn" onClick={openNewTask}>
            New <span className="kbd-hint">⌘K</span>
          </button>
        </div>
      </div>

      <div className="inbox">
        <NeedsSection
          id="approvals"
          title="Approvals waiting on you"
          empty="No approvals are waiting on you."
          load={scoped(approvals, (rows, v) => approvalRows(approvalsWaitingOn(v, rows, tasks)))}
          onRetry={who === "error" ? retryViewer : retryApprovals}
          nav={nav}
          more={{ screen: "approvals" }}
        />
        {routingOn ? (
          <NeedsSection
            id="routing"
            title="Routing decisions"
            empty="No routing proposals need your decision."
            load={scoped(routing, (rows) => routingRows(rows))}
            onRetry={who === "error" ? retryViewer : retryRouting}
            nav={nav}
            more={{ screen: "routing-inbox" }}
          />
        ) : null}
        <NeedsSection
          id="overdue"
          title="Your overdue tasks"
          empty="Nothing overdue."
          load={scoped(fromStore, (_rows, v, day) => overdueRows(overdueFor(v, tasks, day)))}
          onRetry={retryViewer}
          nav={nav}
          more={{ screen: "mine" }}
        />
        {admin ? (
          <NeedsSection
            id="unowned"
            title="Tasks without an accountable owner"
            empty="Every open task has an accountable owner."
            load={scoped(fromStore, (_rows, v) => unownedRows(unownedTasks(v, tasks) ?? []))}
            onRetry={retryViewer}
            nav={nav}
            more={{ screen: "list" }}
          />
        ) : null}
        {syncIssues !== null ? (
          <NeedsSection
            id="sync"
            title="SharePoint sync issues"
            empty="No sync conflicts or errors to resolve."
            load={scoped(fromStore, () => syncRows(syncIssues))}
            onRetry={retryViewer}
            nav={nav}
          />
        ) : null}

        <section className="needs-sec" aria-labelledby="needs-notifications">
          <div className="grouphd">
            <h2 className="nm" id="needs-notifications">
              Notifications
            </h2>
            <span className="ct">{unread} unread</span>
          </div>
          {notifications.length === 0 ? <div className="needs-state">No notifications.</div> : null}
          {notifications.map((n) => (
            <button
              type="button"
              className={`nrow${n.unread ? " unread" : ""}`}
              key={n.id}
              onClick={() => {
                markRead(n.id);
                nav("task", { taskId: n.task });
              }}
            >
              <span className="dot" aria-hidden="true" />
              <span className="nrow-main">
                <span className={`tag ${n.kind}`}>{n.kind}</span>
                <span className="body">{n.text}</span>
              </span>
              <span className="age">{n.age}</span>
            </button>
          ))}
        </section>

        <section className="needs-sec" aria-labelledby="needs-assigned">
          <div className="grouphd">
            <h2 className="nm" id="needs-assigned">
              Assigned to me
            </h2>
            <span className="ct">{mine.length} reporting</span>
          </div>
          {mine.map((t) => (
            <button
              type="button"
              className="nrow"
              key={t.id}
              onClick={() => nav("task", { taskId: t.id })}
            >
              <span className="dot" aria-hidden="true" />
              <span className="nrow-main">
                <span className="id">{t.id}</span>
                <span className="body">{t.title}</span>
              </span>
              <span className="nrow-meta">
                <Confidence task={t} showLabel={false} />
                <span className="age">{t.due}</span>
              </span>
            </button>
          ))}
        </section>
      </div>
    </div>
  );
}
