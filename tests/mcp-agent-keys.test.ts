// TASK-619 — per-agent MCP credentials: per-agent keys resolve per-agent
// durable principals; the legacy shared key stays behind a kill switch.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/route";
import {
  mcpAgentKeyRegistry,
  resolveMcpPrincipalIdFromKey,
  sharedMcpKeyEnabled,
  verifyMcpRequest,
} from "@/lib/mcp/auth";

function req(headers: Record<string, string>): Request {
  return new Request("http://localhost/api/cursor/self-check", { headers });
}

const OPERATOR_HEADERS = {
  "x-mc-operator-email": "vince@petrasoap.com",
  "x-mc-repo": "petralabx/PLX_MC",
  "x-mc-runtime": "claude-code",
  "x-mc-worker-id": "w1",
};

beforeEach(() => {
  vi.stubEnv("PLX_MC_MCP_ENABLED", "1");
  vi.stubEnv("PLX_MC_ALLOWED_USERS", "vince@petrasoap.com");
  vi.stubEnv(
    "PLX_MC_MCP_AGENT_KEYS",
    JSON.stringify({
      sp_mcp_claude_code: "claude-key",
      sp_mcp_codex: "codex-key",
      sp_not_in_registry: "rogue-key",
    })
  );
  vi.stubEnv("PLX_MC_MCP_API_KEY", "shared-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("mcpAgentKeyRegistry", () => {
  it("parses configured keys and drops ids outside the reviewed registry", () => {
    const registry = mcpAgentKeyRegistry();
    expect(registry.get("sp_mcp_claude_code")).toBe("claude-key");
    expect(registry.get("sp_mcp_codex")).toBe("codex-key");
    expect([...registry.keys()]).not.toContain("sp_not_in_registry");
  });

  it("fails closed to empty on malformed JSON", () => {
    vi.stubEnv("PLX_MC_MCP_AGENT_KEYS", "{not json");
    expect(mcpAgentKeyRegistry().size).toBe(0);
  });
});

describe("resolveMcpPrincipalIdFromKey", () => {
  it("maps each per-agent key to its own principal", () => {
    expect(resolveMcpPrincipalIdFromKey("claude-key")).toBe("sp_mcp_claude_code");
    expect(resolveMcpPrincipalIdFromKey("codex-key")).toBe("sp_mcp_codex");
  });

  it("maps the legacy shared key to sp_mcp_cursor while enabled", () => {
    expect(sharedMcpKeyEnabled()).toBe(true);
    expect(resolveMcpPrincipalIdFromKey("shared-key")).toBe("sp_mcp_cursor");
  });

  it("kill switch retires the shared key without touching per-agent keys", () => {
    vi.stubEnv("PLX_MC_MCP_SHARED_KEY_ENABLED", "0");
    expect(resolveMcpPrincipalIdFromKey("shared-key")).toBeNull();
    expect(resolveMcpPrincipalIdFromKey("claude-key")).toBe("sp_mcp_claude_code");
  });

  it("a rogue key configured for an unregistered id never authenticates", () => {
    expect(resolveMcpPrincipalIdFromKey("rogue-key")).toBeNull();
  });
});

describe("verifyMcpRequest with per-agent keys", () => {
  it("authenticates a per-agent key as its own durable principal", async () => {
    const identity = await verifyMcpRequest(
      req({ "x-api-key": "claude-key", ...OPERATOR_HEADERS })
    );
    expect(identity.servicePrincipalId).toBe("sp_mcp_claude_code");
    expect(identity.actor).toEqual({
      kind: "service",
      id: "sp_mcp_claude_code",
      status: "active",
    });
  });

  it("keeps the legacy shared key working as sp_mcp_cursor", async () => {
    const identity = await verifyMcpRequest(
      req({ "x-api-key": "shared-key", ...OPERATOR_HEADERS })
    );
    expect(identity.servicePrincipalId).toBe("sp_mcp_cursor");
  });

  it("rejects the shared key once the kill switch retires it", async () => {
    vi.stubEnv("PLX_MC_MCP_SHARED_KEY_ENABLED", "0");
    await expect(
      verifyMcpRequest(req({ "x-api-key": "shared-key", ...OPERATOR_HEADERS }))
    ).rejects.toMatchObject({ code: "invalid_api_key", status: 401 });
  });

  it("503s when no key of either kind is configured", async () => {
    vi.stubEnv("PLX_MC_MCP_AGENT_KEYS", "");
    vi.stubEnv("PLX_MC_MCP_API_KEY", "");
    await expect(
      verifyMcpRequest(req({ "x-api-key": "anything", ...OPERATOR_HEADERS }))
    ).rejects.toMatchObject({ code: "mcp_key_not_configured", status: 503 });
  });

  it("loads the per-agent principal from durable records when enforcement is on", async () => {
    vi.stubEnv("PLX_MC_PERMISSIONS_ENFORCEMENT_ENABLED", "1");
    const identityQuery = vi.fn(async () => [
      { id: "sp_mcp_claude_code", name: "PLX MC MCP Claude Code", status: "active" },
    ]);
    const identity = await verifyMcpRequest(
      req({ "x-api-key": "claude-key", ...OPERATOR_HEADERS }),
      { query: identityQuery }
    );
    expect(identity.actor.id).toBe("sp_mcp_claude_code");
    expect(identityQuery).toHaveBeenCalledWith(
      expect.stringContaining("FROM service_principals"),
      ["sp_mcp_claude_code"]
    );
  });

  it("rejects a revoked per-agent principal when enforcement is on", async () => {
    vi.stubEnv("PLX_MC_PERMISSIONS_ENFORCEMENT_ENABLED", "1");
    const identityQuery = vi.fn(async () => [
      { id: "sp_mcp_claude_code", name: "PLX MC MCP Claude Code", status: "revoked" },
    ]);
    await expect(
      verifyMcpRequest(req({ "x-api-key": "claude-key", ...OPERATOR_HEADERS }), {
        query: identityQuery,
      })
    ).rejects.toMatchObject({ code: "mcp_service_principal_revoked", status: 403 });
  });

  it("every agent principal carries the reviewed MCP bundle, never human grants", async () => {
    const { authorize } = await import("@/lib/permissions");
    const identity = await verifyMcpRequest(
      req({ "x-api-key": "codex-key", ...OPERATOR_HEADERS })
    );
    expect(authorize({ actor: identity.actor, capability: "task.checkout" }).allowed).toBe(true);
    expect(authorize({ actor: identity.actor, capability: "permissions.manage" }).allowed).toBe(
      false
    );
    expect(authorize({ actor: identity.actor, capability: "repo.approve" }).allowed).toBe(false);
  });

  it("still requires an allowlisted operator context", async () => {
    await expect(
      verifyMcpRequest(
        req({
          "x-api-key": "claude-key",
          "x-mc-operator-email": "outsider@example.com",
          "x-mc-repo": "petralabx/PLX_MC",
        })
      )
    ).rejects.toBeInstanceOf(ApiError);
  });
});
