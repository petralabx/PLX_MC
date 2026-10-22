// UAT tickets view on BKT-UAT (TASK-3706). Client-safe and pure, like
// uat-labels.ts. One portal Feedback ticket attempt = one MC task (kind:code
// plus uat:<feedbackId>); the portal is the source of truth. PortalTicket is
// the read-only snapshot the portal must serve; until it does, the read is off.

import { UAT_LABEL_PREFIX, uatTicketLabel } from "./uat-labels";

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

/** GET /api/uat-tickets: facts by task id for every UAT ticket task, and the portal read. */
export interface UatTicketsReport {
  generatedAt: string;
  bucketId: string;
  facts: Record<string, UatTaskFacts>;
  portal: PortalRead;
}
