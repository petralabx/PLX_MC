import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  actionListConflicts: vi.fn(),
  actionResolveConflict: vi.fn(),
  actionResolveConflicts: vi.fn(),
}));

vi.stubEnv("PLX_MC_MCP_ENABLED", "1");
vi.stubEnv("PLX_MC_MCP_API_KEY", "test-mcp-key");
vi.stubEnv("PLX_MC_MCP_AGENT_KEYS", "");
vi.stubEnv("PLX_MC_ALLOWED_USERS", "vince@petrasoap.com");
vi.stubEnv("PLX_MC_PUBLIC_URL", "https://mc.plxcustomer.io");

vi.mock("@/lib/mcp/audit", () => ({
  recordMcpToolCall: vi.fn(async () => "1"),
}));

vi.mock("@/lib/mcp/sync-actions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mcp/sync-actions")>();
  return {
    ...actual,
    actionListConflicts: mocks.actionListConflicts,
    actionResolveConflict: mocks.actionResolveConflict,
    actionResolveConflicts: mocks.actionResolveConflicts,
  };
});

import { GET as listConflicts } from "@/app/api/cursor/conflicts/route";
import { POST as resolveConflict } from "@/app/api/cursor/conflicts/resolve/route";

const ctx = { params: Promise.resolve({} as Record<string, string>) };

function mcpHeaders(): HeadersInit {
  return {
    "content-type": "application/json",
    "x-api-key": "test-mcp-key",
    "x-mc-operator-email": "vince@petrasoap.com",
    "x-mc-repo": "petralabx/PLX_MC",
    "x-mc-runtime": "cursor",
    "x-mc-worker-id": "list-test",
  };
}

function get(query = ""): Request {
  return new Request(`http://localhost/api/cursor/conflicts${query}`, {
    method: "GET",
    headers: mcpHeaders(),
  });
}

function postResolve(body: unknown): Request {
  return new Request("http://localhost/api/cursor/conflicts/resolve", {
    method: "POST",
    headers: mcpHeaders(),
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.actionListConflicts.mockResolvedValue({
    conflicts: [
      {
        id: "cf-task-1401-stage-1710000000001",
        entityType: "task",
        entityId: "TASK-1401",
        field: "Stage",
        mc_val: "progress",
        sp_val: "review",
        detected_at: "2026-09-08T17:35:00.000Z",
      },
    ],
    total: 1,
    filter: { entityId: "TASK-1401", limit: 200 },
  });
  mocks.actionResolveConflict.mockResolvedValue({
    resolved: true,
    conflictId: "cf-1",
    resolution: "keep_mc",
    winner: "mc",
  });
});

describe("cursor conflict list route", () => {
  it("lists open conflicts through MCP auth, not Entra", async () => {
    const response = await listConflicts(get("?taskId=TASK-1401"), ctx);
    expect(response.status).toBe(200);
    expect(mocks.actionListConflicts).toHaveBeenCalledWith(
      expect.objectContaining({
        servicePrincipalId: "sp_mcp_cursor",
        repo: "petralabx/PLX_MC",
      }),
      { entityId: undefined, taskId: "TASK-1401", field: undefined, limit: undefined }
    );
    await expect(response.json()).resolves.toMatchObject({
      data: {
        total: 1,
        conflicts: [{ id: "cf-task-1401-stage-1710000000001", entityId: "TASK-1401" }],
      },
      meta: {
        filter: { entityId: "TASK-1401", limit: 200 },
        audit: { kinds: ["mc_list_conflicts", "mcp.tool.invoked"] },
      },
    });
    expect(mocks.actionResolveConflict).not.toHaveBeenCalled();
  });

  it("forwards field and limit query params", async () => {
    const response = await listConflicts(get("?field=Stage&limit=25"), ctx);
    expect(response.status).toBe(200);
    expect(mocks.actionListConflicts).toHaveBeenCalledWith(
      expect.objectContaining({ servicePrincipalId: "sp_mcp_cursor" }),
      { entityId: undefined, taskId: undefined, field: "Stage", limit: 25 }
    );
  });

  it("leaves resolve on POST /conflicts/resolve with an explicit resolution", async () => {
    const response = await resolveConflict(
      postResolve({ conflictId: "cf-1", resolution: "keep_mc" }),
      ctx
    );
    expect(response.status).toBe(200);
    expect(mocks.actionResolveConflict).toHaveBeenCalled();
    const missing = await resolveConflict(postResolve({ conflictId: "cf-1" }), ctx);
    expect(missing.status).toBe(400);
  });
});
