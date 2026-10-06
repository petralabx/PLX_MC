// TASK-633 — per-bucket / per-runtime cost-per-completed-task from fixture
// telemetry reported by two runtimes (no live DB).

import { describe, expect, it } from "vitest";

import type { EventRow } from "@/lib/compliance/repo";
import { computeCostRollup, UNBUCKETED } from "@/lib/routing/cost-rollup";

let seq = 0;
function ev(kind: string, actor: string, taskId: string | null, payload: Record<string, unknown> = {}): EventRow {
  seq += 1;
  return { seq: String(seq), ts: "2026-10-06T00:00:00Z", kind, actor, repo: null, taskId, pr: null, payload };
}
const tel = (actor: string, taskId: string | null, costCents: number | null, extra = {}) =>
  ev("agent.session_telemetry", actor, taskId, { tokensIn: 1000, tokensOut: 500, costCents, ...extra });

const buckets = new Map([
  ["TASK-1", "BKT-A"],
  ["TASK-2", "BKT-A"],
  ["TASK-3", "BKT-B"],
]);

describe("computeCostRollup", () => {
  const events = [
    ev("checkout", "claude-code", "TASK-1", { checkoutId: "dsp_1" }),
    tel("claude-code", "TASK-1", 200),
    ev("task.completed", "claude-code", "TASK-1", { checkoutId: "dsp_1" }),
    ev("checkout", "cursor", "TASK-2", { checkoutId: "dsp_2" }),
    tel("cursor", "TASK-2", 100),
    tel("cursor", "TASK-2", 50),
    ev("task.completed", "cursor", "TASK-2", { checkoutId: "dsp_2" }),
    ev("checkout", "cursor", "TASK-3", { checkoutId: "dsp_3" }),
    tel("cursor", null, 70, { checkoutId: "dsp_3" }),
  ];
  const result = computeCostRollup(events, buckets);

  it("gives cost per completed task for two runtimes", () => {
    const cc = result.byRuntime.find((r) => r.runtime === "claude-code");
    const cur = result.byRuntime.find((r) => r.runtime === "cursor");
    expect(cc).toMatchObject({ completedTasks: 1, costCents: 200, costPerCompletedTaskCents: 200 });
    // cursor: 220 cents total, one completed task.
    expect(cur).toMatchObject({ sessions: 3, completedTasks: 1, costCents: 220, costPerCompletedTaskCents: 220 });
  });

  it("rolls up per bucket with a per-runtime breakdown", () => {
    const a = result.byBucket.find((b) => b.bucket === "BKT-A");
    expect(a).toMatchObject({ completedTasks: 2, costCents: 350, costPerCompletedTaskCents: 175 });
    expect(a?.runtimes.map((r) => r.runtime)).toEqual(["claude-code", "cursor"]);
  });

  it("attributes telemetry to its checkout's task; no completion means null cost-per-task", () => {
    const b = result.byBucket.find((x) => x.bucket === "BKT-B");
    expect(b).toMatchObject({ costCents: 70, completedTasks: 0, costPerCompletedTaskCents: null });
  });

  it("puts tasks with no known bucket under unbucketed and treats null cost as 0", () => {
    const r = computeCostRollup([tel("cursor", "TASK-X", null), ev("task.completed", "cursor", "TASK-X")], buckets);
    expect(r.byBucket).toHaveLength(1);
    expect(r.byBucket[0]).toMatchObject({ bucket: UNBUCKETED, costCents: 0, costPerCompletedTaskCents: 0 });
  });

  it("counts a task completed twice once", () => {
    const r = computeCostRollup(
      [tel("cursor", "TASK-1", 90), ev("task.completed", "cursor", "TASK-1"), ev("task.completed", "cursor", "TASK-1")],
      buckets
    );
    expect(r.byRuntime[0].completedTasks).toBe(1);
  });
});
