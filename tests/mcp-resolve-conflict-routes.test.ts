import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
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
    actionResolveConflict: mocks.actionResolveConflict,
    actionResolveConflicts: mocks.actionResolveConflicts,
  };
});

import { POST as resolveConflict } from "@/app/api/cursor/conflicts/resolve/route";

const ctx = { params: Promise.resolve({} as Record<string, string>) };

function post(body: unknown): Request {
  return new Request("http://localhost/api/cursor/conflicts/resolve", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": "test-mcp-key",
      "x-mc-operator-email": "vince@petrasoap.com",
      "x-mc-repo": "petralabx/PLX_MC",
      "x-mc-runtime": "cursor",
      "x-mc-worker-id": "resolve-test",
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.actionResolveConflict.mockResolvedValue({
    resolved: true,
    conflictId: "cf-1",
    resolution: "keep_mc",
    winner: "mc",
  });
  mocks.actionResolveConflicts.mockResolvedValue({
    resolution: "keep_mc",
    winner: "mc",
    results: [{ conflictId: "cf-1", resolved: true }],
    resolvedCount: 1,
  });
});

describe("cursor conflict resolve route", () => {
  it("resolves one conflict through MCP auth, not Entra", async () => {
    const response = await resolveConflict(
      post({ conflictId: "cf-1", resolution: "keep_mc" }),
      ctx
    );
    expect(response.status).toBe(200);
    expect(mocks.actionResolveConflict).toHaveBeenCalledWith(
      expect.objectContaining({
        servicePrincipalId: "sp_mcp_cursor",
        repo: "petralabx/PLX_MC",
      }),
      { conflictId: "cf-1", resolution: "keep_mc" }
    );
    await expect(response.json()).resolves.toMatchObject({
      data: { resolved: true, conflictId: "cf-1", resolution: "keep_mc" },
      meta: { audit: { kinds: ["mc_resolve_conflict", "mcp.tool.invoked"] } },
    });
  });

  it("resolves a batch when conflictIds is supplied", async () => {
    const response = await resolveConflict(
      post({ conflictIds: ["cf-1", "cf-2"], resolution: "keep_sp" }),
      ctx
    );
    expect(response.status).toBe(200);
    expect(mocks.actionResolveConflicts).toHaveBeenCalledWith(
      expect.objectContaining({ servicePrincipalId: "sp_mcp_cursor" }),
      { conflictIds: ["cf-1", "cf-2"], resolution: "keep_sp" }
    );
    expect(mocks.actionResolveConflict).not.toHaveBeenCalled();
  });

  it("rejects a missing resolution before calling an action", async () => {
    const response = await resolveConflict(post({ conflictId: "cf-1" }), ctx);
    expect(response.status).toBe(400);
    expect(mocks.actionResolveConflict).not.toHaveBeenCalled();
    expect(mocks.actionResolveConflicts).not.toHaveBeenCalled();
  });

  it("rejects engine winner tokens that are not the MCP enum", async () => {
    const response = await resolveConflict(post({ conflictId: "cf-1", resolution: "mc" }), ctx);
    expect(response.status).toBe(400);
    expect(mocks.actionResolveConflict).not.toHaveBeenCalled();
  });
});
