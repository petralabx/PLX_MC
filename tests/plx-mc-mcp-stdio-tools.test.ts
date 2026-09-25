// Stdio PLX-MC client parity for wave 4: the same tool names as the HTTP MCP
// server, proxied to the cursor REST routes, and structured tool errors that
// keep the REST error code. The error envelope is exercised through a real SDK
// McpServer + Client pair over an in-memory transport (the path a stdio agent
// takes); tools/plx-mc-mcp/index.ts itself connects stdio on import, so its
// registrations are checked at source level like the other parity tests.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  McRestError,
  installToolErrorEnvelope,
  restErrorFromResponse,
} from "../tools/plx-mc-mcp/lib/tool-errors.mjs";

const stdioSource = readFileSync(join(process.cwd(), "tools/plx-mc-mcp/index.ts"), "utf8");

describe("stdio wave 4 tool parity", () => {
  it("registers every wave 4 tool against its cursor REST route", () => {
    const routes: Record<string, string> = {
      mc_get_task: "`/tasks/${encodeURIComponent(id)}`",
      mc_list_checkouts: "`/checkouts",
      mc_search_knowledge: "`/knowledge/search?",
      mc_verify_pr: "`/verify?",
      mc_request_approval: '"/request-approval"',
    };
    for (const [tool, path] of Object.entries(routes)) {
      expect(stdioSource).toContain(`"${tool}"`);
      expect(stdioSource).toContain(path);
    }
  });

  it("installs the error envelope and keeps REST error codes", () => {
    expect(stdioSource).toContain("installToolErrorEnvelope(server);");
    expect(stdioSource).toContain("throw restErrorFromResponse(res.status, json);");
  });
});

describe("restErrorFromResponse", () => {
  it("keeps the cursor REST error code and message", () => {
    const err = restErrorFromResponse(403, {
      error: { code: "repo_not_allowlisted", message: "repo 'x/y' is not on the MCP checkout allowlist." },
    });
    expect(err).toBeInstanceOf(McRestError);
    expect(err).toMatchObject({ code: "repo_not_allowlisted", status: 403 });
  });

  it("falls back to http_<status> for a non-envelope body", () => {
    expect(restErrorFromResponse(502, { raw: "<html>bad gateway</html>" })).toMatchObject({
      code: "http_502",
      message: "HTTP 502",
    });
  });
});

describe("installToolErrorEnvelope over MCP", () => {
  async function connect(register: (server: McpServer) => void) {
    const server = installToolErrorEnvelope(new McpServer({ name: "t", version: "0" }));
    register(server);
    const client = new Client({ name: "c", version: "0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    return client;
  }

  it("returns isError + { error: { code, message } } for a REST failure", async () => {
    const client = await connect((server) =>
      server.tool("mc_checkout_task", { taskId: z.string() }, async () => {
        throw new McRestError("repo_not_allowlisted", "not on the allowlist", 403);
      })
    );
    const result = await client.callTool({ name: "mc_checkout_task", arguments: { taskId: "T" } });
    expect(result.isError).toBe(true);
    const [content] = result.content as { type: string; text: string }[];
    expect(JSON.parse(content.text)).toEqual({
      error: { code: "repo_not_allowlisted", message: "not on the allowlist" },
    });
  });

  it("labels local failures (config, timeouts) as client_error", async () => {
    const client = await connect((server) =>
      server.tool("mc_self_check", async () => {
        throw new Error("MC_MCP_API_KEY is not set");
      })
    );
    const result = await client.callTool({ name: "mc_self_check", arguments: {} });
    const [content] = result.content as { type: string; text: string }[];
    expect(JSON.parse(content.text)).toEqual({
      error: { code: "client_error", message: "MC_MCP_API_KEY is not set" },
    });
  });
});
