// Runtime approval gates (TASK-629/630) — the A2A "input-required" primitive.
// An agent mid-run raises a gate on its Task; the task's stage freezes
// (mc-data/policy) until a human — never the requester (separation of duties)
// — decides it. Every transition lands in mc_events (the append-only audit
// substrate) and the permissions decision audit covers the authz side.

import { randomBytes } from "node:crypto";

import { ApiError } from "@/lib/api/route";
import {
  approvalEvidenceRef,
  type ApprovalEvidenceRef,
  type ApprovalGate,
  type ApprovalProposal,
  type ApprovalScope,
  type Task,
} from "@/lib/mc-data";
import { approvalExpiry, deciderViolation, signApproval } from "./approval-signature";
import { APPROVAL_WAIT_MAX_MS, pendingApprovalGates } from "@/lib/mc-data/policy";
import type { ProjectAclPrincipal } from "@/lib/permissions/project-acl";
import { loadProjectAclMaps, scopeHierarchy } from "@/lib/permissions/project-acl-guard";
import { patchTask } from "@/lib/sync";
import { getEntities, getEntity } from "@/lib/sync/repo";
import { appendEvent, blockDispatchOnApproval, eventsByKinds, getDispatch, type EventRow } from "./repo";

export interface RequestApprovalInput {
  taskId: string;
  reason: string;
  /** Audit label of the requesting operator/agent session. */
  requestedBy: string;
  /** Agent runtime (mcp context), recorded on the gate + event. */
  runtime?: string;
  /** Authenticated service principal (API-key identity); bound to the gate for requester-only reads. */
  requestedByPrincipal: string;
  /**
   * Active checkout (dsp_*) to mark blocked-on-approval; validated by the caller. Bearer credential:
   * used only to set mc_dispatch.approval_gate_id, never stored on the task or in events.
   */
  checkoutId?: string;
  /** Redacted ref of `checkoutId` (dsp_…last4); the only form that reaches the gate and events. */
  checkoutRef?: string;
  /** Structured proposal, already validated (approvalProposalSchema). */
  proposal?: ApprovalProposal;
  /** TASK-3408: what the approval will cover (launch, merge or flags). */
  scope?: ApprovalScope;
  /** TASK-3408: where the request came from (a message link, a ticket). */
  sourceRef?: string;
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
    ...(input.checkoutRef ? { checkoutRef: input.checkoutRef } : {}),
    ...(input.proposal ? { proposal: input.proposal } : {}),
    ...(input.scope ? { scope: input.scope } : {}),
    ...(input.sourceRef ? { sourceRef: input.sourceRef } : {}),
    requestedBy: input.requestedBy,
    requestedByPrincipal: input.requestedByPrincipal,
    requestedRuntime: input.runtime,
    requestedAt: new Date().toISOString(),
    status: "pending",
  };

  // Block the checkout BEFORE persisting the gate (compare-and-set on the current block): a
  // checkout released mid-request, or a concurrent second gate, fails here with no gate stored
  // and no task frozen. A checkout whose current gate is still pending cannot take a new gate
  // (approving only the newer one would otherwise clear the older); a rejected/approved one can.
  let priorBlock: string | null = null;
  if (input.checkoutId) {
    const d = await getDispatch(input.checkoutId);
    priorBlock = d?.approvalGateId ?? null;
    if (priorBlock && task.approvalGates?.some((g) => g.id === priorBlock && g.status === "pending")) {
      throw new ApiError(
        "approval_pending",
        "Checkout already has a pending approval gate; wait for its decision before raising another.",
        409
      );
    }
    if (!(await blockDispatchOnApproval(input.checkoutId, gate.id, priorBlock))) {
      throw new ApiError("invalid_checkout", "Checkout is revoked, released, or changed during the request.", 409);
    }
  }

  const unblock = async () => {
    if (input.checkoutId) await blockDispatchOnApproval(input.checkoutId, priorBlock, gate.id);
  };
  let updated: Task | null | undefined;
  try {
    updated = await patchTask(
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
  } catch (err) {
    await unblock();
    throw err;
  }
  if (!updated) {
    await unblock();
    throw new ApiError("not_found", `unknown task ${input.taskId}`, 404);
  }

  await appendEvent({
    kind: "approval.requested",
    actor: input.requestedBy,
    taskId: input.taskId,
    payload: {
      gateId: gate.id,
      checkoutRef: input.checkoutRef ?? null,
      hasProposal: !!input.proposal,
      reason: gate.reason,
      runtime: input.runtime ?? null,
      scope: input.scope ?? null,
      sourceRef: input.sourceRef ?? null,
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
  /** Exact scope text and source shown by the human decision surface. */
  renderedScope?: string;
  renderedSourceRef?: string;
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
  if (violation) {
    // The rejected attempt is itself audit evidence; the gate is left untouched.
    await appendEvent({
      kind: "approval.denied",
      actor: input.decidedBy,
      taskId: input.taskId,
      payload: {
        gateId: gate.id,
        reasonCode: "separation_of_duties",
        attemptedDecision: input.decision,
        requestedBy: gate.requestedBy,
      },
    });
    throw new ApiError("separation_of_duties", violation, 403);
  }
  // TASK-3408: only people on the server-side allowlist (when one is set) decide.
  const notAllowed = input.decision === "approved" ? deciderViolation(input.decidedBy) : null;
  if (notAllowed) {
    await appendEvent({
      kind: "approval.denied",
      actor: input.decidedBy,
      taskId: input.taskId,
      payload: { gateId: gate.id, reasonCode: "decider_not_allowed", attemptedDecision: input.decision, requestedBy: gate.requestedBy },
    });
    throw new ApiError("decider_not_allowed", notAllowed, 403);
  }

  if (input.decision === "approved" && gate.scope && (
    input.renderedScope !== JSON.stringify(gate.scope, null, 2) ||
    (input.renderedSourceRef ?? null) !== (gate.sourceRef ?? null)
  )) {
    throw new ApiError("approval_scope_not_reviewed", "Review the current approval scope and source before approving.", 409);
  }

  const decidedAt = new Date().toISOString();
  const base: ApprovalGate = {
    ...gate,
    status: input.decision,
    decidedBy: input.decidedBy,
    decidedAt,
    note: input.note,
  };
  // An approval is stamped with its expiry, then signed over the whole record.
  const stamped: ApprovalGate =
    input.decision === "approved" ? { ...base, expiresAt: approvalExpiry(gate.scope, decidedAt) } : base;
  const decided: ApprovalGate =
    input.decision === "approved" ? { ...stamped, signature: signApproval(input.taskId, stamped) } : stamped;
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
      expiresAt: decided.expiresAt ?? null,
      signed: !!decided.signature,
    },
  });
  return { gate: decided, task: updated };
}

const APPROVAL_POLL_INTERVAL_MS = 1_000;

export interface ApprovalGateState {
  taskId: string;
  /** Redacted (dsp_…last4); the usable checkout id is never returned. */
  checkoutRef: string | null;
  gateId: string;
  status: ApprovalGate["status"];
  reason: string;
  proposal: ApprovalProposal | null;
  requestedBy: string;
  requestedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  note: string | null;
  /** TASK-3408: the approval's scope, expiry and whether it is signed. */
  scope: ApprovalScope | null;
  expiresAt: string | null;
  signed: boolean;
  /** True when this call returned on the wait cap with the gate still pending. */
  timedOut: boolean;
}

function gateState(taskId: string, gate: ApprovalGate, timedOut: boolean): ApprovalGateState {
  return {
    taskId,
    checkoutRef: gate.checkoutRef ?? null,
    gateId: gate.id,
    status: gate.status,
    reason: gate.reason,
    proposal: gate.proposal ?? null,
    requestedBy: gate.requestedBy,
    requestedAt: gate.requestedAt,
    decidedBy: gate.decidedBy ?? null,
    decidedAt: gate.decidedAt ?? null,
    note: gate.note ?? null,
    scope: gate.scope ?? null,
    expiresAt: gate.expiresAt ?? null,
    signed: !!gate.signature,
    timedOut,
  };
}

export interface GetApprovalGateInput {
  taskId: string;
  gateId: string;
  /** Only this authenticated principal may read the gate; checked before any wait. */
  requesterPrincipal?: string;
  /** Long-poll budget; clamped to APPROVAL_WAIT_MAX_MS. 0/omitted = single read. */
  waitMs?: number;
  /** Test seam: poll interval. */
  pollIntervalMs?: number;
}

/** Read a gate; when still pending, poll until decided or the (capped) wait elapses. */
export async function getApprovalGateState(input: GetApprovalGateInput): Promise<ApprovalGateState> {
  const waitMs = Math.min(Math.max(input.waitMs ?? 0, 0), APPROVAL_WAIT_MAX_MS);
  const interval = input.pollIntervalMs ?? APPROVAL_POLL_INTERVAL_MS;
  const deadline = Date.now() + waitMs;
  for (;;) {
    const row = await getEntity("task", input.taskId);
    if (!row) throw new ApiError("not_found", `unknown task ${input.taskId}`, 404);
    const task = row.data as unknown as Task;
    const gate = (task.approvalGates ?? []).find((g) => g.id === input.gateId);
    if (!gate) throw new ApiError("not_found", `unknown approval gate ${input.gateId}`, 404);
    if (input.requesterPrincipal !== undefined && gate.requestedByPrincipal !== input.requesterPrincipal) {
      throw new ApiError("forbidden", "approval gate was raised by another principal.", 403);
    }
    const remaining = deadline - Date.now();
    if (gate.status !== "pending" || remaining <= 0) {
      return gateState(task.id, gate, gate.status === "pending" && waitMs > 0);
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(interval, remaining)));
  }
}

export interface PendingApprovalRow {
  taskId: string;
  taskTitle: string;
  stage: string;
  gate: ApprovalGate;
  /** The task's existing evidence bundle, or null when the task has none. */
  evidence: ApprovalEvidenceRef | null;
}

/** Approvals inbox source (TASK-631): every pending gate on the tasks the principal's project ACL lets them see. */
export async function listPendingApprovals(principal: ProjectAclPrincipal): Promise<PendingApprovalRow[]> {
  const [rows, { projects, buckets }] = await Promise.all([getEntities("task"), loadProjectAclMaps()]);
  const tasks = rows.map((row) => row.data as unknown as Task);
  const out: PendingApprovalRow[] = [];
  for (const task of scopeHierarchy({ tasks, buckets, projects, principal }).tasks) {
    for (const gate of pendingApprovalGates(task)) {
      out.push({
        taskId: task.id,
        taskTitle: task.title,
        stage: task.stage,
        gate,
        evidence: approvalEvidenceRef(task.evidence),
      });
    }
  }
  out.sort((a, b) => a.gate.requestedAt.localeCompare(b.gate.requestedAt));
  return out;
}

export interface ApprovalAuditRow {
  gateId: string;
  taskId: string | null;
  /** Agent proposal side (approval.requested). */
  proposer: string | null;
  requestedAt: string | null;
  reason: string | null;
  runtime: string | null;
  /** Human decision side (approval.decided); null while pending. */
  decider: string | null;
  decision: "approved" | "rejected" | "pending";
  decidedAt: string | null;
  note: string | null;
  /** Rejected decide attempts on this gate (approval.denied), oldest first. */
  denials: { actor: string; ts: string; reasonCode: string; attemptedDecision: string | null }[];
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** Join approval.requested / approval.decided / approval.denied events by gateId. Pure. */
export function pairApprovalEvents(events: readonly EventRow[]): ApprovalAuditRow[] {
  const rows = new Map<string, ApprovalAuditRow>();
  const rowFor = (gateId: string, taskId: string | null): ApprovalAuditRow => {
    let row = rows.get(gateId);
    if (!row) {
      row = {
        gateId, taskId, proposer: null, requestedAt: null, reason: null, runtime: null,
        decider: null, decision: "pending", decidedAt: null, note: null, denials: [],
      };
      rows.set(gateId, row);
    }
    return row;
  };
  for (const e of [...events].sort((a, b) => Number(BigInt(a.seq) - BigInt(b.seq)))) {
    const gateId = str(e.payload.gateId);
    if (!gateId) continue;
    const row = rowFor(gateId, e.taskId);
    if (e.kind === "approval.requested") {
      row.proposer = e.actor;
      row.requestedAt = e.ts;
      row.reason = str(e.payload.reason);
      row.runtime = str(e.payload.runtime);
    } else if (e.kind === "approval.decided") {
      row.decider = e.actor;
      row.decision = e.payload.decision === "rejected" ? "rejected" : "approved";
      row.decidedAt = e.ts;
      row.note = str(e.payload.note);
      row.reason ??= str(e.payload.reason);
    } else if (e.kind === "approval.denied") {
      row.denials.push({
        actor: e.actor,
        ts: e.ts,
        reasonCode: str(e.payload.reasonCode) ?? "unknown",
        attemptedDecision: str(e.payload.attemptedDecision),
      });
    }
  }
  return [...rows.values()].sort((a, b) => (a.requestedAt ?? "").localeCompare(b.requestedAt ?? ""));
}

export const APPROVAL_AUDIT_KINDS = ["approval.requested", "approval.decided", "approval.denied"];

/** Audit export of proposal+decision pairs. `filter` lets the caller apply project ACLs to the raw events. */
export async function listApprovalAudit(
  opts: { limit?: number; filter?: (events: EventRow[]) => Promise<EventRow[]> } = {}
): Promise<ApprovalAuditRow[]> {
  const events = await eventsByKinds(APPROVAL_AUDIT_KINDS, opts.limit ?? 5000);
  return pairApprovalEvents(opts.filter ? await opts.filter(events) : events);
}
