// What the viewer decided, for the Approvals screen (TASK-3720): the questions
// they answered and the gates they approved or rejected, inside a window of
// days, newest first, on the tasks their project ACL lets them see. The viewer
// is matched the way each record stores them: answerQuestion stores
// answer.answeredBy as the sessionAuthorId; decideApprovalGate stores
// gate.decidedBy as the session audit label (lowercased email, or oid).

import type { DecidedRow, Task } from "@/lib/mc-data";
import type { ProjectAclPrincipal } from "@/lib/permissions/project-acl";
import { loadProjectAclMaps, scopeHierarchy } from "@/lib/permissions/project-acl-guard";
import { getEntities } from "@/lib/sync/repo";

export const DECIDED_DAYS_DEFAULT = 14;
export const DECIDED_DAYS_MAX = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface DecidedViewer {
  /** sessionAuthorId of the signed-in person. */
  authorId: string;
  /** Session audit label of the signed-in person (requireSessionActor). */
  auditLabel: string;
}

/** The viewer's decisions on `tasks` at or after `since` (epoch ms), newest first. Pure. */
export function decidedRows(tasks: readonly Task[], viewer: DecidedViewer, since: number): DecidedRow[] {
  const label = viewer.auditLabel.trim().toLowerCase();
  const inWindow = (at: string | undefined): at is string => !!at && Date.parse(at) >= since;
  const out: DecidedRow[] = [];
  for (const task of tasks) {
    const row = { taskId: task.id, taskTitle: task.title };
    for (const question of task.questions ?? []) {
      const answer = question.answer;
      if (answer?.answeredBy === viewer.authorId && inWindow(answer.answeredAt)) {
        out.push({ kind: "question", ...row, decidedAt: answer.answeredAt, question });
      }
    }
    for (const gate of task.approvalGates ?? []) {
      if (gate.status === "pending" || gate.decidedBy?.trim().toLowerCase() !== label) continue;
      if (inWindow(gate.decidedAt)) out.push({ kind: "gate", ...row, decidedAt: gate.decidedAt, gate });
    }
  }
  return out.sort((a, b) => Date.parse(b.decidedAt) - Date.parse(a.decidedAt));
}

/** GET /api/approvals/decided: the last `days` days of the viewer's decisions. */
export async function listDecided(
  viewer: DecidedViewer,
  principal: ProjectAclPrincipal,
  days: number
): Promise<DecidedRow[]> {
  const [rows, { projects, buckets }] = await Promise.all([getEntities("task"), loadProjectAclMaps()]);
  const tasks = rows.map((row) => row.data as unknown as Task);
  const visible = scopeHierarchy({ tasks, buckets, projects, principal }).tasks;
  return decidedRows(visible, viewer, Date.now() - days * DAY_MS);
}
