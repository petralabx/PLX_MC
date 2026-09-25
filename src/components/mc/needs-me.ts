// "What needs me today" (Wave 6 — colleague UX): the pure derivation behind
// Home. For the signed-in viewer it picks approvals waiting on them, routing
// proposals they own, their overdue tasks, tasks with no accountable owner
// (owners/admins) and SharePoint sync issues (owners/admins), and turns each
// into a row with exactly one action. No React, no store reads, no clock —
// callers pass the viewer, the tasks, the loads and today's grid day, so every
// rule is unit-tested (tests/mc-needs-me.test.ts).
import { isOverdue } from "@/lib/mc-data/insights";
import {
  PRIORITY,
  hasHumanAccountableOwner,
  pendingApprovalGates,
  tasksForUser,
  type Human,
  type Task,
} from "@/lib/mc-data";
import { directoryRoleToAccessRole } from "@/lib/permissions";

import type { PendingApprovalRow } from "./approvals-inbox";
import type { Route } from "./route";
import type { InboxProposalSummary } from "./routing-inbox";
import { dueDay } from "./work-views.helpers";

// ─── Loads ───────────────────────────────────────────────────────────────────

/** One section's load. A failure is its own state — never an empty list. */
export type SectionLoad<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; rows: T[] };

export function sectionView<T>(load: SectionLoad<T>): "loading" | "error" | "empty" | "list" {
  if (load.status !== "ready") return load.status;
  return load.rows.length === 0 ? "empty" : "list";
}

/** The viewer is still loading (GET /api/viewer pending) or failed to resolve. */
export function viewerLoadState(viewer: Human | null, settled: boolean): "loading" | "error" | "ready" {
  if (viewer) return "ready";
  return settled ? "error" : "loading";
}

// ─── Who sees what ───────────────────────────────────────────────────────────

/** Owners and admins also see team-wide items: unowned tasks, sync issues, every approval. */
export function isOwnerOrAdmin(viewer: Pick<Human, "role">): boolean {
  const role = directoryRoleToAccessRole(viewer.role);
  return role === "owner" || role === "admin";
}

const viewerTokens = (viewer: Pick<Human, "id" | "email">): Set<string> =>
  new Set([viewer.id, viewer.email ?? ""].map((v) => v.trim().toLowerCase()).filter(Boolean));

/** Every pending approval gate on these tasks — the shape GET /api/approvals returns. */
export function pendingApprovalRows(tasks: Task[]): PendingApprovalRow[] {
  return tasks.flatMap((task) =>
    pendingApprovalGates(task).map((gate) => ({
      taskId: task.id,
      taskTitle: task.title,
      stage: task.stage,
      gate,
    }))
  );
}

/**
 * Gates this viewer should decide: never one they raised (separation of
 * duties — requestedBy is a session label, so match id or email, any case);
 * owners/admins get the rest, anyone else only gates on tasks they are the
 * accountable owner of.
 */
export function approvalsWaitingOn(viewer: Human, rows: PendingApprovalRow[], tasks: Task[]): PendingApprovalRow[] {
  const me = viewerTokens(viewer);
  const broad = isOwnerOrAdmin(viewer);
  const ownerOf = new Map(tasks.map((t) => [t.id, t.accountableOwner]));
  return rows.filter((row) => {
    if (me.has(row.gate.requestedBy.trim().toLowerCase())) return false;
    return broad || ownerOf.get(row.taskId) === viewer.id;
  });
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Today on the due-date grid that task dates ("Jun 16") are compared on —
 * the same dueDay() mapping Insights and the timeline use.
 */
export function todayGridDay(now: Date): number {
  const label = `${MONTHS[now.getMonth()]} ${String(now.getDate()).padStart(2, "0")}`;
  // dueDay only returns null for strings without a day number; this has one.
  return dueDay(label) ?? now.getDate();
}

/**
 * The viewer's overdue work: tasks they are assigned, co-assigned, reported or
 * accountable for, due before today and not done (Insights' isOverdue rule).
 * Most overdue first.
 */
export function overdueFor(viewer: Pick<Human, "id">, tasks: Task[], todayDay: number): Task[] {
  const mine = new Set(tasksForUser(viewer.id, tasks).map((t) => t.id));
  return tasks
    .filter((t) => (mine.has(t.id) || t.accountableOwner === viewer.id) && isOverdue(t, todayDay))
    .sort((a, b) => (dueDay(a.due) ?? 0) - (dueDay(b.due) ?? 0) || a.id.localeCompare(b.id));
}

const PRIORITY_RANK = Object.keys(PRIORITY);
const isDone = (t: Task) => t.stage === "merged" || t.stage === "verified";

/** Open tasks with no human accountable owner — owners/admins only (null otherwise). */
export function unownedTasks(viewer: Pick<Human, "role">, tasks: Task[]): Task[] | null {
  if (!isOwnerOrAdmin(viewer)) return null;
  return tasks
    .filter((t) => !isDone(t) && !hasHumanAccountableOwner(t))
    .sort(
      (a, b) =>
        PRIORITY_RANK.indexOf(a.priority) - PRIORITY_RANK.indexOf(b.priority) || a.id.localeCompare(b.id)
    );
}

/** Conflicts + errors waiting in the sync console — owners/admins only (null otherwise). */
export function syncIssuesFor(
  viewer: Pick<Human, "role">,
  counts: { conflict: number; error: number }
): number | null {
  return isOwnerOrAdmin(viewer) ? counts.conflict + counts.error : null;
}

/** The Home badge: everything the store alone can say needs this viewer. */
export function needsMeCount(
  viewer: Human,
  tasks: Task[],
  todayDay: number,
  counts: { conflict: number; error: number }
): number {
  return (
    approvalsWaitingOn(viewer, pendingApprovalRows(tasks), tasks).length +
    overdueFor(viewer, tasks, todayDay).length +
    (unownedTasks(viewer, tasks)?.length ?? 0) +
    (syncIssuesFor(viewer, counts) ?? 0)
  );
}

// ─── Rows: one clear action each ─────────────────────────────────────────────

export interface NeedsRow {
  key: string;
  /** Short label for the row's kind. */
  tag: string;
  /** Record id shown beside the title (TASK-221). */
  id?: string;
  title: string;
  meta?: string;
  /** The row's one action. */
  action: string;
  to: Route;
}

export function approvalRows(rows: PendingApprovalRow[]): NeedsRow[] {
  return rows.map((row) => ({
    key: `approval:${row.gate.id}`,
    tag: "Approval",
    id: row.taskId,
    title: row.gate.reason,
    meta: `asked by ${row.gate.requestedBy}`,
    action: "Review",
    to: { screen: "approvals" },
  }));
}

export function routingRows(proposals: InboxProposalSummary[]): NeedsRow[] {
  return proposals.map((p) => ({
    key: `routing:${p.id}`,
    tag: "Routing",
    title: p.title ?? p.changeId,
    meta: `${p.repoId} · waiting ${p.slaAgeHours}h`,
    action: "Decide",
    to: { screen: "routing-inbox" },
  }));
}

export function overdueRows(tasks: Task[]): NeedsRow[] {
  return tasks.map((t) => ({
    key: `overdue:${t.id}`,
    tag: "Overdue",
    id: t.id,
    title: t.title,
    meta: `due ${t.due}`,
    action: "Open",
    to: { screen: "task", taskId: t.id },
  }));
}

export function unownedRows(tasks: Task[]): NeedsRow[] {
  return tasks.map((t) => ({
    key: `unowned:${t.id}`,
    tag: "No owner",
    id: t.id,
    title: t.title,
    meta: PRIORITY[t.priority].label,
    action: "Assign owner",
    to: { screen: "task", taskId: t.id },
  }));
}

export function syncRows(count: number): NeedsRow[] {
  if (count <= 0) return [];
  return [
    {
      key: "sync",
      tag: "Sync",
      title: `${count} SharePoint sync ${count === 1 ? "issue" : "issues"} to resolve`,
      action: "Resolve",
      to: { screen: "sync" },
    },
  ];
}
