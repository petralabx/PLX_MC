// TASK-4017 backfill: fixture-driven, no database.
import { describe, expect, it } from "vitest";
import { planPromotions, runBackfill } from "../scripts/backfill-prless-completed-stage.mjs";

const tasks = [
  { id: "TASK-3229", data: { stage: "backlog", prs: [] } },
  { id: "TASK-3228", data: { stage: "backlog" } },
  { id: "TASK-3300", data: { stage: "backlog", prs: [{ repo: "PLX_MC", num: 9, status: "open" }] } },
  { id: "TASK-3301", data: { stage: "backlog", prs: [] } },
  { id: "TASK-3302", data: { stage: "progress", prs: [] } },
  { id: "TASK-3992", data: { stage: "review", prs: [{ repo: "PLX_MC", num: 463, status: "open" }] } },
  { id: "TASK-3304", data: { stage: "backlog", prs: [{ repo: "PLX_MC", num: 10, status: "closed" }] } },
  { id: "TASK-3303", data: { stage: "backlog", prs: [] } }, // never completed
];
const events = [
  { seq: 1, task_id: "TASK-3229", payload: { outcome: "completed", prUrl: null } },
  { seq: 2, task_id: "TASK-3228", payload: {} },
  { seq: 3, task_id: "TASK-3300", payload: {} },
  { seq: 5, task_id: "TASK-3301", payload: { outcome: "blocked" } },
  { seq: 4, task_id: "TASK-3301", payload: { outcome: "completed" } }, // older
  { seq: 7, task_id: "TASK-3992", payload: { outcome: "completed" } },
  { seq: 8, task_id: "TASK-3304", payload: {} },
  { seq: 6, task_id: "TASK-3302", payload: { prUrl: "https://github.com/petralabx/PLX_MC/pull/2" } },
];

describe("planPromotions", () => {
  const plan = planPromotions(tasks, events);
  it("promotes PR-less completed tasks only", () => {
    expect(plan.promote).toEqual([
      { id: "TASK-3229", from: "backlog" },
      { id: "TASK-3228", from: "backlog" },
    ]);
  });
  it("skips tasks with PRs, a blocked latest outcome, or a prUrl; ignores never-completed", () => {
    expect(plan.skipped.map((s: { id: string }) => s.id)).toEqual(["TASK-3300", "TASK-3301", "TASK-3302", "TASK-3992", "TASK-3304"]);
  });
});

function fakeDb() {
  const rows = new Map(tasks.map((t) => [t.id, structuredClone(t.data) as Record<string, unknown>]));
  const sql: string[] = [];
  return {
    rows,
    sql,
    async query(text: string, params: unknown[] = []) {
      sql.push(text.trim().split(/\s+/)[0]);
      if (text.includes("FROM entities")) return { rows: [...rows].map(([id, data]) => ({ id, data })), rowCount: rows.size };
      if (text.includes("FROM mc_events")) return { rows: events, rowCount: events.length };
      if (text.startsWith("UPDATE") || text.trim().startsWith("UPDATE")) {
        const [id, stage, allowed] = params as [string, string, string[]];
        const d = rows.get(id)!;
        if (!allowed.includes(d.stage as string) || (Array.isArray(d.prs) && d.prs.length)) return { rows: [], rowCount: 0 };
        d.stage = stage;
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  };
}

describe("runBackfill", () => {
  it("dry run writes nothing", async () => {
    const db = fakeDb();
    const r = await runBackfill(db);
    expect(r.updated).toBe(0);
    expect(db.sql).not.toContain("UPDATE");
    expect(db.rows.get("TASK-3229")?.stage).toBe("backlog");
  });
  it("apply moves to merged (never verified) and is idempotent", async () => {
    const db = fakeDb();
    expect((await runBackfill(db, { apply: true })).updated).toBe(2);
    expect(db.rows.get("TASK-3229")?.stage).toBe("merged");
    expect(db.rows.get("TASK-3300")?.stage).toBe("backlog");
    expect(db.rows.get("TASK-3992")?.stage).toBe("review");
    expect(db.rows.get("TASK-3304")?.stage).toBe("backlog");
    expect((await runBackfill(db, { apply: true })).updated).toBe(0);
  });
});
