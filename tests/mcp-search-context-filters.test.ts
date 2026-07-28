// mc_search_tasks / mc_get_context must honour query/taskIds (not silently
// strip them) and echo the applied filter. Before this, callers that passed
// `query` or `taskIds` got the unfiltered head of the task list with a
// normal-looking response — indistinguishable from a genuine no-match.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/route";
import type { Task } from "@/lib/mc-data";

vi.mock("@/lib/compliance/service", () => ({
  complete: vi.fn(),
  checkout: vi.fn(),
}));

vi.mock("@/lib/compliance/repo", () => ({
  getDispatch: vi.fn(async () => null),
  appendEvent: vi.fn(async () => undefined),
}));

const tasks: Task[] = [
  {
    id: "TASK-791",
    title: "Local preflight aborts at step 12",
    description: "ruff missing",
    stage: "backlog",
    bucket: "BKT-MISSION-CONTROL-OPS",
    priority: "high",
  } as Task,
  {
    id: "TASK-792",
    title: "MCP search ignores query",
    description: "silent filter drop",
    stage: "progress",
    bucket: "BKT-MISSION-CONTROL-OPS",
    priority: "medium",
  } as Task,
  {
    id: "TASK-221",
    title: "WMS integration",
    description: "unrelated",
    stage: "merged",
    bucket: "BKT-WMS",
    priority: "medium",
  } as Task,
];

vi.mock("@/lib/sync", () => ({
  createTask: vi.fn(),
  patchTask: vi.fn(),
  snapshot: vi.fn(async () => ({
    tasks,
    buckets: [
      { id: "BKT-MISSION-CONTROL-OPS", name: "Mission Control / Ops" },
      { id: "BKT-WMS", name: "WMS" },
    ],
    conflicts: [],
    errors: [],
    lastSweep: "now",
  })),
}));

vi.mock("@/lib/sync/repo", () => ({
  getEntity: vi.fn(async () => null),
}));

vi.mock("@/lib/mcp/sync-meta", () => ({
  syncMetaForTask: vi.fn(async () => ({ status: "queued" })),
}));

import {
  actionGetContext,
  actionSearchTasks,
  resolveSearchQueryText,
} from "@/lib/mcp/actions";

describe("resolveSearchQueryText", () => {
  it("accepts q or query alone", () => {
    expect(resolveSearchQueryText({ q: "TASK-791" })).toBe("TASK-791");
    expect(resolveSearchQueryText({ query: "TASK-791" })).toBe("TASK-791");
  });

  it("accepts matching q and query", () => {
    expect(resolveSearchQueryText({ q: "x", query: "x" })).toBe("x");
  });

  it("rejects conflicting q and query", () => {
    expect(() => resolveSearchQueryText({ q: "a", query: "b" })).toThrow(ApiError);
  });
});

describe("actionSearchTasks filter honouring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("filters by query alias and echoes filter", async () => {
    const result = await actionSearchTasks({ query: "TASK-791", limit: 10 });
    expect(result.tasks.map((t) => t.id)).toEqual(["TASK-791"]);
    expect(result.total).toBe(1);
    expect(result.filter).toEqual({ query: "TASK-791", limit: 10 });
  });

  it("filters by q the same way", async () => {
    const result = await actionSearchTasks({ q: "ignores query", limit: 5 });
    expect(result.tasks.map((t) => t.id)).toEqual(["TASK-792"]);
    expect(result.filter.query).toBe("ignores query");
  });

  it("returns empty with applied filter when nothing matches (not the head list)", async () => {
    const result = await actionSearchTasks({ query: "no-such-task-zzzz", limit: 5 });
    expect(result.tasks).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.filter.query).toBe("no-such-task-zzzz");
  });
});

describe("actionGetContext taskIds honouring", () => {
  it("scopes compact topTasks by taskIds and echoes filter", async () => {
    const result = await actionGetContext({
      depth: "compact",
      taskIds: ["TASK-792"],
    });
    expect(result.filter).toEqual({ depth: "compact", taskIds: ["TASK-792"] });
    expect("topTasks" in result).toBe(true);
    if (!("topTasks" in result) || !result.topTasks) throw new Error("expected topTasks");
    expect(result.topTasks.map((t) => t.id)).toEqual(["TASK-792"]);
    // Must not return the unfiltered head (TASK-791 would lead without the filter).
    expect(result.topTasks.some((t) => t.id === "TASK-791")).toBe(false);
  });

  it("scopes full task list by taskIds", async () => {
    const result = await actionGetContext({
      depth: "full",
      taskIds: ["TASK-221", "TASK-791"],
    });
    expect("tasks" in result).toBe(true);
    if (!("tasks" in result) || !result.tasks) throw new Error("expected tasks");
    expect(result.tasks.map((t) => t.id).sort()).toEqual(["TASK-221", "TASK-791"]);
    expect(result.filter.taskIds).toEqual(["TASK-221", "TASK-791"]);
  });
});
