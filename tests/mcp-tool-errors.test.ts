// Structured MCP tool errors: a tool that fails with a known ApiError returns
// isError + a JSON text payload { error: { code, message, hint? } } so agents can
// branch on the code instead of parsing prose. Driven through POST
// /api/cursor/mcp (JSON-RPC tools/call) — the same path a remote agent uses.

import { describe, expect, it, vi } from "vitest";

vi.stubEnv("PLX_MC_MCP_ENABLED", "1");
vi.stubEnv("PLX_MC_MCP_API_KEY", "test-mcp-key");
vi.stubEnv("PLX_MC_MCP_AGENT_KEYS", "");
vi.stubEnv("PLX_MC_ALLOWED_USERS", "vince@petrasoap.com");
vi.stubEnv("PLX_MC_ROUTING_SUGGEST_ENABLED", "0");

vi.mock("@/lib/permissions/decision-log", () => ({
  recordPermissionDecision: vi.fn(async () => true),
}));

vi.mock("@/lib/mcp/audit", () => ({
  recordMcpToolCall: vi.fn(async () => "1"),
}));

import { POST as mcpPost } from "@/app/api/cursor/mcp/route";
import { ApiError } from "@/lib/api/route";
import { MCP_CHECKOUT_REPO_ALLOWLIST } from "@/lib/mcp/checkout-repo";
import { mcpToolErrorResult } from "@/lib/mcp/envelope";

async function callTool(name: string, args: Record<string, unknown>) {
  const res = await mcpPost(
    new Request("http://localhost/api/cursor/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "x-api-key": "test-mcp-key",
        "x-mc-operator-email": "vince@petrasoap.com",
        "x-mc-repo": "petralabx/PLX_MC",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    })
  );
  expect(res.status).toBe(200);
  const json = (await res.json()) as {
    result: { content: { type: string; text: string }[]; isError?: boolean };
  };
  return json.result;
}

describe("structured MCP tool errors", () => {
  it("surfaces repo_not_allowlisted as a JSON error payload with a hint", async () => {
    const result = await callTool("mc_checkout_task", {
      taskId: "TASK-1",
      repo: "petralabx/not-on-the-list",
    });
    expect(result.isError).toBe(true);
    const body = JSON.parse(result.content[0].text);
    expect(body).toEqual({
      error: {
        code: "repo_not_allowlisted",
        message: "repo 'petralabx/not-on-the-list' is not on the MCP checkout allowlist.",
        hint: expect.stringContaining(MCP_CHECKOUT_REPO_ALLOWLIST[0]),
      },
    });
  });

  it("applies to tools registered by split modules (routing suggest)", async () => {
    const result = await callTool("mc_suggest_work", { title: "x" });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      error: { code: "routing_suggest_disabled" },
    });
  });

  it("omits hint for codes without one", () => {
    const result = mcpToolErrorResult(new ApiError("not_found", "unknown task TASK-9", 404));
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text)).toEqual({
      error: { code: "not_found", message: "unknown task TASK-9" },
    });
  });

  it("maps an unexpected throw to internal without leaking its message", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = mcpToolErrorResult(new Error("connect ECONNREFUSED 10.0.0.5:5432"));
    expect(JSON.parse(result.content[0].text)).toEqual({
      error: { code: "internal", message: "Internal error." },
    });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
