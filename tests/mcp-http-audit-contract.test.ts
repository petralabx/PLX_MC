// Remote HTTP MCP server contracts (review 2026-09-25):
// 1. every tool call is audited (mcp.tool.invoked), not only the REST wrapper's;
// 2. mc_complete_task requires non-empty verificationCommands AND rollback on
//    every transport, matching the pipeline contract.
// The real server is driven through an in-memory MCP client; actions are mocked.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
  audit: [] as { tool: string; ok: boolean; taskId?: string | null; checkoutId?: string | null; error?: string | null }[],
  completes: 0,
}));

vi.mock("@/lib/mcp/audit", () => ({
  recordMcpToolCall: vi.fn(async (input: (typeof calls.audit)[number]) => {
    calls.audit.push(input);
    return "1";
  }),
}));

vi.mock("@/lib/mcp/actions", async (importOriginal) => {
  const { ApiError } = await import("@/lib/api/route");
  return {
    ...(await importOriginal<typeof import("@/lib/mcp/actions")>()),
    actionSelfCheck: vi.fn(async () => ({ ok: true })),
    actionCheckout: vi.fn(async () => {
      throw new ApiError("repo_not_allowlisted", "Repo is not on the Hub allowlist.", 403);
    }),
    actionComplete: vi.fn(async () => {
      calls.completes += 1;
      return { taskId: "TASK-7", checkoutId: "dsp_ok", evidence: {}, sync: {} };
    }),
  };
});

vi.mock("@/lib/mcp/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/mcp/auth")>()),
  verifyMcpRequest: vi.fn(async () => identity),
}));

import { POST as completeRoute } from "@/app/api/cursor/complete/route";
import type { McpIdentity } from "@/lib/mcp/auth";
import { createPlxMcMcpServer } from "@/lib/mcp/create-http-server";

const identity: McpIdentity = {
  operatorEmail: "vince@example.com",
  runtime: "claude-code",
  workerId: "test",
  repo: "petralabx/PLX_MC",
  servicePrincipalId: "sp_mcp_claude_code",
  actor: { kind: "service", id: "sp_mcp_claude_code", status: "active" },
} as McpIdentity;

async function connect(): Promise<Client> {
  const server = createPlxMcMcpServer(identity);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientTransport);
  return client;
}

const validComplete = {
  checkoutId: "dsp_ok",
  summary: "did the thing",
  verificationCommands: ["npx vitest run"],
  rollback: "git revert abc123",
};

beforeEach(() => {
  calls.audit.length = 0;
  calls.completes = 0;
});

describe("HTTP MCP audit trail", () => {
  it("records mcp.tool.invoked for a successful tool call", async () => {
    const client = await connect();
    await client.callTool({ name: "mc_self_check", arguments: {} });
    expect(calls.audit).toEqual([expect.objectContaining({ tool: "mc_self_check", ok: true })]);
  });

  it("records the task and checkout ids a tool returns", async () => {
    const client = await connect();
    await client.callTool({ name: "mc_complete_task", arguments: validComplete });
    expect(calls.audit).toEqual([
      expect.objectContaining({ tool: "mc_complete_task", ok: true, taskId: "TASK-7", checkoutId: "dsp_ok" }),
    ]);
  });

  it("records a failed tool call with its error", async () => {
    const client = await connect();
    const res = await client.callTool({ name: "mc_checkout_task", arguments: { taskId: "TASK-1" } });
    expect(res.isError).toBe(true);
    expect(calls.audit).toEqual([
      expect.objectContaining({ tool: "mc_checkout_task", ok: false, error: "Repo is not on the Hub allowlist." }),
    ]);
  });
});

describe("mc_complete_task contract", () => {
  const invalid: [string, Record<string, unknown>][] = [
    ["missing verificationCommands", { ...validComplete, verificationCommands: undefined }],
    ["empty verificationCommands", { ...validComplete, verificationCommands: [] }],
    ["blank verification command", { ...validComplete, verificationCommands: ["  "] }],
    ["missing rollback", { ...validComplete, rollback: undefined }],
    ["blank rollback", { ...validComplete, rollback: "   " }],
  ];

  it.each(invalid)("HTTP MCP rejects %s", async (_label, args) => {
    const client = await connect();
    const res = await client.callTool({ name: "mc_complete_task", arguments: args });
    expect(res.isError).toBe(true);
    expect(calls.completes).toBe(0);
  });

  it.each(invalid)("REST /api/cursor/complete rejects %s", async (_label, body) => {
    const res = await completeRoute(
      new Request("http://localhost/api/cursor/complete", { method: "POST", body: JSON.stringify(body) }),
      { params: Promise.resolve({}) }
    );
    expect(res.status).toBe(400);
    expect(calls.completes).toBe(0);
  });

  it("accepts a complete bundle on both transports", async () => {
    const client = await connect();
    const res = await client.callTool({ name: "mc_complete_task", arguments: validComplete });
    expect(res.isError).toBeFalsy();
    const rest = await completeRoute(
      new Request("http://localhost/api/cursor/complete", { method: "POST", body: JSON.stringify(validComplete) }),
      { params: Promise.resolve({}) }
    );
    expect(rest.status).toBe(200);
    expect(calls.completes).toBe(2);
  });
});
