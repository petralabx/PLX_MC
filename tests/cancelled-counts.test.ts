// TASK-2529 acceptance 3: a cancelled task drops out of open/remaining counts
// (dashboard, project and bucket progress, mc_get_context) and is never counted
// as merged or verified; mc_search_tasks stage=cancelled lists it with its reason.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Task } from "@/lib/mc-data";
import { legacySearchFixture } from "./helpers/task-search-fixture";

const cancellation = {
  reason: "obsolete" as const, replacedBy: null, cancelledAt: "2026-10-07T00:00:00.000Z", cancelledBy: "sp_mcp_codex",
};
const task = (id: string, stage: Task["stage"], extra: Partial<Task> = {}) =>
  ({ id, title: id, description: "", stage, bucket: "BKT-A", priority: "medium", labels: [], coassignees: [], ...extra }) as Task;

const tasks: Task[] = [
  task("TASK-1", "progress"),
  task("TASK-2", "merged"),
  task("TASK-3", "cancelled", { cancellation, completedAt: "2026-10-07T00:00:00.000Z" }),
  task("TASK-4", "cancelled", { cancellation }),
];

vi.mock("@/lib/sync", () => ({
  createTask: vi.fn(),
  patchTask: vi.fn(),
  searchTaskPage: vi.fn(async (filter, hidden) => legacySearchFixture(tasks, filter, hidden)),
  snapshot: vi.fn(async () => ({
    tasks, buckets: [{ id: "BKT-A", name: "A" }], projects: [], conflicts: [], errors: [], lastSweep: "now",
  })),
}));
vi.mock("@/lib/sync/repo", () => ({ getEntity: vi.fn(async () => null) }));
vi.mock("@/lib/mcp/sync-meta", () => ({ syncMetaForTask: vi.fn(async () => ({ status: "queued" })) }));
vi.mock("@/lib/compliance/service", () => ({ complete: vi.fn(), checkout: vi.fn() }));
vi.mock("@/lib/compliance/repo", () => ({ getDispatch: vi.fn(), appendEvent: vi.fn() }));

import { actionGetContext, actionSearchTasks } from "@/lib/mcp/actions";
import { buildInsights, isOverdue } from "@/lib/mc-data/insights";
import { confidenceOf } from "@/lib/mc-data/helpers";
import { isClosedStage, TERMINAL_STAGES } from "@/lib/mc-data/policy";
import { BANDS, STAGES, WORKFLOW_STAGES, bandOf } from "@/lib/mc-data";
import { projectProgress, rollupForProject, stageChipTone } from "@/components/mc/project-overview.helpers";
import { timelineSegmentClass } from "@/components/mc/work-views.helpers";

beforeEach(() => vi.clearAllMocks());

describe("stage model", () => {
  it("cancelled is a terminal, closed stage in its own band — never done", () => {
    expect(TERMINAL_STAGES).toContain("cancelled");
    expect(isClosedStage("cancelled")).toBe(true);
    expect(isClosedStage("progress")).toBe(false);
    expect(bandOf("cancelled")).toBe("cancelled");
    expect(BANDS.map((b) => b.key)).toContain("cancelled");
    expect(STAGES.map((s) => s.key)).toContain("cancelled");
    expect(WORKFLOW_STAGES.map((s) => s.key)).not.toContain("cancelled"); // spine + new-task picker stay at nine
    expect(WORKFLOW_STAGES).toHaveLength(9);
  });

  it("is not read as ready/merged/verified", () => {
    expect(confidenceOf(task("T", "cancelled"))).toMatchObject({ label: "Cancelled", state: "gap", pct: 0 });
    expect(timelineSegmentClass(task("T", "cancelled"))).toBe("seg-done"); // closed: never at-risk/overdue styling
    expect(stageChipTone(task("T", "cancelled"))).toBe("muted");
  });
});

describe("dashboard / project / bucket counts", () => {
  it("the dashboard donut and totals skip cancelled work", () => {
    const model = buildInsights(tasks);
    expect(model.total).toBe(2);
    expect(Object.fromEntries(model.byStatus.map((s) => [s.key, s.value]))).toEqual({ todo: 0, doing: 1, done: 1 });
    expect(model.byStatus.reduce((n, s) => n + s.value, 0)).toBe(model.total);
  });

  it("a cancelled task is never overdue", () => {
    expect(isOverdue(task("T", "cancelled", { due: "Jan 01" }), 400)).toBe(false);
  });

  it("project progress and bucket rollups exclude cancelled from done AND from the denominator", () => {
    expect(projectProgress(tasks)).toEqual({ done: 1, doing: 1, total: 2, pct: 50 });
    const [roll] = rollupForProject([{ id: "BKT-A" } as never], tasks);
    expect(roll).toMatchObject({ done: 1, total: 2, pct: 50 });
    expect(roll.tasks).toHaveLength(4); // still listed under the Cancelled filter
  });
});

describe("MCP reads", () => {
  it("mc_get_context compact counts only open work", async () => {
    const ctx = await actionGetContext("compact");
    expect(ctx).toMatchObject({ taskCount: 4, activeCount: 1 });
    expect((ctx as { topTasks: { id: string }[] }).topTasks.map((t) => t.id)).toEqual(["TASK-1"]);
  });

  it("mc_search_tasks stage=cancelled returns cancelled tasks with cancellation and completedAt", async () => {
    const res = await actionSearchTasks({ stage: "cancelled" });
    expect(res.tasks.map((t) => t.id)).toEqual(["TASK-3", "TASK-4"]);
    expect(res.tasks[0]).toMatchObject({ cancellation: { reason: "obsolete" }, completedAt: "2026-10-07T00:00:00.000Z" });
  });
});
