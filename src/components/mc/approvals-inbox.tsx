"use client";

// Approvals inbox (TASK-631) — the human surface for runtime approval gates
// (TASK-629, A2A input-required). Lists every pending gate across tasks;
// approve/reject hits POST /api/approvals/decide (separation of duties and
// capability checks are server-side).

import { useCallback, useEffect, useState } from "react";

import { api, ApiClientError } from "@/lib/api";
import type { ApprovalGate } from "@/lib/mc-data";
import type { ScreenProps } from "@/components/mc/route";

interface PendingApprovalRow {
  taskId: string;
  taskTitle: string;
  stage: string;
  gate: ApprovalGate;
}

interface ApprovalsResponse {
  approvals: PendingApprovalRow[];
}

export function ApprovalsInboxView({ nav }: ScreenProps) {
  const [rows, setRows] = useState<PendingApprovalRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyGate, setBusyGate] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = useCallback((): Promise<void> => {
    return api<ApprovalsResponse>("/approvals")
      .then((data) => {
        setRows(data.approvals);
        setError(null);
      })
      .catch((err: Error) => {
        setError(err instanceof ApiClientError ? err.message : "Failed to load approvals.");
        setRows([]);
      });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = useCallback(
    async (row: PendingApprovalRow, decision: "approved" | "rejected") => {
      setBusyGate(row.gate.id);
      setError(null);
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
        setError(err instanceof ApiClientError ? err.message : "Decision failed.");
      } finally {
        setBusyGate(null);
      }
    },
    [load, notes]
  );

  return (
    <div className="ap-page">
      <div className="ap-head">
        <h1 className="ap-title">Approvals</h1>
        <p className="ap-sub">
          Runtime gates raised by agents mid-run. The task&apos;s stage is frozen until a
          human — never the requester — decides.
        </p>
      </div>
      {error ? <div className="ap-error">{error}</div> : null}
      {rows === null ? (
        <div className="ap-empty">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="ap-empty">No pending approvals — nothing is input-required.</div>
      ) : (
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
      )}
    </div>
  );
}
