"use client";

// UatTickets — the BKT-UAT tickets view (TASK-3706): one row per UAT ticket
// task with portal step, attempt, stage, lease, PR, staging, holder, age and a
// link to the portal ticket; filters All · Needs a human · In flight · Waiting
// on submitter · Verified; no row cap. Above it, the portal vs Mission
// Control check lists each disagreement with its one-click fix. Task fields
// come from the store; filed time, lease, portal fields and drift come from
// GET /api/uat-tickets (on open, on Check now and after each fix).

import { useEffect, useState } from "react";
import { ArrowUpRight, RefreshCw } from "lucide-react";

import { api } from "@/lib/api";
import { ACTORS, STAGES, STAGE_IDX } from "@/lib/mc-data";
import type { Task } from "@/lib/mc-data";
import { cancelTaskWithReason, pushNotice, refreshState, setTaskStage } from "@/lib/mc-data/store";
import { UAT_HOLD_LABEL, isStewardBlocked, isUatTicketTask, needsVince, uatBlockCauses } from "@/lib/tasks/uat-labels";
import {
  leaseState,
  portalTicketUrl,
  ticketShortCode,
  ticketTaskDraft,
  uatAttempt,
  uatFeedbackId,
  type PortalTicket,
  type UatDriftFinding,
  type UatDriftFix,
  type UatLease,
  type UatTaskFacts,
  type UatTicketsReport,
} from "@/lib/tasks/uat-tickets";

import { ago, duration, until } from "./dashboard-live";
import { needsHuman, stageChipTone } from "./project-overview.helpers";
import type { Nav } from "./route";

export type UatGroup = "human" | "flight" | "submitter" | "verified" | "cancelled";
export type UatFilterKey = "all" | "human" | "flight" | "submitter" | "verified";

const FILTERS: Array<{ key: UatFilterKey; label: string }> = [
  { key: "all", label: "All" },
  { key: "human", label: "Needs a human" },
  { key: "flight", label: "In flight" },
  { key: "submitter", label: "Waiting on submitter" },
  { key: "verified", label: "Verified" },
];
const GROUP_ORDER: UatGroup[] = ["human", "flight", "submitter", "verified", "cancelled"];
const COLUMNS = ["Task", "Portal ticket", "Portal step", "Try", "MC stage", "Lease", "PR", "Staging", "Holder", "Age"];

/**
 * Who has the ball. Needs a human is the bucket table's rule; a held ticket
 * (uat:hold) and a fix awaiting re-test wait on the submitter, unless the
 * portal says the fix is not ready for re-test yet.
 */
export function uatGroup(task: Task, ticket?: PortalTicket): UatGroup {
  if (task.stage === "cancelled") return "cancelled";
  if (task.stage === "verified") return "verified";
  if (needsHuman(task)) return "human";
  if (task.labels.includes(UAT_HOLD_LABEL)) return "submitter";
  if (task.stage === "merged") return ticket && ticket.status !== "READY_FOR_RETEST" ? "flight" : "submitter";
  return "flight";
}

export function uatHolder(task: Task, group: UatGroup, lease: UatLease | null, nowMs: number): string {
  if (group === "verified" || group === "cancelled") return "Closed";
  if (group === "submitter") return "Submitter";
  if (group === "human") {
    if (needsVince(task)) return "Vince";
    return task.accountableOwner ? (ACTORS[task.accountableOwner]?.name ?? task.accountableOwner) : "No owner";
  }
  if (lease && leaseState(lease, nowMs) === "live") return lease.agent;
  if (task.prs.some((pr) => pr.status === "open")) return "Reviewer";
  return task.stage === "merged" ? "Pipeline" : "Steward queue";
}

export function leaseText(lease: UatLease | null, nowMs: number): string {
  const state = leaseState(lease, nowMs);
  if (!lease || state === "none") return "None";
  if (state === "live") return `${lease.agent} · ends ${until(lease.expiresAt, nowMs)}`;
  if (state === "expired") return `${lease.agent} · expired ${ago(lease.expiresAt, nowMs)}`;
  return lease.releasedReason ? `Released · ${lease.releasedReason}` : "Released";
}

/** The note under the stage chip: why the task waits, from its UAT labels. */
function stageNote(task: Task): string | null {
  if (isStewardBlocked(task)) {
    const causes = uatBlockCauses(task.labels);
    return causes.length > 0 ? `uat:blocked · ${causes.join(", ")}` : "uat:blocked";
  }
  if (needsVince(task)) return "needs-vince";
  return task.labels.includes(UAT_HOLD_LABEL) ? "uat:hold · question open" : null;
}

export function fixLabel(fix: UatDriftFix): string {
  if (fix.kind === "create") return "Create task";
  if (fix.kind === "reopen") return "Reopen to backlog";
  if (fix.kind === "requeue") return "Requeue to backlog";
  return fix.reason === "superseded" ? "Cancel as replaced" : "Cancel task";
}

/** Run one fix through the store's normal task writes; a refused write leaves a notice. */
export async function runUatFix(fix: UatDriftFix): Promise<void> {
  if (fix.kind === "cancel") {
    await cancelTaskWithReason(fix.taskId, { reason: fix.reason, replacedBy: fix.replacedBy ?? null, note: fix.note });
  } else if (fix.kind === "create") {
    try {
      await api<Task>("/tasks", { method: "POST", body: JSON.stringify(ticketTaskDraft(fix)) });
      await refreshState();
    } catch (err) {
      pushNotice(`Couldn't create the task for ticket ${ticketShortCode(fix.feedbackId)}. ${err instanceof Error ? err.message : ""}`);
    }
  } else {
    // Reopen and requeue: leaving cancelled is a reopen on the server.
    await setTaskStage(fix.taskId, "backlog");
  }
}

export interface UatRow {
  task: Task;
  group: UatGroup;
  feedbackId: string;
  ticket: PortalTicket | undefined;
}

/** Every UAT ticket task in display order: by group, then newest task first. */
export function uatRows(tasks: readonly Task[], report: UatTicketsReport | null): UatRow[] {
  const tickets = report?.portal.status === "ok" ? new Map(report.portal.tickets.map((t) => [t.id, t])) : null;
  const num = (id: string) => Number(/(\d+)$/.exec(id)?.[1] ?? 0);
  return tasks
    .filter(isUatTicketTask)
    .map((task) => {
      const feedbackId = uatFeedbackId(task.labels)!;
      const ticket = tickets?.get(feedbackId);
      return { task, group: uatGroup(task, ticket), feedbackId, ticket };
    })
    .sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) || num(b.task.id) - num(a.task.id));
}

export function uatFilterCounts(rows: readonly UatRow[]): Record<UatFilterKey, number> {
  const count = (group: UatGroup) => rows.filter((row) => row.group === group).length;
  return { all: rows.length, human: count("human"), flight: count("flight"), submitter: count("submitter"), verified: count("verified") };
}

export function UatTickets({ tasks, nav }: { tasks: Task[]; nav: Nav }) {
  // `at` is when the load landed; ages count from it.
  const [view, setView] = useState<{ report: UatTicketsReport | null; error: string | null; at: number }>({
    report: null,
    error: null,
    at: 0,
  });
  const [busy, setBusy] = useState(true);
  // Bumped to load again (Check now, after a fix); the fetch runs in the effect.
  const [loads, setLoads] = useState(0);
  useEffect(() => {
    let cancelled = false;
    api<UatTicketsReport>("/uat-tickets")
      .then((report) => {
        if (!cancelled) setView({ report, error: null, at: Date.now() });
      })
      .catch((err: unknown) => {
        const error = err instanceof Error ? err.message : String(err);
        if (!cancelled) setView((prev) => ({ ...prev, error, at: Date.now() }));
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loads]);
  const reload = () => {
    setBusy(true);
    setLoads((n) => n + 1);
  };
  const fix = async (finding: UatDriftFinding) => {
    if (!finding.fix || busy) return;
    setBusy(true);
    await runUatFix(finding.fix);
    setLoads((n) => n + 1);
  };
  return (
    <UatTicketsPanel
      tasks={tasks}
      report={view.report}
      error={view.error}
      now={view.at}
      nav={nav}
      busy={busy}
      onCheck={reload}
      onFix={(finding) => void fix(finding)}
    />
  );
}

/** The view for one report; split from the loader so it renders in tests. */
export function UatTicketsPanel({
  tasks,
  report,
  error,
  now,
  nav,
  busy = false,
  onCheck = () => {},
  onFix = () => {},
}: {
  tasks: Task[];
  report: UatTicketsReport | null;
  error: string | null;
  now: number;
  nav: Nav;
  busy?: boolean;
  onCheck?: () => void;
  onFix?: (finding: UatDriftFinding) => void;
}) {
  const [filter, setFilter] = useState<UatFilterKey>("all");
  const rows = uatRows(tasks, report);
  const counts = uatFilterCounts(rows);
  const shown = filter === "all" ? rows : rows.filter((row) => row.group === filter);
  const portal = report?.portal;
  return (
    <div className="blk uat-tickets" data-testid="uat-tickets">
      <div className="bh pv-ovh">
        <span className="kk">
          / UAT tickets · <b>{rows.length}</b> · one task per portal ticket attempt
        </span>
        <div className="pv-filter" role="group" aria-label="UAT ticket filter">
          {FILTERS.map((f) => (
            <button type="button" key={f.key} className={filter === f.key ? "on" : ""} aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
              {f.label} · {counts[f.key]}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="uat-note warn">Couldn’t load lease and portal fields: {error}</p>}
      {portal?.status === "off" && (
        <p className="uat-note">Portal read is off: Portal step and Staging show “—”, and the check covers duplicate tasks and expired leases only.</p>
      )}
      {portal?.status === "error" && <p className="uat-note warn">Portal read failed: {portal.message}</p>}
      <DriftCheck report={report} busy={busy} now={now} onCheck={onCheck} onFix={onFix} />
      <div className="uat-table">
        <div role="table" aria-label="UAT ticket tasks">
          <div className="uat-row uat-head" role="row">
            {COLUMNS.map((h) => (
              <span role="columnheader" key={h}>
                {h}
              </span>
            ))}
          </div>
          {shown.map((row) => (
            <UatTicketRow key={row.task.id} row={row} facts={report?.facts[row.task.id]} now={now} nav={nav} />
          ))}
        </div>
        {shown.length === 0 && (
          <p className="pv-empty">{rows.length === 0 ? "No UAT ticket tasks in this initiative." : "No tickets match this filter."}</p>
        )}
      </div>
    </div>
  );
}

function UatTicketRow({ row, facts, now, nav }: { row: UatRow; facts: UatTaskFacts | undefined; now: number; nav: Nav }) {
  const { task, group, feedbackId, ticket } = row;
  const lease = facts?.lease ?? null;
  const note = stageNote(task);
  const closed = group === "verified" || group === "cancelled";
  const prs = task.prs.map((pr) => `#${pr.num} ${pr.status}`).join(" · ");
  return (
    <div className={`uat-row g-${group}`} role="row">
      <span role="cell">
        <button type="button" className="tl-link mono" onClick={() => nav("task", { taskId: task.id })}>
          {task.id}
        </button>
      </span>
      <span role="cell" className="uat-ticket">
        <span className="ttl">{task.title}</span>
        <a href={portalTicketUrl(feedbackId)} target="_blank" rel="noopener noreferrer" className="uat-portal-link">
          {ticketShortCode(feedbackId)} · Open in portal
          <ArrowUpRight size={10} aria-hidden="true" />
        </a>
      </span>
      <span role="cell">{ticket?.step ?? "—"}</span>
      <span role="cell" className="mono">{ticket?.attempt ?? uatAttempt(task.labels)}</span>
      <span role="cell" className="uat-stage">
        <span className={`pv-chip ${stageChipTone(task)}`}>{STAGES[STAGE_IDX[task.stage]].name}</span>
        {note && <span className={`uat-note${group === "human" ? " warn" : ""}`}>{note}</span>}
      </span>
      <span role="cell" className={`mono${leaseState(lease, now) === "expired" ? " warn" : ""}`}>{leaseText(lease, now)}</span>
      <span role="cell" className="mono">{prs || "—"}</span>
      <span role="cell" className="mono">{ticket?.staging ?? "—"}</span>
      <span role="cell">
        <span className={`pv-tag${group === "human" ? " warn" : ""}`}>{uatHolder(task, group, lease, now)}</span>
      </span>
      <span role="cell" className="mono">
        {closed || !facts?.createdAt ? "—" : duration(now - Date.parse(facts.createdAt))}
      </span>
    </div>
  );
}

function DriftCheck({
  report,
  busy,
  now,
  onCheck,
  onFix,
}: {
  report: UatTicketsReport | null;
  busy: boolean;
  now: number;
  onCheck: () => void;
  onFix: (finding: UatDriftFinding) => void;
}) {
  const drift = report?.drift ?? [];
  const last = report?.lastDailyCheck;
  const tone = drift.length > 0 ? " warn" : report ? " ok" : "";
  return (
    <div className={`uat-drift${drift.length > 0 ? " warn" : ""}`} aria-live="polite">
      <div className="uat-drift-h">
        <span className="kk">Portal ↔ Mission Control check</span>
        <span className={`uat-note${tone}`}>{!report ? "Not checked" : drift.length === 0 ? "In sync" : `${drift.length} out of sync`}</span>
        {report && (
          <span className="uat-note">
            Checked {ago(report.generatedAt, now)} · Daily check {last ? ago(last.at, now) : "not run yet"}
          </span>
        )}
        <button type="button" className="splink uat-check" onClick={onCheck} disabled={busy}>
          <RefreshCw size={11} aria-hidden="true" />
          Check now
        </button>
      </div>
      {drift.map((finding) => (
        <div className="uat-drift-row" key={`${finding.case}:${finding.taskId ?? finding.feedbackId}`}>
          <span className="mono">{finding.taskId ?? ticketShortCode(finding.feedbackId)}</span>
          <span className="t">{finding.text}</span>
          {finding.fix ? (
            <button type="button" className="uat-fix" disabled={busy} onClick={() => onFix(finding)}>
              {fixLabel(finding.fix)}
            </button>
          ) : (
            <span className="pv-tag">Portal fixes this</span>
          )}
        </div>
      ))}
    </div>
  );
}
