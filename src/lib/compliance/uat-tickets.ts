// Server side of the BKT-UAT tickets view (TASK-3706): the bucket's UAT ticket
// tasks, when each was filed, its lease (mc_dispatch, without checkout ids),
// and the portal read. Read-only.

import { getBucketTasks } from "@/lib/sync/repo";
import { isUatTicketTask } from "@/lib/tasks/uat-labels";
import { UAT_TICKET_BUCKET, type UatLease, type UatTaskFacts, type UatTicketsReport } from "@/lib/tasks/uat-tickets";
import { agentLabel } from "./in-flight";
import { listDispatches, type DispatchListRow } from "./repo";
import { readPortalTickets } from "./uat-portal-read";

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
  const [dispatches, portal] = await Promise.all([
    taskIds.length > 0 ? listDispatches({ taskIds, limit: DISPATCH_LIMIT }) : Promise.resolve([]),
    readPortalTickets(now),
  ]);
  const facts: Record<string, UatTaskFacts> = {};
  for (const { task, createdAt } of rows) {
    const own = dispatches.filter((row) => row.taskId === task.id);
    facts[task.id] = { createdAt, lease: pickLease(own, now.getTime()) };
  }
  return { generatedAt: now.toISOString(), bucketId: UAT_TICKET_BUCKET, facts, portal };
}
