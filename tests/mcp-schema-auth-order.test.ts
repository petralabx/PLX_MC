import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ assertSchemaReady: vi.fn() }));
vi.mock("@/lib/secrets", () => ({ databaseConfigured: () => true }));
vi.mock("@/lib/mcp/audit", () => ({ recordMcpToolCall: vi.fn() }));
vi.mock("@/lib/mcp/tool-allowlist", () => ({ assertMcpToolAllowed: vi.fn() }));
vi.mock("@/lib/mcp/create-http-server", () => ({
  createPlxMcMcpServer: vi.fn(() => ({ connect: vi.fn() })),
}));
vi.mock("@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js", () => ({
  WebStandardStreamableHTTPServerTransport: class {
    handleRequest() { return Response.json({ ready: true }); }
  },
}));

import { assertSchemaReady } from "@/lib/db";
import { cursorRoute } from "@/lib/mcp/route";
import { assertMcpToolAllowed } from "@/lib/mcp/tool-allowlist";
import { createPlxMcMcpServer } from "@/lib/mcp/create-http-server";
import { GET, POST, DELETE } from "@/app/api/cursor/mcp/route";
import { compareMigrations, SchemaMismatchError } from "../scripts/lib/schema-version.mjs";

const missing = "032_required.sql";
const schemaError = new SchemaMismatchError(compareMigrations([missing], []));
const handler = vi.fn(async () => ({ data: { ready: true } }));
const ctx = { params: Promise.resolve({}) };
const cursor = cursorRoute("mc_self_check", handler);
const entries = [
  { name: "cursor REST", method: "GET", run: (req: Request) => cursor(req, ctx) },
  { name: "HTTP MCP GET", method: "GET", run: GET },
  { name: "HTTP MCP POST", method: "POST", run: POST },
  { name: "HTTP MCP DELETE", method: "DELETE", run: DELETE },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("PLX_MC_MCP_ENABLED", "1");
  vi.stubEnv("PLX_MC_MCP_API_KEY", "offline-test-key");
  vi.stubEnv("PLX_MC_MCP_AGENT_KEYS", "");
  vi.stubEnv("PLX_MC_MCP_SHARED_KEY_ENABLED", "1");
  vi.stubEnv("PLX_MC_ALLOWED_USERS", "vince@petrasoap.com");
  // Exercise real API-key/kill-switch verification without any DB lookup.
  vi.stubEnv("PLX_MC_PERMISSIONS_ENFORCEMENT_ENABLED", "0");
  vi.mocked(assertSchemaReady).mockRejectedValue(schemaError);
});

afterEach(() => vi.unstubAllEnvs());

describe.each(entries)("$name schema/auth ordering", ({ name, method, run }) => {
  function request(key?: string) {
    return new Request("http://localhost/api/cursor/mcp", {
      method,
      headers: {
        accept: "application/json",
        "x-mc-operator-email": "vince@petrasoap.com",
        "x-mc-repo": "petralabx/PLX_MC",
        ...(key === undefined ? {} : { "x-api-key": key }),
      },
    });
  }

  function expectNoSchemaOrHandler() {
    expect(assertSchemaReady).not.toHaveBeenCalled();
    expect(assertMcpToolAllowed).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
    expect(createPlxMcMcpServer).not.toHaveBeenCalled();
  }

  it.each([undefined, "invalid-key"])("rejects missing/invalid key (%s) before schema access", async key => {
    const response = await run(request(key));
    expect(response.status).toBe(401);
    const body = await response.text();
    expect(JSON.parse(body)).toMatchObject({ error: { code: "invalid_api_key" } });
    expect(body).not.toContain(missing);
    expectNoSchemaOrHandler();
  });

  it("honors the kill switch before schema access", async () => {
    vi.stubEnv("PLX_MC_MCP_ENABLED", "0");
    const response = await run(request("offline-test-key"));
    expect(response.status).toBe(503);
    const body = await response.text();
    expect(JSON.parse(body)).toMatchObject({ error: { code: "mcp_disabled" } });
    expect(body).not.toContain(missing);
    expectNoSchemaOrHandler();
  });

  it("returns schema_behind to authenticated callers before allowlist/handler", async () => {
    const response = await run(request("offline-test-key"));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: "schema_behind", schema: { missing: [missing] } } });
    expect(assertSchemaReady).toHaveBeenCalledOnce();
    expect(assertMcpToolAllowed).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
    expect(createPlxMcMcpServer).not.toHaveBeenCalled();
  });

  it("runs the handler after authenticated schema success", async () => {
    vi.mocked(assertSchemaReady).mockResolvedValue(undefined);
    const response = await run(request("offline-test-key"));
    expect(response.status).toBe(200);
    expect(assertSchemaReady).toHaveBeenCalledOnce();
    const next = name === "cursor REST" ? assertMcpToolAllowed : createPlxMcMcpServer;
    expect(next).toHaveBeenCalledOnce();
    expect(vi.mocked(assertSchemaReady).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(next).mock.invocationCallOrder[0]);
    if (name === "cursor REST") expect(handler).toHaveBeenCalledOnce();
  });
});
