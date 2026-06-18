"use client";

// Meeting Intake triage surface (EN-004 / WS-4). Reuses the Inbox row patterns.
// GATED: only rendered with content when the feature flag is on (governance:
// disabled by default). Proposed items are clearly marked UNVERIFIED — a human
// reviews, picks the initiative, and PROMOTES into a governed task, or dismisses.
import { useState } from "react";

import { useMcVersion } from "@/lib/mc-data/hooks";
import { actorById, allBuckets } from "@/lib/mc-data/store";
import { meetingIntakeEnabled } from "@/lib/meeting-intake";
import { useMeetingIntakeVersion } from "@/lib/meeting-intake/hooks";
import {
  dismissProposedTask,
  pendingProposedTasks,
  promoteProposedTask,
} from "@/lib/meeting-intake/store";

import type { ScreenProps } from "./route";

export function MeetingIntakeView({ nav }: ScreenProps) {
  useMcVersion();
  useMeetingIntakeVersion();
  const [bucketChoice, setBucketChoice] = useState<Record<string, string>>({});
  const enabled = meetingIntakeEnabled();
  const items = enabled ? pendingProposedTasks() : [];

  if (!enabled) {
    return (
      <div className="mc-main">
        <div className="ph">
          <div>
            <span className="kk">Meeting bridge · disabled</span>
            <h1>
              Meeting <em>intake</em>
            </h1>
            <p className="sub">
              The meeting → Mission Control bridge is off. It ships disabled by default and is
              gated by a feature flag + kill switch (External Integrations governance). Enable it to
              triage meeting-derived action items here.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const promote = (id: string, fallbackBucket: string | null) => {
    const bucket = bucketChoice[id] ?? fallbackBucket ?? undefined;
    const task = promoteProposedTask(id, bucket ? { bucket } : {});
    if (task) nav("task", { taskId: task.id });
  };

  return (
    <div className="mc-main">
      <div className="ph">
        <div>
          <span className="kk">Meeting bridge · triage</span>
          <h1>
            Meeting <em>intake</em>
          </h1>
          <p className="sub">
            Action items captured from designated Teams meetings land here as proposed tasks —
            never auto-entered. Review the owner and initiative, then promote into a governed task
            or dismiss. The meeting source is kept with the task as evidence.
          </p>
        </div>
        <div className="r">
          <span className="count">
            <b>{items.length}</b> proposed
          </span>
        </div>
      </div>

      <div className="intake-queue">
        {items.length === 0 && (
          <div className="colempty">No proposed meeting items awaiting triage.</div>
        )}
        {items.map((p) => {
          const owner = p.ownerId ? actorById(p.ownerId) : undefined;
          const selected = bucketChoice[p.id] ?? p.candidateBucket ?? "";
          return (
            <div className="intake-row" key={p.id}>
              <div className="intake-head">
                <span className="id">{p.id}</span>
                <span className="body">{p.suggestedTitle}</span>
                <span className="pill warn">
                  <span className="dot" />
                  proposed
                </span>
                <span className="pill muted">
                  <span className="dot" />
                  {p.evidence.source === "aiInsights" ? "AI insights" : "transcript"}
                </span>
              </div>
              <div className="intake-meta">
                <span className="owner">
                  {owner
                    ? `Owner · ${owner.name}`
                    : p.ownerDisplayName
                      ? `Owner unresolved · "${p.ownerDisplayName}"`
                      : "Owner · unassigned"}
                </span>
                {p.evidence.timestamp && <span className="ts">@ {p.evidence.timestamp}</span>}
              </div>
              {p.evidence.snippet && <div className="intake-snippet">{p.evidence.snippet}</div>}
              <div className="intake-acts">
                <select
                  className="intake-bucket"
                  aria-label="Initiative"
                  value={selected}
                  onChange={(event) =>
                    setBucketChoice((prev) => ({ ...prev, [p.id]: event.target.value }))
                  }
                >
                  <option value="">Pick an initiative…</option>
                  {allBuckets().map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn acc sm"
                  disabled={!selected}
                  onClick={() => promote(p.id, p.candidateBucket)}
                >
                  Promote →
                </button>
                <button
                  type="button"
                  className="btn ghost sm"
                  onClick={() => dismissProposedTask(p.id)}
                >
                  Dismiss
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
