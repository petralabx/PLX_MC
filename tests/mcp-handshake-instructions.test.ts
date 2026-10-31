// TASK-4348: both MCP servers send the governance contract's handshake as their
// instructions, filled in with the session's repo from the registry. Agents get
// the current steps at session start, so no copy of them can go stale.
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";

import type { McpIdentity } from "@/lib/mcp/auth";
import { createPlxMcMcpServer } from "@/lib/mcp/create-http-server";
import { HANDSHAKE_REPOS, HANDSHAKE_STEPS, renderHandshake } from "@/lib/mcp/handshake.generated";
// The stdio wrapper ships its own copy; the generator writes both from one contract.
import * as stdioCopy from "../tools/plx-mc-mcp/lib/handshake.generated.mjs";

const registry = JSON.parse(readFileSync("config/tracked-repos-registry.json", "utf8")) as {
  repos: { repo: string; status: string; default_bucket: string; integration_branch: string | null }[];
};
const activeRepos = registry.repos.filter((r) => r.status === "active");

function identityFor(repo: string): McpIdentity {
  return {
    operatorEmail: "vince@example.com",
    runtime: "claude-code",
    workerId: "test",
    repo,
    servicePrincipalId: "sp_mcp_claude_code",
    actor: { kind: "service", id: "sp_mcp_claude_code", status: "active" },
  } as McpIdentity;
}

async function instructionsFor(repo: string): Promise<string> {
  const server = createPlxMcMcpServer(identityFor(repo));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientTransport);
  const text = client.getInstructions() ?? "";
  await client.close();
  return text;
}

describe("MCP server instructions carry the contract's handshake", () => {
  it("sends the HTTP session's repo, its default bucket and integration branch", async () => {
    const text = await instructionsFor("petralabx/plx-customer-portal");
    expect(text).toContain(renderHandshake("petralabx/plx-customer-portal"));
    expect(text).toContain("Mission Control handshake for petralabx/plx-customer-portal");
    expect(text).toContain("mc_create_task in BKT-PROD");
    expect(text).toContain("with a merge commit into `staging`");
    expect(text).toContain(`${HANDSHAKE_STEPS.length}. `);
  });

  it("fills every placeholder for every active registry repo", () => {
    expect(Object.keys(HANDSHAKE_REPOS).sort()).toEqual(activeRepos.map((r) => r.repo).sort());
    for (const r of activeRepos) {
      const text = renderHandshake(r.repo);
      expect(text).not.toMatch(/\{[a-z_]+\}/);
      expect(text).toContain(`mc_create_task in ${r.default_bucket}`);
      expect(text).toContain(`into \`${r.integration_branch ?? "main"}\``);
    }
  });

  it("matches the registry's spelling whatever case the client sends", () => {
    expect(renderHandshake("PETRALABX/plx_mc")).toBe(renderHandshake("petralabx/PLX_MC"));
  });

  it("still gives complete steps for a repo the registry does not track", () => {
    const text = renderHandshake("petralabx/internal-seller-api");
    expect(text).toContain("Mission Control handshake for petralabx/internal-seller-api");
    expect(text).toContain("the registry default bucket");
    expect(text).not.toMatch(/\{[a-z_]+\}/);
    expect(renderHandshake("")).toContain("owner/name of the repo under edit");
  });

  it("renders the same text in the stdio wrapper's copy", () => {
    for (const repo of [...activeRepos.map((r) => r.repo), "petralabx/unknown", ""]) {
      expect(stdioCopy.renderHandshake(repo)).toBe(renderHandshake(repo));
    }
  });
});
