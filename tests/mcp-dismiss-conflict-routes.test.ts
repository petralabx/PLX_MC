import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  actionDismissConflict: vi.fn(),
  actionDismissConflicts: vi.fn(),
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
    actionDismissConflict: mocks.actionDismissConflict,
    actionDismissConflicts: mocks.actionDismissConflicts,
  };
});

import { POST as dismissConflict } from "@/app/api/cursor/conflicts/dismiss/route";

const ctx = { params: Promise.resolve({} as Record<string, string>) };

function post(body: unknown): Request {
  return new Request("http://localhost/api/cursor/conflicts/dismiss", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": "test-mcp-key",
      "x-mc-operator-email": "vince@petrasoap.com",
      "x-mc-repo": "petralabx/PLX_MC",
      "x-mc-runtime": "cursor",
      "x-mc-worker-id": "dismiss-test",
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.actionDismissConflict.mockResolvedValue({
    dismissed: true,
    conflictId: "cf-1",
  });
  mocks.actionDismissConflicts.mockResolvedValue({
    results: [{ conflictId: "cf-1", dismissed: true }],
    dismissedCount: 1,
  });
});

describe("cursor conflict dismiss route", () => {
  it("dismisses one conflict through MCP auth, not Entra", async () => {
    const response = await dismissConflict(
      post({ conflictId: "cf-1" }),
      ctx
    );
    expect(response.status).toBe(200);
    expect(mocks.actionDismissConflict).toHaveBeenCalledWith(
      expect.objectContaining({
        servicePrincipalId: "sp_mcp_cursor",
        repo: "petralabx/PLX_MC",
      }),
      { conflictId: "cf-1" }
    );
    await expect(response.json()).resolves.toMatchObject({
      data: { dismissed: true, conflictId: "cf-1" },
      meta: { audit: { kinds: ["mc_dismiss_conflict", "mcp.tool.invoked"] } },
    });
  });

  it("dismisses a batch when conflictIds is supplied", async () => {
    const response = await dismissConflict(
      post({ conflictIds: ["cf-1", "cf-2"], reason: "obsolete" }),
      ctx
    );
    expect(response.status).toBe(200);
    expect(mocks.actionDismissConflicts).toHaveBeenCalledWith(
      expect.objectContaining({ servicePrincipalId: "sp_mcp_cursor" }),
      { conflictIds: ["cf-1", "cf-2"], reason: "obsolete" }
    );
    expect(mocks.actionDismissConflict).not.toHaveBeenCalled();
  });

  it("rejects an empty id before calling an action", async () => {
    const response = await dismissConflict(post({ conflictId: "" }), ctx);
    expect(response.status).toBe(400);
    expect(mocks.actionDismissConflict).not.toHaveBeenCalled();
    expect(mocks.actionDismissConflicts).not.toHaveBeenCalled();
  });

  it("rejects winner selection on a dismissal", async () => {
    const response = await dismissConflict(post({ conflictId: "cf-1", resolution: "mc" }), ctx);
    expect(response.status).toBe(400);
    expect(mocks.actionDismissConflict).not.toHaveBeenCalled();
  });
});
