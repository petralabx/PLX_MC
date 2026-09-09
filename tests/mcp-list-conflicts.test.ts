import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listOpenConflicts: vi.fn(),
  resolveConflict: vi.fn(),
}));

vi.mock("@/lib/sync/repo", () => ({
  listOpenConflicts: mocks.listOpenConflicts,
}));

vi.mock("@/lib/sync/engine", () => ({
  resolveConflict: mocks.resolveConflict,
}));

vi.mock("@/lib/permissions/decision-log", () => ({
  recordPermissionDecision: vi.fn(async () => true),
}));

import type { McpIdentity } from "@/lib/mcp/auth";
import {
  LIST_CONFLICTS_DEFAULT_LIMIT,
  LIST_CONFLICTS_MAX_LIMIT,
  actionListConflicts,
  listConflictsSchema,
  resolveListConflictsFilter,
} from "@/lib/mcp/sync-actions";
import { authorize } from "@/lib/permissions";

const mcpIdentity: McpIdentity = {
  operatorEmail: "vince@petrasoap.com",
  runtime: "cursor",
  workerId: "test",
  repo: "petralabx/PLX_MC",
  servicePrincipalId: "sp_mcp_cursor",
  actor: { kind: "service", id: "sp_mcp_cursor", status: "active" },
};

const noReadIdentity: McpIdentity = {
  ...mcpIdentity,
  actor: { kind: "service", id: "sp_unknown_no_grants", status: "active" },
};

const sampleConflicts = [
  {
    id: "cf-task-1401-stage-1710000000001",
    list: "todos",
    entity: "Task",
    entityId: "TASK-1401",
    field: "Stage",
    mcVal: "progress",
    spVal: "review",
    detected: "17:35",
    by: "sync",
    note: "Edited in SharePoint while Mission Control also changed it.",
    entityType: "task" as const,
    mc_val: "progress",
    sp_val: "review",
    detected_at: "2026-09-08T17:35:00.000Z",
  },
  {
    id: "cf-task-1401-title-1710000000002",
    list: "todos",
    entity: "Task",
    entityId: "TASK-1401",
    field: "Title",
    mcVal: "Keep MC",
    spVal: "Keep SP",
    detected: "17:36",
    by: "sync",
    note: "Edited both sides.",
    entityType: "task" as const,
    mc_val: "Keep MC",
    sp_val: "Keep SP",
    detected_at: "2026-09-08T17:36:00.000Z",
  },
  {
    id: "cf-bkt-ops-health-1710000000003",
    list: "roadmap",
    entity: "Bucket",
    entityId: "BKT-OPS",
    field: "Health",
    mcVal: "track",
    spVal: "risk",
    detected: "17:37",
    by: "sync",
    note: "Edited both sides.",
    entityType: "bucket" as const,
    mc_val: "track",
    sp_val: "risk",
    detected_at: "2026-09-08T17:37:00.000Z",
  },
];

beforeEach(() => {
  mocks.listOpenConflicts.mockReset();
  mocks.resolveConflict.mockReset();
  mocks.listOpenConflicts.mockResolvedValue(sampleConflicts);
  mocks.resolveConflict.mockResolvedValue(true);
});

describe("listConflicts schema + filter", () => {
  it("accepts optional entityId / taskId / field / limit", () => {
    expect(listConflictsSchema.parse({})).toEqual({});
    expect(
      listConflictsSchema.parse({
        entityId: "TASK-1401",
        field: "Stage",
        limit: 10,
      })
    ).toEqual({ entityId: "TASK-1401", field: "Stage", limit: 10 });
    expect(listConflictsSchema.parse({ taskId: "TASK-1401" })).toEqual({
      taskId: "TASK-1401",
    });
  });

  it("treats entityId and taskId as aliases and rejects conflicts", () => {
    expect(resolveListConflictsFilter({ taskId: "TASK-1401" })).toEqual({
      entityId: "TASK-1401",
      limit: LIST_CONFLICTS_DEFAULT_LIMIT,
    });
    expect(
      resolveListConflictsFilter({ entityId: "TASK-1401", taskId: "TASK-1401" })
    ).toEqual({ entityId: "TASK-1401", limit: LIST_CONFLICTS_DEFAULT_LIMIT });
    expect(() =>
      resolveListConflictsFilter({ entityId: "TASK-1", taskId: "TASK-2" })
    ).toThrow(/aliases/);
  });

  it("clamps limit to the reviewed range", () => {
    expect(resolveListConflictsFilter({}).limit).toBe(LIST_CONFLICTS_DEFAULT_LIMIT);
    expect(resolveListConflictsFilter({ limit: 0 }).limit).toBe(1);
    expect(resolveListConflictsFilter({ limit: 9999 }).limit).toBe(LIST_CONFLICTS_MAX_LIMIT);
  });
});

describe("actionListConflicts", () => {
  it("authorizes task.read and returns open cf-* rows from listOpenConflicts", async () => {
    const result = await actionListConflicts(mcpIdentity);
    expect(mocks.listOpenConflicts).toHaveBeenCalledOnce();
    expect(result.total).toBe(3);
    expect(result.conflicts).toHaveLength(3);
    expect(result.conflicts[0]).toMatchObject({
      id: "cf-task-1401-stage-1710000000001",
      entityType: "task",
      entityId: "TASK-1401",
      field: "Stage",
      mc_val: "progress",
      sp_val: "review",
      detected_at: "2026-09-08T17:35:00.000Z",
    });
    expect(result.filter).toEqual({ limit: LIST_CONFLICTS_DEFAULT_LIMIT });
  });

  it("filters by taskId / entityId and field without touching resolve", async () => {
    const result = await actionListConflicts(mcpIdentity, {
      taskId: "TASK-1401",
      field: "stage",
    });
    expect(result.total).toBe(1);
    expect(result.conflicts.map((row) => row.id)).toEqual([
      "cf-task-1401-stage-1710000000001",
    ]);
    expect(mocks.resolveConflict).not.toHaveBeenCalled();
  });

  it("honors limit and reports the untruncated total", async () => {
    const result = await actionListConflicts(mcpIdentity, { limit: 1 });
    expect(result.conflicts).toHaveLength(1);
    expect(result.total).toBe(3);
  });

  it("rejects a principal without task.read before querying", async () => {
    expect(
      authorize({
        actor: noReadIdentity.actor,
        capability: "task.read",
        resource: { type: "sync" },
      }).allowed
    ).toBe(false);
    await expect(actionListConflicts(noReadIdentity)).rejects.toMatchObject({
      code: "forbidden",
      status: 403,
    });
    expect(mocks.listOpenConflicts).not.toHaveBeenCalled();
  });

  it("does not resolve and does not call the engine", async () => {
    await actionListConflicts(mcpIdentity, { entityId: "TASK-1401" });
    expect(mocks.resolveConflict).not.toHaveBeenCalled();
  });
});

describe("conflict id format", () => {
  it("matches cf-{entityId.lower}-{field}-{detectedAtMs} from the engine insert", () => {
    const engine = readFileSync(join(process.cwd(), "src/lib/sync/engine.ts"), "utf8");
    expect(engine).toMatch(
      /id:\s*`cf-\$\{row\.id\.toLowerCase\(\)\}-\$\{c\.field\}-\$\{Date\.now\(\)\}`/
    );
    const minted = `cf-${"TASK-1401".toLowerCase()}-stage-${1710000000001}`;
    expect(minted).toBe("cf-task-1401-stage-1710000000001");
    expect(minted).toMatch(/^cf-task-\d+-[a-z0-9_]+-\d+$/);
  });
});

describe("MCP list wiring", () => {
  it("exposes GET /api/cursor/conflicts for the stdio client", () => {
    expect(existsSync(join(process.cwd(), "src/app/api/cursor/conflicts/route.ts"))).toBe(
      true
    );
    const stdio = readFileSync(join(process.cwd(), "tools/plx-mc-mcp/index.ts"), "utf8");
    expect(stdio).toContain("mcFetch(`/conflicts");
    expect(stdio).toContain("mc_list_conflicts");
  });
});
