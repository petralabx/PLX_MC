// UAT tickets view on BKT-UAT (TASK-3706). Client-safe and pure, like
// uat-labels.ts. One portal Feedback ticket attempt = one MC task (kind:code
// plus uat:<feedbackId>); the portal is the source of truth. PortalTicket is
// the read-only snapshot the portal must serve; until it does, the read is off.
// findUatDrift is the drift check the page, GET /api/uat-tickets and the
// daily cron share.

import { STAGES, STAGE_IDX, isOpenInRollup } from "@/lib/mc-data";
import type { StageKey, Task } from "@/lib/mc-data";
import { NEEDS_VINCE_LABEL, UAT_LABEL_PREFIX, isUatTicketTask, uatTicketLabel } from "./uat-labels";

export const UAT_TICKET_BUCKET = "BKT-UAT";
/** Ticket links go to the portal's canonical tester host (staging only). */
export const PORTAL_ORIGIN = "https://staging.plxcustomer.io";

const UAT_ATTEMPT_RE = /^uat-attempt:([1-9]\d*)$/;

/** The <feedbackId> of the task's uat:<feedbackId> label, or null. */
export function uatFeedbackId(labels: readonly string[] | undefined): string | null {
  const label = uatTicketLabel(labels);
  return label ? label.slice(UAT_LABEL_PREFIX.length) : null;
}

/** The portal's short ticket code: the last 6 characters of the id, upper case. */
export function ticketShortCode(feedbackId: string): string {
  return feedbackId.slice(-6).toUpperCase();
}

/** The portal ticket page: /uat?ticket=<feedbackId> (the portal's one link rule). */
export function portalTicketUrl(feedbackId: string): string {
  return `${PORTAL_ORIGIN}/uat?ticket=${encodeURIComponent(feedbackId)}`;
}

/** The attempt from uat-attempt:<n>; a first attempt carries no label, so 1. */
export function uatAttempt(labels: readonly string[] | undefined): number {
  let attempt = 1;
  for (const label of labels ?? []) {
    const match = UAT_ATTEMPT_RE.exec(label);
    if (match) attempt = Math.max(attempt, Number(match[1]));
  }
  return attempt;
}

/** Gold Feedback statuses (the portal's FeedbackStatus enum). */
export const PORTAL_TICKET_STATUSES = ["PENDING", "APPROVED", "AUTO_APPROVED", "REJECTED", "IN_PROGRESS", "READY_FOR_RETEST", "REOPENED", "RESOLVED"] as const;
export type PortalTicketStatus = (typeof PORTAL_TICKET_STATUSES)[number];

/**
 * One ticket as the portal reports it. `id` is the feedback id (uat:<id>);
 * `step` names the loop step in one line ("Agent fixing", "Re-test");
 * `expectsTask` says the portal's ticket sweep would give it a task now;
 * `staging` is one line on the fix's staging deploy, or null.
 */
export interface PortalTicket {
  id: string;
  status: PortalTicketStatus;
  step: string;
  attempt: number;
  expectsTask: boolean;
  staging: string | null;
  title: string;
  updatedAt: string;
}

/** The portal read: off (the default), the snapshot, or why it failed. */
export type PortalRead =
  | { status: "off" }
  | { status: "ok"; at: string; tickets: PortalTicket[] }
  | { status: "error"; at: string; message: string };

/** A ticket task's checkout, without its id; `agent` is the runtime's display name. */
export interface UatLease {
  agent: string;
  issuedAt: string;
  expiresAt: string;
  releasedAt: string | null;
  releasedReason: string | null;
}

export type LeaseState = "live" | "expired" | "released" | "none";

export function leaseState(lease: UatLease | null, nowMs: number): LeaseState {
  if (!lease) return "none";
  if (lease.releasedAt) return "released";
  return Date.parse(lease.expiresAt) > nowMs ? "live" : "expired";
}

/** What the server adds to a ticket task: when it was filed, and its lease. */
export interface UatTaskFacts {
  createdAt: string | null;
  /** The live checkout when there is one, else the newest unrevoked one. */
  lease: UatLease | null;
}

/**
 * GET /api/uat-tickets: facts by task id for every UAT ticket task, the portal
 * read, the drift findings, and the newest daily check (null before the first).
 */
export interface UatTicketsReport {
  generatedAt: string;
  bucketId: string;
  facts: Record<string, UatTaskFacts>;
  portal: PortalRead;
  drift: UatDriftFinding[];
  lastDailyCheck: { at: string; findings: number; portal: PortalRead["status"] } | null;
}

// ─── Drift: where Mission Control and the portal disagree ───────────────────

/** Staff rejected the ticket, or it is resolved. */
export function isClosedTicket(status: PortalTicketStatus): boolean {
  return status === "REJECTED" || status === "RESOLVED";
}

export type UatDriftCase =
  | "no_task"
  | "final_task_open_ticket"
  | "open_task_closed_ticket"
  | "duplicate_open_tasks"
  | "expired_lease_no_pr";

/** The one-click fix, as data: the page runs it through the store. */
export type UatDriftFix =
  | { kind: "create"; feedbackId: string; title: string; attempt: number }
  | { kind: "reopen"; taskId: string }
  | { kind: "requeue"; taskId: string }
  | { kind: "cancel"; taskId: string; reason: "obsolete" | "superseded"; replacedBy?: string; note: string };

/** One disagreement. `taskId` is null for an open ticket with no task; `fix` is null when only the portal can close it. */
export interface UatDriftFinding {
  case: UatDriftCase;
  feedbackId: string;
  taskId: string | null;
  text: string;
  fix: UatDriftFix | null;
}

export type DriftTask = Pick<Task, "id" | "title" | "stage" | "labels" | "prs">;

const taskNumber = (id: string) => Number(/(\d+)$/.exec(id)?.[1] ?? 0);
const stageName = (stage: StageKey) => STAGES[STAGE_IDX[stage]].name;
/** The newest attempt first: higher uat-attempt:<n>, then the higher task number. */
const byNewest = (a: DriftTask, b: DriftTask) => uatAttempt(b.labels) - uatAttempt(a.labels) || taskNumber(b.id) - taskNumber(a.id);

/**
 * One finding per task (or per ticket with no task). Pure; only UAT ticket
 * tasks count. "Open" is not verified and not cancelled: merged awaits re-test.
 * With the portal read off or failed, only the last two cases run.
 */
export function findUatDrift(input: {
  tasks: readonly DriftTask[];
  facts: Readonly<Record<string, UatTaskFacts | undefined>>;
  portal: PortalRead;
  now: Date;
}): UatDriftFinding[] {
  const byTicket = new Map<string, DriftTask[]>();
  for (const task of input.tasks) {
    if (!isUatTicketTask(task)) continue;
    const id = uatFeedbackId(task.labels)!;
    byTicket.set(id, [...(byTicket.get(id) ?? []), task]);
  }
  const tickets = input.portal.status === "ok" ? new Map(input.portal.tickets.map((t) => [t.id, t])) : null;
  const findings: UatDriftFinding[] = [];

  for (const [feedbackId, group] of byTicket) {
    const code = ticketShortCode(feedbackId);
    const ticket = tickets?.get(feedbackId);
    const sorted = [...group].sort(byNewest);
    const open = sorted.filter(isOpenInRollup);

    if (ticket && isClosedTicket(ticket.status)) {
      // Every open task should close too. A merged task on a resolved ticket
      // waits for the portal's verify, which Mission Control never sends.
      const word = ticket.status === "RESOLVED" ? "resolved" : "rejected";
      for (const task of open) {
        const waitsOnVerify = task.stage === "merged" && ticket.status === "RESOLVED";
        findings.push({
          case: "open_task_closed_ticket",
          feedbackId,
          taskId: task.id,
          text: waitsOnVerify
            ? `Ticket ${code} is resolved in the portal, but ${task.id} still awaits re-test. Only the portal's verify closes it, so re-send it from the portal.`
            : `${task.id} is open (${stageName(task.stage)}), but ticket ${code} is ${word} in the portal. An agent could still lease it.`,
          fix: waitsOnVerify ? null : { kind: "cancel", taskId: task.id, reason: "obsolete", note: `Portal ticket ${code} is ${word}.` },
        });
      }
      continue;
    }

    if (ticket?.expectsTask && open.length === 0) {
      // The portal wants a task and every task is final. A cancelled one
      // reopens; a verified one stays verified and the next attempt gets a
      // new task. A ticket that only lags expects no task and is left alone.
      const newest = sorted[0];
      findings.push({
        case: "final_task_open_ticket",
        feedbackId,
        taskId: newest.id,
        text: `${newest.id} is ${stageName(newest.stage)}, but ticket ${code} is still open in the portal (${ticket.step}).`,
        fix:
          newest.stage === "cancelled"
            ? { kind: "reopen", taskId: newest.id }
            : { kind: "create", feedbackId, title: ticket.title, attempt: Math.max(ticket.attempt, uatAttempt(newest.labels) + 1) },
      });
    }

    const [newest, ...older] = open;
    for (const task of older) {
      findings.push({
        case: "duplicate_open_tasks",
        feedbackId,
        taskId: task.id,
        text: `${task.id} and ${newest.id} are both open for ticket ${code}. Only the newest attempt stays open.`,
        fix: { kind: "cancel", taskId: task.id, reason: "superseded", replacedBy: newest.id, note: `Ticket ${code} has a newer attempt.` },
      });
    }

    for (const task of open) {
      // Ticket tasks start in backlog for Steward to lease (TASK-2759). Past
      // backlog with a dead lease and no open or merged PR, nobody holds it.
      if (task.stage === "backlog" || task.stage === "merged" || task.prs.some((pr) => pr.status !== "closed")) continue;
      if (leaseState(input.facts[task.id]?.lease ?? null, input.now.getTime()) !== "expired") continue;
      findings.push({
        case: "expired_lease_no_pr",
        feedbackId,
        taskId: task.id,
        text: `${task.id} is in ${stageName(task.stage)}, but its lease expired with no PR, so no agent holds it.`,
        fix: { kind: "requeue", taskId: task.id },
      });
    }
  }

  // Open with no task at all: the portal's sweep missed it. The portal
  // runbook's manual fix is the same, a task labelled uat:<feedbackId>.
  for (const ticket of tickets?.values() ?? []) {
    if (!ticket.expectsTask || isClosedTicket(ticket.status) || byTicket.has(ticket.id)) continue;
    findings.push({
      case: "no_task",
      feedbackId: ticket.id,
      taskId: null,
      text: `Ticket ${ticketShortCode(ticket.id)} is open in the portal (${ticket.step}), but has no Mission Control task.`,
      fix: { kind: "create", feedbackId: ticket.id, title: ticket.title, attempt: ticket.attempt },
    });
  }
  return findings;
}

/** POST /api/tasks body for a create fix: the portal's ticket task, minus its fenced ticket text. */
export function ticketTaskDraft(fix: Extract<UatDriftFix, { kind: "create" }>) {
  const labels = ["kind:code", `${UAT_LABEL_PREFIX}${fix.feedbackId}`, "repo:petralabx/plx-customer-portal", NEEDS_VINCE_LABEL];
  if (fix.attempt > 1) labels.push(`uat-attempt:${fix.attempt}`);
  return {
    title: `UAT ${fix.feedbackId.slice(0, 12)} — ${fix.title || "UAT feedback"}`.slice(0, 200),
    // needs-vince keeps Steward off it: this task has no ticket text for an agent.
    description: `Created by the Mission Control drift check: portal ticket ${ticketShortCode(fix.feedbackId)} was open with no open task. Read the ticket, then remove needs-vince so Steward can lease it: ${portalTicketUrl(fix.feedbackId)}`,
    bucket: UAT_TICKET_BUCKET,
    priority: "medium" as const,
    repos: ["portal-web"],
    targetEnv: "staging" as const,
    labels,
  };
}
