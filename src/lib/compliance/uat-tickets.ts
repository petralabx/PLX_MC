// Server side of the BKT-UAT tickets view (TASK-3706): the bucket's UAT ticket
// tasks, when each was filed, its lease (mc_dispatch, without checkout ids),
// the portal read, and the drift findings. Read-only: fixes run from the page
// through the normal task routes. The daily cron records each run as one
// uat.drift.checked event; the page shows the newest one.

import { portalBaseUrl } from "@/lib/secrets";
import { getBucketTasks } from "@/lib/sync/repo";
import { isUatTicketTask } from "@/lib/tasks/uat-labels";
import {
  UAT_TICKET_BUCKET,
  findUatDrift,
  type UatLease,
  type UatTaskFacts,
  type UatTicketsReport,
} from "@/lib/tasks/uat-tickets";
import { agentLabel } from "./in-flight";
import { appendEvent, eventsByKinds, listDispatches, type DispatchListRow } from "./repo";
import { readPortalTickets } from "./uat-portal-read";

export const UAT_DRIFT_EVENT_KIND = "uat.drift.checked";
// mc_list_checkouts' ceiling, per load; a ticket task has a few checkouts at most.
const DISPATCH_LIMIT = 2_000;

/** The live checkout when there is one, else the newest unrevoked one. Rows come newest first. */
export function pickLease(rows: readonly DispatchListRow[], nowMs: number): UatLease | null {
  const kept = rows.filter((row) => !row.revoked);
  const pick = kept.find((row) => !row.releasedAt && Date.parse(row.expiresAt) > nowMs) ?? kept[0];
  if (!pick) return null;
  return {
    agent: agentLabel(pick.runtime),
    issuedAt: pick.issuedAt,
    expiresAt: pick.expiresAt,
    releasedAt: pick.releasedAt,
    releasedReason: pick.releasedReason,
  };
}

export async function loadUatTickets(now = new Date()): Promise<UatTicketsReport> {
  const rows = (await getBucketTasks(UAT_TICKET_BUCKET)).filter((row) => isUatTicketTask(row.task));
  const taskIds = rows.map((row) => row.task.id);
  const [dispatches, portal, last] = await Promise.all([
    taskIds.length > 0 ? listDispatches({ taskIds, limit: DISPATCH_LIMIT }) : Promise.resolve([]),
    readPortalTickets(now),
    eventsByKinds([UAT_DRIFT_EVENT_KIND], 1),
  ]);
  const facts: Record<string, UatTaskFacts> = {};
  for (const { task, createdAt } of rows) {
    const own = dispatches.filter((row) => row.taskId === task.id);
    facts[task.id] = { createdAt, lease: pickLease(own, now.getTime()) };
  }
  const lastPayload = last[0]?.payload ?? {};
  return {
    generatedAt: now.toISOString(),
    bucketId: UAT_TICKET_BUCKET,
    facts,
    portal,
    portalOrigin: portalBaseUrl(),
    drift: findUatDrift({ tasks: rows.map((row) => row.task), facts, portal, now }),
    lastDailyCheck: last[0]
      ? {
          at: last[0].ts,
          findings: Array.isArray(lastPayload.findings) ? lastPayload.findings.length : 0,
          portal: lastPayload.portal === "ok" || lastPayload.portal === "error" ? lastPayload.portal : "off",
        }
      : null,
  };
}

/** One uat.drift.checked row: which cases fired on which tasks, never ticket text. */
export async function recordUatDriftCheck(report: UatTicketsReport): Promise<void> {
  await appendEvent({
    kind: UAT_DRIFT_EVENT_KIND,
    actor: "mc-uat-drift",
    payload: {
      bucketId: report.bucketId,
      tasks: Object.keys(report.facts).length,
      portal: report.portal.status,
      portalMessage: report.portal.status === "error" ? report.portal.message : null,
      findings: report.drift.map((f) => ({ case: f.case, taskId: f.taskId, feedbackId: f.feedbackId })),
    },
  });
}
