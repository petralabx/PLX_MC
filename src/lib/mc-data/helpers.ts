// Pure derivations over the data layer. These carry real invariants (sync
// counts, confidence, the Petra-domain rule) and are unit-tested in
// tests/mc-data.test.ts. The Petra-domain rule here is a UI convenience; the
// non-negotiable server-side enforcement lands with the directory module.

import {
  AGENTS,
  CURRENT_USER,
  STAGE_IDX,
  STAGES,
  SYNC_REGISTERS,
  TASKS,
} from "./data";
import type { Band, Confidence, Evidence, StageKey, Task } from "./types";

const PETRA_EMAIL = /^[^@\s]+@(petralabx|petrasoap)\.com$/i;

export function bandOf(stageKey: string): Band {
  return STAGES[STAGE_IDX[stageKey]].band;
}

export function tasksInBucket(bucketId: string): Task[] {
  return TASKS.filter((t) => t.bucket === bucketId);
}

export function evidenceComplete(ev?: Evidence): boolean {
  return !!ev && ev.items.every((i) => i.done);
}

export interface SyncCounts {
  pending: number;
  conflict: number;
  error: number;
}

export function syncCounts(): SyncCounts {
  return SYNC_REGISTERS.reduce<SyncCounts>(
    (acc, r) => ({
      pending: acc.pending + r.counts.pending,
      conflict: acc.conflict + r.counts.conflict,
      error: acc.error + r.counts.error,
    }),
    { pending: 0, conflict: 0, error: 0 }
  );
}

export function pendingTasks(): Task[] {
  return TASKS.filter((t) => t.sync.state === "pending");
}

// An agent is "active" when it executes an in-flight (doing-band) task — real,
// derived presence, not a fabricated heartbeat (EN-005 obs. #1/#4). Pass the
// store's live task array for reactive screens; defaults to the fixture.
const DOING_BAND_STAGES: StageKey[] = ["progress", "qa", "review"];

export function agentIsActive(agentId: string, tasks: Task[] = TASKS): boolean {
  return tasks.some((t) => t.assignee === agentId && DOING_BAND_STAGES.includes(t.stage));
}

export function liveAgentCount(tasks: Task[] = TASKS): number {
  return Object.keys(AGENTS).filter((id) => agentIsActive(id, tasks)).length;
}

// Tasks the viewer owns, co-owns, or reports — drives the Inbox "Assigned to me".
// Pass the store's live task array for reactive screens; defaults to the fixture.
export function tasksForUser(userId: string = CURRENT_USER, tasks: Task[] = TASKS): Task[] {
  return tasks.filter(
    (t) =>
      t.assignee === userId ||
      t.coassignees.includes(userId) ||
      t.reporter === userId
  );
}

// One quiet read per task: ready / building / gap / blocked.
export function confidenceOf(task: Task): Confidence {
  if (task.blocked) return { state: "blocked", label: "Blocked", pct: 0 };
  if (task.stage === "verified" || task.stage === "merged") {
    return { state: "ready", label: task.stage === "verified" ? "Verified" : "Merged", pct: 100 };
  }
  const ev = task.evidence;
  if (ev) {
    const done = ev.items.filter((i) => i.done).length;
    const pct = Math.round((done / ev.items.length) * 100);
    if (task.stage === "qa" || task.stage === "review") {
      if (done === ev.items.length) return { state: "ready", label: "Ready", pct: 100 };
      return { state: "gap", label: `${done}/${ev.items.length} evidence`, pct };
    }
    return { state: "building", label: "Building", pct };
  }
  if (STAGE_IDX[task.stage] >= STAGE_IDX.progress) {
    return { state: "building", label: "Building", pct: 40 };
  }
  return { state: "building", label: "Planned", pct: 15 };
}

export function isPetraEmail(email: string): boolean {
  return PETRA_EMAIL.test(String(email ?? "").trim());
}

export function domainOf(email: string): string {
  return (String(email ?? "").split("@")[1] ?? "").toLowerCase();
}
