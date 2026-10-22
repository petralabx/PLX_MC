"use client";

// UatTickets — the BKT-UAT tickets view (TASK-3706): one row per UAT ticket
// task with portal step, attempt, stage, lease, PR, staging, holder, age and a
// link to the portal ticket; filters All · Needs a human · In flight · Waiting
// on submitter · Verified; no row cap. Task fields come from the store; filed
// time, lease and portal fields from GET /api/uat-tickets.

import { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";

import { api } from "@/lib/api";
import { ACTORS, STAGES, STAGE_IDX } from "@/lib/mc-data";
import type { Task } from "@/lib/mc-data";
import { UAT_HOLD_LABEL, isStewardBlocked, isUatTicketTask, needsVince, uatBlockCauses } from "@/lib/tasks/uat-labels";
import {
  leaseState,
  portalTicketUrl,
  ticketShortCode,
  uatAttempt,
  uatFeedbackId,
  type PortalTicket,
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
  useEffect(() => {
    let cancelled = false;
    api<UatTicketsReport>("/uat-tickets")
      .then((report) => {
        if (!cancelled) setView({ report, error: null, at: Date.now() });
      })
      .catch((err: unknown) => {
        const error = err instanceof Error ? err.message : String(err);
        if (!cancelled) setView((prev) => ({ ...prev, error, at: Date.now() }));
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return <UatTicketsPanel tasks={tasks} report={view.report} error={view.error} now={view.at} nav={nav} />;
}

/** The view for one report; split from the loader so it renders in tests. */
export function UatTicketsPanel({
  tasks,
  report,
  error,
  now,
  nav,
}: {
  tasks: Task[];
  report: UatTicketsReport | null;
  error: string | null;
  now: number;
  nav: Nav;
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
      {portal?.status === "off" && <p className="uat-note">Portal read is off: Portal step and Staging show “—”.</p>}
      {portal?.status === "error" && <p className="uat-note warn">Portal read failed: {portal.message}</p>}
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
