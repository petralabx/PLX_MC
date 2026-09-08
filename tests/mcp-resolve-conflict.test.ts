import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveConflict: vi.fn(),
}));

vi.mock("@/lib/sync/engine", () => ({
  resolveConflict: mocks.resolveConflict,
}));

vi.mock("@/lib/permissions/decision-log", () => ({
  recordPermissionDecision: vi.fn(async () => true),
}));

import type { McpIdentity } from "@/lib/mcp/auth";
import {
  actionResolveConflict,
  actionResolveConflicts,
  conflictResolutionSchema,
  mapConflictResolution,
  resolveConflictSchema,
  resolveConflictsSchema,
} from "@/lib/mcp/sync-actions";
import {
  MCP_AGENT_SERVICE_PRINCIPAL_IDS,
  authorize,
  capabilitiesForServicePrincipal,
} from "@/lib/permissions";

const mcpIdentity: McpIdentity = {
  operatorEmail: "vince@petrasoap.com",
  runtime: "cursor",
  workerId: "test",
  repo: "petralabx/PLX_MC",
  servicePrincipalId: "sp_mcp_cursor",
  actor: { kind: "service", id: "sp_mcp_cursor", status: "active" },
};

const inboundIdentity: McpIdentity = {
  ...mcpIdentity,
  servicePrincipalId: "sp_mcp_cursor",
  actor: { kind: "service", id: "sp_sync_inbound", status: "active" },
};

beforeEach(() => {
  mocks.resolveConflict.mockReset();
  mocks.resolveConflict.mockResolvedValue(true);
});

describe("conflict resolution schema", () => {
  it("accepts keep_mc and keep_sp only", () => {
    expect(conflictResolutionSchema.parse("keep_mc")).toBe("keep_mc");
    expect(conflictResolutionSchema.parse("keep_sp")).toBe("keep_sp");
    expect(() => conflictResolutionSchema.parse("mc")).toThrow();
    expect(() => conflictResolutionSchema.parse("sp")).toThrow();
    expect(() => conflictResolutionSchema.parse("")).toThrow();
  });

  it("requires an explicit resolution — never defaults to keep_sp", () => {
    expect(resolveConflictSchema.safeParse({ conflictId: "cf-1" }).success).toBe(false);
    expect(resolveConflictsSchema.safeParse({ conflictIds: ["cf-1"] }).success).toBe(false);
    expect(resolveConflictSchema.parse({ conflictId: "cf-1", resolution: "keep_mc" })).toEqual({
      conflictId: "cf-1",
      resolution: "keep_mc",
    });
  });

  it("maps keep_mc|keep_sp onto the engine winner enum", () => {
    expect(mapConflictResolution("keep_mc")).toBe("mc");
    expect(mapConflictResolution("keep_sp")).toBe("sp");
  });
});

describe("MCP sync.mutate grant", () => {
  it("grants sync.mutate to every reviewed MCP agent principal", () => {
    for (const principalId of MCP_AGENT_SERVICE_PRINCIPAL_IDS) {
      expect(capabilitiesForServicePrincipal(principalId)).toEqual(
        expect.arrayContaining(["sync.mutate"])
      );
      expect(
        authorize({
          actor: { kind: "service", id: principalId, status: "active" },
          capability: "sync.mutate",
          resource: { type: "sync" },
        }).allowed
      ).toBe(true);
    }
  });

  it("still denies sync.mutate for the inbound sync principal", () => {
    expect(
      authorize({
        actor: { kind: "service", id: "sp_sync_inbound", status: "active" },
        capability: "sync.mutate",
        resource: { type: "sync" },
      }).allowed
    ).toBe(false);
  });
});

describe("actionResolveConflict", () => {
  it("authorizes the MCP principal and calls the existing engine path", async () => {
    const result = await actionResolveConflict(mcpIdentity, {
      conflictId: "cf-stage-lag",
      resolution: "keep_mc",
    });
    expect(mocks.resolveConflict).toHaveBeenCalledWith("cf-stage-lag", "mc", "sp_mcp_cursor");
    expect(result).toEqual({
      resolved: true,
      conflictId: "cf-stage-lag",
      resolution: "keep_mc",
      winner: "mc",
    });
  });

  it("passes keep_sp through only when the caller names it", async () => {
    await actionResolveConflict(mcpIdentity, {
      conflictId: "cf-2",
      resolution: "keep_sp",
    });
    expect(mocks.resolveConflict).toHaveBeenCalledWith("cf-2", "sp", "sp_mcp_cursor");
  });

  it("rejects a principal without sync.mutate before touching the engine", async () => {
    await expect(
      actionResolveConflict(inboundIdentity, {
        conflictId: "cf-1",
        resolution: "keep_mc",
      })
    ).rejects.toMatchObject({ code: "forbidden", status: 403 });
    expect(mocks.resolveConflict).not.toHaveBeenCalled();
  });

  it("returns not_found when the engine cannot resolve the row", async () => {
    mocks.resolveConflict.mockResolvedValueOnce(false);
    await expect(
      actionResolveConflict(mcpIdentity, {
        conflictId: "cf-missing",
        resolution: "keep_mc",
      })
    ).rejects.toMatchObject({ code: "not_found", status: 404 });
  });
});

describe("actionResolveConflicts", () => {
  it("resolves a batch and reports per-id leftovers", async () => {
    mocks.resolveConflict.mockImplementation(async (id: string) => id !== "cf-gone");
    const result = await actionResolveConflicts(mcpIdentity, {
      conflictIds: ["cf-a", "cf-gone", "cf-b"],
      resolution: "keep_mc",
    });
    expect(mocks.resolveConflict).toHaveBeenCalledTimes(3);
    expect(result.resolvedCount).toBe(2);
    expect(result.winner).toBe("mc");
    expect(result.results).toEqual([
      { conflictId: "cf-a", resolved: true },
      {
        conflictId: "cf-gone",
        resolved: false,
        error: "unknown or already-resolved conflict cf-gone",
      },
      { conflictId: "cf-b", resolved: true },
    ]);
  });
});

describe("MCP + console wiring", () => {
  const httpMcpSource = readFileSync(
    join(process.cwd(), "src/lib/mcp/create-http-server.ts"),
    "utf8"
  );
  const httpToolSource = readFileSync(join(process.cwd(), "src/lib/mcp/sync-actions.ts"), "utf8");
  const stdioMcpSource = readFileSync(join(process.cwd(), "tools/plx-mc-mcp/index.ts"), "utf8");
  const consoleRoute = readFileSync(
    join(process.cwd(), "src/app/api/sync/conflicts/[id]/resolve/route.ts"),
    "utf8"
  );

  it("registers mc_resolve_conflict and mc_resolve_conflicts on both transports", () => {
    expect(httpMcpSource).toContain("registerSyncConflictTools");
    for (const tool of ["mc_resolve_conflict", "mc_resolve_conflicts"]) {
      expect(httpToolSource).toContain(`"${tool}"`);
      expect(stdioMcpSource).toContain(`"${tool}"`);
    }
    expect(httpToolSource).toContain("keep_mc");
    expect(httpToolSource).toContain("keep_sp");
    expect(stdioMcpSource).toContain("keep_mc");
    expect(stdioMcpSource).toContain("keep_sp");
  });

  it("exposes an authenticated cursor REST route for the stdio client", () => {
    expect(existsSync(join(process.cwd(), "src/app/api/cursor/conflicts/resolve/route.ts"))).toBe(
      true
    );
  });

  it("leaves the Entra console resolve route on requireSyncMutateActor", () => {
    expect(consoleRoute).toContain("requireSyncMutateActor");
    expect(consoleRoute).toContain('z.enum(["mc", "sp"])');
    expect(consoleRoute).not.toContain("verifyMcpRequest");
    expect(consoleRoute).not.toContain("keep_mc");
  });
});
