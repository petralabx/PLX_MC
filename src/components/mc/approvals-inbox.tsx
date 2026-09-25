"use client";

// Approvals inbox (TASK-631) — the human surface for runtime approval gates
// (TASK-629, A2A input-required). Lists every pending gate across tasks;
// approve/reject hits POST /api/approvals/decide (separation of duties and
// capability checks are server-side).

import { useCallback, useEffect, useState } from "react";

import { api, ApiClientError } from "@/lib/api";
import type { ApprovalGate } from "@/lib/mc-data";
import type { ScreenProps } from "@/components/mc/route";

export interface PendingApprovalRow {
  taskId: string;
  taskTitle: string;
  stage: string;
  gate: ApprovalGate;
}

interface ApprovalsResponse {
  approvals: PendingApprovalRow[];
}

// The queue source (GET /api/approvals), shared with Home's "What needs me".
export function fetchPendingApprovals(): Promise<PendingApprovalRow[]> {
  return api<ApprovalsResponse>("/approvals").then((data) => data.approvals);
}

export function approvalsLoadError(err: unknown): string {
  return err instanceof ApiClientError ? err.message : "Failed to load approvals.";
}

// The queue load's outcome. A failed load is its own state — never an empty
// list — so the screen can't show an auth error and "No pending approvals" at
// once (Wave 2 — UI trust).
export type ApprovalsLoad =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; rows: PendingApprovalRow[] };

export type ApprovalsView = "loading" | "error" | "empty" | "list";

export function approvalsView(load: ApprovalsLoad): ApprovalsView {
  if (load.status !== "ready") return load.status;
  return load.rows.length === 0 ? "empty" : "list";
}

// The non-list states (exactly one renders); nothing for "list", which the
// screen renders itself.
export function ApprovalsStatus({ load, onRetry }: { load: ApprovalsLoad; onRetry: () => void }) {
  const view = approvalsView(load);
  if (view === "loading") return <div className="ap-empty">Loading…</div>;
  if (view === "error" && load.status === "error") {
    return (
      <div className="ap-error" role="alert">
        {load.message}{" "}
        <button type="button" className="ap-btn" onClick={onRetry}>
          Retry
        </button>
      </div>
    );
  }
  if (view === "empty") {
    return <div className="ap-empty">No pending approvals — nothing is input-required.</div>;
  }
  return null;
}

export function ApprovalsInboxView({ nav }: ScreenProps) {
  const [queue, setQueue] = useState<ApprovalsLoad>({ status: "loading" });
  // A failed approve/reject — shown above the list it concerns, not as a view.
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyGate, setBusyGate] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = useCallback((): Promise<void> => {
    return fetchPendingApprovals()
      .then((rows) => {
        setQueue({ status: "ready", rows });
      })
      .catch((err: Error) => {
        setQueue({ status: "error", message: approvalsLoadError(err) });
      });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const retry = useCallback(() => {
    setQueue({ status: "loading" });
    void load();
  }, [load]);

  const decide = useCallback(
    async (row: PendingApprovalRow, decision: "approved" | "rejected") => {
      setBusyGate(row.gate.id);
      setActionError(null);
      try {
        await api("/approvals/decide", {
          method: "POST",
          body: JSON.stringify({
            taskId: row.taskId,
            gateId: row.gate.id,
            decision,
            note: notes[row.gate.id]?.trim() || undefined,
          }),
        });
        await load();
      } catch (err) {
        setActionError(err instanceof ApiClientError ? err.message : "Decision failed.");
      } finally {
        setBusyGate(null);
      }
    },
    [load, notes]
  );

  const view = approvalsView(queue);
  const rows = queue.status === "ready" ? queue.rows : [];

  return (
    <div className="ap-page">
      <div className="ap-head">
        <h1 className="ap-title">Approvals</h1>
        <p className="ap-sub">
          Runtime gates raised by agents mid-run. The task&apos;s stage is frozen until a
          human — never the requester — decides.
        </p>
      </div>
      <ApprovalsStatus load={queue} onRetry={retry} />
      {view === "list" && actionError ? <div className="ap-error">{actionError}</div> : null}
      {view === "list" ? (
        <ul className="ap-list">
          {rows.map((row) => (
            <li key={row.gate.id} className="ap-item">
              <div className="ap-item-main">
                <button
                  type="button"
                  className="ap-task"
                  onClick={() => nav("task", { taskId: row.taskId })}
                >
                  {row.taskId} · {row.taskTitle}
                </button>
                <div className="ap-reason">{row.gate.reason}</div>
                <div className="ap-meta">
                  requested by {row.gate.requestedBy}
                  {row.gate.requestedRuntime ? ` via ${row.gate.requestedRuntime}` : ""} ·{" "}
                  {new Date(row.gate.requestedAt).toLocaleString()} · stage {row.stage}
                </div>
                <input
                  className="ap-note"
                  placeholder="Optional decision note"
                  value={notes[row.gate.id] ?? ""}
                  onChange={(e) =>
                    setNotes((prev) => ({ ...prev, [row.gate.id]: e.target.value }))
                  }
                />
              </div>
              <div className="ap-actions">
                <button
                  type="button"
                  className="ap-btn approve"
                  disabled={busyGate === row.gate.id}
                  onClick={() => void decide(row, "approved")}
                >
                  Approve
                </button>
                <button
                  type="button"
                  className="ap-btn reject"
                  disabled={busyGate === row.gate.id}
                  onClick={() => void decide(row, "rejected")}
                >
                  Reject
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
