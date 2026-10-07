// TASK-2529 rollback step 1: the reopen script is dry-run by default and
// idempotent. Fixture-driven; a tiny in-memory client stands in for pg, so
// nothing here touches a database.
import { describe, expect, it } from "vitest";
import { formatReport, planReopen, runReopen } from "../scripts/reopen-cancelled-tasks.mjs";

type Row = { id: string; data: { stage: string }; cancellation: Record<string, unknown> | null };

const rows = (): Row[] => [
  { id: "TASK-1544", data: { stage: "cancelled" }, cancellation: { reason: "obsolete" } },
  { id: "TASK-2360", data: { stage: "cancelled" }, cancellation: { reason: "duplicate" } },
  { id: "TASK-622", data: { stage: "cancelled" }, cancellation: { reason: "delivered_without_pr" } },
  { id: "TASK-9", data: { stage: "progress" }, cancellation: { reason: "obsolete" } }, // stray value
];
const events = [
  { seq: 1, task_id: "TASK-1544", payload: { previousStage: "qa" } },
  { seq: 2, task_id: "TASK-2360", payload: { previousStage: "review" } },
  { seq: 3, task_id: "TASK-2360", payload: { previousStage: "planned" } }, // cancelled twice: latest wins
  { seq: 4, task_id: "TASK-622", payload: { previousStage: "merged" } }, // a terminal "previous" is never restored
];

function fakeDb() {
  const state = rows();
  const writes: string[] = [];
  return {
    state,
    writes,
    async query(sql: string, params: unknown[] = []) {
      if (/^\s*(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return { rows: [], rowCount: 0 };
      if (/FROM entities/.test(sql) && /^\s*SELECT/.test(sql)) {
        return { rows: state.filter((r) => r.data.stage === "cancelled" || r.cancellation != null), rowCount: 0 };
      }
      if (/FROM mc_events/.test(sql)) return { rows: events, rowCount: events.length };
      if (/^\s*UPDATE entities/.test(sql)) {
        const [id, stage] = params as [string, string | undefined];
        const r = state.find((x) => x.id === id)!;
        if (/data->>'stage' = 'cancelled'/.test(sql)) {
          if (r.data.stage !== "cancelled") return { rows: [], rowCount: 0 };
          r.data.stage = stage!;
        } else if (r.cancellation == null) {
          return { rows: [], rowCount: 0 };
        }
        r.cancellation = null;
        writes.push(id);
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`unexpected SQL: ${sql}`);
    },
  };
}

describe("planReopen", () => {
  const plan = planReopen(rows(), events);
  const byId = Object.fromEntries(plan.map((p: { id: string }) => [p.id, p]));

  it("restores the stage recorded by the latest cancel event", () => {
    expect(byId["TASK-1544"]).toMatchObject({ from: "cancelled", to: "qa", source: "cancel_event" });
    expect(byId["TASK-2360"]).toMatchObject({ to: "planned" });
  });

  it("never restores a terminal stage: falls back to backlog", () => {
    expect(byId["TASK-622"]).toMatchObject({ to: "backlog", source: "default" });
  });

  it("only nulls a stray cancellation on a task that is not cancelled", () => {
    expect(byId["TASK-9"]).toMatchObject({ clearOnly: true, from: "progress", to: "progress" });
  });
});

describe("runReopen", () => {
  it("dry run (default) writes nothing", async () => {
    const db = fakeDb();
    const report = await runReopen(db);
    expect(report.apply).toBe(false);
    expect(report.updated).toBe(0);
    expect(db.writes).toEqual([]);
    expect(formatReport(report, "uat")).toMatch(/DRY RUN[\s\S]*to reopen: 4[\s\S]*TASK-1544: cancelled -> qa[\s\S]*no rows written/);
  });

  it("--apply reopens and clears cancellation; a second --apply changes 0 rows", async () => {
    const db = fakeDb();
    const first = await runReopen(db, { apply: true });
    expect(first.updated).toBe(4);
    expect(db.state.map((r) => [r.id, r.data.stage, r.cancellation])).toEqual([
      ["TASK-1544", "qa", null],
      ["TASK-2360", "planned", null],
      ["TASK-622", "backlog", null],
      ["TASK-9", "progress", null],
    ]);
    const second = await runReopen(db, { apply: true });
    expect(second.plan).toEqual([]);
    expect(second.updated).toBe(0);
  });

  it("the SQL clears cancellation, re-queues the row, never touches completed_at, and is task-only", async () => {
    const seen: string[] = [];
    await runReopen({ query: async (sql: string) => { seen.push(sql); return { rows: rows().slice(0, 1), rowCount: 1 }; } }, { apply: true });
    const update = seen.find((s) => /^\s*UPDATE entities\s+SET data/.test(s))!;
    expect(update).toMatch(/cancellation = NULL/);
    expect(update).toMatch(/sync_state = 'pending'/);
    expect(update).toMatch(/entity_type = 'task'/);
    expect(update).not.toMatch(/completed_at/);
  });
});
