// TASK-2528 backfill: fixture-driven, no database. A tiny in-memory client
// stands in for pg so dry-run / apply / idempotency are exercised end to end.
import { describe, expect, it } from "vitest";
import { formatReport, resolveCompletions, runBackfill } from "../scripts/backfill-task-completed-at.mjs";

type Ev = { seq: number; ts: string; kind: string; task_id: string | null; payload: Record<string, unknown> };

const tasks = [
  // Merged 07-23, only promoted to Merged on 10-06 (the TASK-625 shape).
  { id: "TASK-625", data: { stage: "merged", prs: [{ repo: "PLX_MC", num: 1 }], merge: { sha: "a", on: "2026-10-06" } } },
  // Bulk-promoted 10-04; PR merge date lives only in merge.on.
  { id: "TASK-700", data: { stage: "merged", prs: [{ repo: "PLX_MC", num: 2 }], merge: { sha: "b", on: "2026-09-30" } } },
  // PR-linked, nothing to date it from.
  { id: "TASK-701", data: { stage: "merged", prs: [{ repo: "PLX_MC", num: 3 }] } },
  // No PR, closed via stage events; re-synced 09-09..09-11 without a stage change.
  { id: "TASK-800", data: { stage: "verified", prs: [] } },
  // No PR, terminal, no events at all.
  { id: "TASK-801", data: { stage: "merged", prs: [] } },
  // No PR; its only event is a terminal snapshot (notes-only progress carrying
  // task.stage) with no known previous stage — not evidence of a transition.
  { id: "TASK-802", data: { stage: "merged", prs: [] } },
  // Not terminal and never was.
  { id: "TASK-900", data: { stage: "progress", prs: [] } },
];

const events: Ev[] = [
  { seq: 1, ts: "2026-07-23T14:00:00Z", kind: "pr.merged", task_id: "TASK-625", payload: { taskIds: ["TASK-625"] } },
  { seq: 2, ts: "2026-07-24T14:00:00Z", kind: "pr.merged", task_id: "TASK-625", payload: {} }, // later duplicate
  { seq: 3, ts: "2026-10-06T09:00:00Z", kind: "task.promoted", task_id: "TASK-625", payload: { stage: "merged" } },
  { seq: 4, ts: "2026-09-01T00:00:00Z", kind: "task.progress", task_id: "TASK-800", payload: { stage: "progress" } },
  { seq: 5, ts: "2026-09-05T08:00:00Z", kind: "task.progress", task_id: "TASK-800", payload: { stage: "verified" } },
  // Re-syncs: same stage, no change — must be ignored.
  { seq: 6, ts: "2026-09-09T08:00:00Z", kind: "task.progress", task_id: "TASK-800", payload: { stage: "verified" } },
  { seq: 7, ts: "2026-09-11T08:00:00Z", kind: "task.progress", task_id: "TASK-800", payload: { stage: "verified" } },
  { seq: 9, ts: "2026-09-20T08:00:00Z", kind: "task.progress", task_id: "TASK-802", payload: { stage: "merged", notes: "n" } },
  // Stage events for a PR-linked task must not date it.
  { seq: 8, ts: "2026-10-04T00:00:00Z", kind: "task.promoted", task_id: "TASK-700", payload: { stage: "merged" } },
];

describe("resolveCompletions", () => {
  const out = resolveCompletions(tasks, events);
  const byId = Object.fromEntries(out.resolved.map((r: { id: string }) => [r.id, r]));

  it("dates PR-linked tasks from the earliest pr.merged event, not the promotion", () => {
    expect(byId["TASK-625"]).toMatchObject({ completedAt: "2026-07-23T14:00:00.000Z", source: "pr_merge:event" });
  });

  it("falls back to merge.on and ignores the stage-event promotion date", () => {
    expect(byId["TASK-700"]).toMatchObject({ completedAt: "2026-09-30T00:00:00.000Z", source: "pr_merge:merge.on" });
  });

  it("uses the first stage-changing event for non-PR tasks and ignores no-change re-syncs", () => {
    expect(byId["TASK-800"]).toMatchObject({ completedAt: "2026-09-05T08:00:00.000Z", source: "stage_event" });
  });

  it("lists what it cannot date, with a reason, and never guesses", () => {
    expect(out.unresolved).toEqual([
      { id: "TASK-701", reason: expect.stringMatching(/PR-linked/) },
      { id: "TASK-801", reason: expect.stringMatching(/no observed transition/) },
      { id: "TASK-802", reason: expect.stringMatching(/no observed transition/) },
    ]);
    expect(byId["TASK-802"]).toBeUndefined();
    expect(byId["TASK-701"]).toBeUndefined();
    expect(byId["TASK-801"]).toBeUndefined();
  });

  it("skips tasks that never reached a terminal stage", () => {
    expect(byId["TASK-900"]).toBeUndefined();
    expect(out.unresolved.some((u: { id: string }) => u.id === "TASK-900")).toBe(false);
  });

  it("counts by source", () => {
    expect(out.counts).toEqual({ "pr_merge:event": 1, "pr_merge:merge.on": 1, stage_event: 1 });
  });

  it("no INFRA re-sync date (09-09..09-11) is ever chosen", () => {
    for (const r of out.resolved) expect(r.completedAt).not.toMatch(/^2026-09-(09|10|11)/);
  });
});

function fakeDb() {
  const completed = new Map<string, string>();
  const writes: string[] = [];
  const updates: string[] = [];
  return {
    updates,
    completed,
    writes,
    async query(sql: string, params: unknown[] = []) {
      if (/^\s*(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return { rows: [], rowCount: 0 };
      if (/FROM entities WHERE entity_type = 'task' AND completed_at IS NULL/.test(sql)) {
        return { rows: tasks.filter((t) => !completed.has(t.id)), rowCount: 0 };
      }
      if (/FROM mc_events/.test(sql)) return { rows: events, rowCount: events.length };
      if (/^\s*UPDATE entities\s+SET completed_at/.test(sql)) {
        updates.push(sql);
        const [id, at] = params as [string, string];
        writes.push(id);
        if (completed.has(id)) return { rows: [], rowCount: 0 };
        completed.set(id, at);
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`unexpected SQL: ${sql}`);
    },
  };
}

describe("runBackfill", () => {
  it("dry run (default) writes nothing", async () => {
    const db = fakeDb();
    const report = await runBackfill(db);
    expect(report.apply).toBe(false);
    expect(report.updated).toBe(0);
    expect(db.writes).toEqual([]);
    expect(formatReport(report, "uat")).toMatch(/DRY RUN[\s\S]*resolved: 3[\s\S]*unresolved: 3[\s\S]*TASK-701/);
  });

  it("--apply writes resolved rows; a second --apply changes 0 rows", async () => {
    const db = fakeDb();
    const first = await runBackfill(db, { apply: true });
    expect(first.updated).toBe(3);
    expect(db.completed.get("TASK-625")).toBe("2026-07-23T14:00:00.000Z");
    const second = await runBackfill(db, { apply: true });
    expect(second.updated).toBe(0);
    expect(second.resolved).toEqual([]);
  });

  it("queues CompletedAt for the outbound sweep without touching other fields or non-task rows", async () => {
    const db = fakeDb();
    await runBackfill(db, { apply: true });
    const sql = db.updates[0];
    expect(sql).toMatch(/entity_type = 'task'/);
    expect(sql).toMatch(/completed_at IS NULL/);
    // synced -> pending only (a conflicted row keeps its state); CompletedAt
    // is added to dirty_fields idempotently; nothing else is rewritten.
    expect(sql).toMatch(/sync_state = CASE WHEN sync_state = 'synced' THEN 'pending' ELSE sync_state END/);
    expect(sql).toMatch(/dirty_fields @> '"completedAt"'::jsonb/);
    expect(sql).not.toMatch(/\bdata\s*=/);
  });
});
