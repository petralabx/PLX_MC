// Runtime approval gates (TASK-629/630) — the A2A "input-required" primitive.
// An agent mid-run raises a gate on its Task; the task's stage freezes
// (mc-data/policy) until a human — never the requester (separation of duties)
// — decides it. Every transition lands in mc_events (the append-only audit
// substrate) and the permissions decision audit covers the authz side.

import { randomBytes } from "node:crypto";

import { ApiError } from "@/lib/api/route";
import type { ApprovalGate, Task } from "@/lib/mc-data";
import { pendingApprovalGates } from "@/lib/mc-data/policy";
import { patchTask } from "@/lib/sync";
import { getEntities, getEntity } from "@/lib/sync/repo";
import { appendEvent } from "./repo";

export interface RequestApprovalInput {
  taskId: string;
  reason: string;
  /** Audit label of the requesting operator/agent session. */
  requestedBy: string;
  /** Agent runtime (mcp context), recorded on the gate + event. */
  runtime?: string;
}

export async function requestApprovalGate(
  input: RequestApprovalInput
): Promise<{ gate: ApprovalGate; task: Task }> {
  const row = await getEntity("task", input.taskId);
  if (!row) throw new ApiError("not_found", `unknown task ${input.taskId}`, 404);
  const task = row.data as unknown as Task;

  const gate: ApprovalGate = {
    id: `apg_${randomBytes(8).toString("hex")}`,
    reason: input.reason,
    requestedBy: input.requestedBy,
    requestedRuntime: input.runtime,
    requestedAt: new Date().toISOString(),
    status: "pending",
  };

  const updated = await patchTask(
    input.taskId,
    {
      approvalGates: [...(task.approvalGates ?? []), gate],
      activityLine: {
        who: input.runtime ?? input.requestedBy,
        what: `raised an approval gate — ${gate.reason}`,
        kind: "gate",
      },
    },
    input.requestedBy,
    { attribution: { source: "service", actorId: input.requestedBy } }
  );
  if (!updated) throw new ApiError("not_found", `unknown task ${input.taskId}`, 404);

  await appendEvent({
    kind: "approval.requested",
    actor: input.requestedBy,
    taskId: input.taskId,
    payload: {
      gateId: gate.id,
      reason: gate.reason,
      runtime: input.runtime ?? null,
    },
  });
  return { gate, task: updated };
}

/** TASK-630 separation of duties: the requester can never decide their own gate. */
export function separationOfDutiesViolation(
  gate: Pick<ApprovalGate, "requestedBy">,
  deciderLabel: string
): string | null {
  if (gate.requestedBy.trim().toLowerCase() === deciderLabel.trim().toLowerCase()) {
    return "separation of duties: the requesting identity cannot decide its own approval gate.";
  }
  return null;
}

export interface DecideApprovalInput {
  taskId: string;
  gateId: string;
  decision: "approved" | "rejected";
  /** Deciding human's audit label (session email/oid) — never caller-supplied. */
  decidedBy: string;
  note?: string;
}

export async function decideApprovalGate(
  input: DecideApprovalInput
): Promise<{ gate: ApprovalGate; task: Task }> {
  const row = await getEntity("task", input.taskId);
  if (!row) throw new ApiError("not_found", `unknown task ${input.taskId}`, 404);
  const task = row.data as unknown as Task;
  const gates = task.approvalGates ?? [];
  const gate = gates.find((g) => g.id === input.gateId);
  if (!gate) throw new ApiError("not_found", `unknown approval gate ${input.gateId}`, 404);
  if (gate.status !== "pending") {
    throw new ApiError(
      "gate_already_decided",
      `approval gate ${gate.id} is already ${gate.status}.`,
      409
    );
  }
  const violation = separationOfDutiesViolation(gate, input.decidedBy);
  if (violation) throw new ApiError("separation_of_duties", violation, 403);

  const decided: ApprovalGate = {
    ...gate,
    status: input.decision,
    decidedBy: input.decidedBy,
    decidedAt: new Date().toISOString(),
    note: input.note,
  };
  const updated = await patchTask(
    input.taskId,
    {
      approvalGates: gates.map((g) => (g.id === gate.id ? decided : g)),
      activityLine: {
        who: input.decidedBy,
        what: `${input.decision} the approval gate — ${gate.reason}`,
        kind: "gate",
      },
    },
    input.decidedBy,
    { attribution: { source: "human", actorId: input.decidedBy } }
  );
  if (!updated) throw new ApiError("not_found", `unknown task ${input.taskId}`, 404);

  await appendEvent({
    kind: "approval.decided",
    actor: input.decidedBy,
    taskId: input.taskId,
    payload: {
      gateId: gate.id,
      decision: input.decision,
      reason: gate.reason,
      requestedBy: gate.requestedBy,
      note: input.note ?? null,
    },
  });
  return { gate: decided, task: updated };
}

export interface PendingApprovalRow {
  taskId: string;
  taskTitle: string;
  stage: string;
  gate: ApprovalGate;
}

/** Approvals inbox source (TASK-631): every pending gate across all tasks. */
export async function listPendingApprovals(): Promise<PendingApprovalRow[]> {
  const rows = await getEntities("task");
  const out: PendingApprovalRow[] = [];
  for (const row of rows) {
    const task = row.data as unknown as Task;
    for (const gate of pendingApprovalGates(task)) {
      out.push({ taskId: task.id, taskTitle: task.title, stage: task.stage, gate });
    }
  }
  out.sort((a, b) => a.gate.requestedAt.localeCompare(b.gate.requestedAt));
  return out;
}
