// Import the actual standalone entry point, replacing only its stdio connection
// and network I/O. Drive its registrations through the real SDK.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let client: Client;
let server: McpServer;
const requests: { url: string; body: unknown }[] = [];
const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
  requests.push({ url, body: init.body ? JSON.parse(String(init.body)) : undefined });
  return new Response(JSON.stringify({ data: { accepted: true } }), { status: 200 });
});

beforeAll(async () => {
  vi.stubEnv("PLX_MC_MCP_ENABLED", "1");
  vi.stubEnv("MC_BASE_URL", "http://stdio-test.invalid");
  vi.stubEnv("MC_MCP_API_KEY", "test-key");
  vi.stubEnv("MC_OPERATOR_EMAIL", "vince@petrasoap.com");
  vi.stubEnv("MC_REPO", "petralabx/PLX_MC");
  vi.stubGlobal("fetch", fetchMock);
  const connect = vi.spyOn(McpServer.prototype, "connect").mockResolvedValue(undefined);
  await import("../tools/plx-mc-mcp/index");
  server = connect.mock.contexts[0] as McpServer;
  connect.mockRestore();
  client = new Client({ name: "update-stdio-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
});
afterAll(async () => {
  await client?.close();
  await server?.close();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("actual stdio metadata tool registrations", () => {
  it("lists both tools", async () => {
    const result = await client.listTools();
    expect(result.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(["mc_update_task", "mc_update_tasks"]));
  });
  it("forwards single metadata patches to the normal REST endpoint", async () => {
    const result = await client.callTool({ name: "mc_update_task", arguments: { taskId: "TASK-1", patch: { addLabels: ["lane:codex"] } } });
    expect(result.isError).not.toBe(true);
    expect(requests.at(-1)).toEqual({
      url: "http://stdio-test.invalid/api/cursor/tasks/update",
      body: { taskId: "TASK-1", patch: { addLabels: ["lane:codex"] } },
    });
  });
  it("preserves malformed batch items for server per-item validation", async () => {
    const items = [null, { taskId: "TASK-1", patch: { stage: "verified" } }, { taskId: "TASK-1", patch: { title: "Valid" } }];
    const result = await client.callTool({ name: "mc_update_tasks", arguments: { items } });
    expect(result.isError).not.toBe(true);
    expect(requests.at(-1)).toEqual({
      url: "http://stdio-test.invalid/api/cursor/tasks/update-batch", body: { items },
    });
  });
  it("rejects protected fields at the root and inside the single patch before any fetch", async () => {
    const count = requests.length;
    for (const args of [
      { taskId: "TASK-1", stage: "verified", patch: { title: "No" } },
      { taskId: "TASK-1", patch: { evidence: {}, checkoutId: "dsp_no", title: "No" } },
    ]) {
      const result = await client.callTool({ name: "mc_update_task", arguments: args });
      expect(result.isError).toBe(true);
    }
    expect(requests).toHaveLength(count);
  });
  it("caps batch size at 100 before any fetch", async () => {
    const count = requests.length;
    const result = await client.callTool({ name: "mc_update_tasks", arguments: { items: Array(101).fill(null) } });
    expect(result.isError).toBe(true);
    expect(requests).toHaveLength(count);
  });
});


describe("actual stdio task-search registration", () => {
  it("forwards every additive search parameter to REST", async () => {
    const result = await client.callTool({ name: "mc_search_tasks", arguments: {
      q: "CLOSED (obsolete", bucket: "BKT-PROD", stage: "merged", assignee: "agent:runner", label: "lane:codex",
      limit: 200, cursor: "opaque", searchComments: true, in: ["comments", "notes"], fields: "compact",
    } });
    expect(result.isError).not.toBe(true);
    const url = new URL(requests.at(-1)!.url);
    expect(url.pathname).toBe("/api/cursor/tasks");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      q: "CLOSED (obsolete", bucket: "BKT-PROD", stage: "merged", assignee: "agent:runner", label: "lane:codex",
      limit: "200", cursor: "opaque", searchComments: "true", fields: "compact",
    });
    expect(url.searchParams.getAll("in")).toEqual(["comments", "notes"]);
  });
  it("rejects invalid limits and fields before any network call", async () => {
    const count = requests.length;
    for (const args of [{ limit: 0 }, { limit: 201 }, { limit: 1.5 }, { fields: "invalid" }, { searchComments: "true" }]) {
      expect((await client.callTool({ name: "mc_search_tasks", arguments: args })).isError).toBe(true);
    }
    expect(requests).toHaveLength(count);
  });
});
