// TASK-619 — per-agent MCP credentials: per-agent keys resolve per-agent
// durable principals; the legacy shared key stays behind a kill switch.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/permissions/decision-log", () => ({
  recordPermissionDecision: vi.fn(async () => true),
}));

vi.mock("@/lib/compliance/repo", () => ({
  appendEvent: vi.fn(async () => "4242"),
}));

import { appendEvent } from "@/lib/compliance/repo";
import { recordMcpToolCall } from "@/lib/mcp/audit";
import { ApiError } from "@/lib/api/route";
import { recordPermissionDecision } from "@/lib/permissions/decision-log";
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
  vi.clearAllMocks();
  vi.stubEnv("PLX_MC_PERMISSIONS_ENFORCEMENT_ENABLED", "0");
  vi.stubEnv("PLX_MC_MCP_AGENT_KEY_ROTATIONS", "");
  vi.stubEnv("PLX_MC_MCP_SHARED_KEY_ENABLED", "1");
  vi.stubEnv("PLX_MC_MCP_ENABLED", "1");
  vi.stubEnv("PLX_MC_ALLOWED_USERS", "vince@petrasoap.com");
  vi.stubEnv(
    "PLX_MC_MCP_AGENT_KEYS",
    JSON.stringify({
      sp_mcp_claude_code: "claude-key",
      sp_mcp_codex: "codex-key",
      sp_mcp_chatgpt: "chatgpt-key",
      sp_mcp_grok: "grok-key",
      sp_mcp_hermes: "hermes-key",
      sp_mcp_agent_runner: "runner-key",
      sp_mcp_portal: "portal-key",
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
    expect(registry.get("sp_mcp_chatgpt")).toBe("chatgpt-key");
    expect(registry.get("sp_mcp_grok")).toBe("grok-key");
    expect(registry.get("sp_mcp_hermes")).toBe("hermes-key");
    expect(registry.get("sp_mcp_agent_runner")).toBe("runner-key");
    expect(registry.get("sp_mcp_portal")).toBe("portal-key");
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
    expect(resolveMcpPrincipalIdFromKey("chatgpt-key")).toBe("sp_mcp_chatgpt");
    expect(resolveMcpPrincipalIdFromKey("grok-key")).toBe("sp_mcp_grok");
    expect(resolveMcpPrincipalIdFromKey("hermes-key")).toBe("sp_mcp_hermes");
    expect(resolveMcpPrincipalIdFromKey("runner-key")).toBe("sp_mcp_agent_runner");
    expect(resolveMcpPrincipalIdFromKey("portal-key")).toBe("sp_mcp_portal");
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

  it("authenticates the ChatGPT key as sp_mcp_chatgpt with the MCP bundle", async () => {
    const { authorize } = await import("@/lib/permissions");
    const identity = await verifyMcpRequest(
      req({ "x-api-key": "chatgpt-key", ...OPERATOR_HEADERS, "x-mc-runtime": "chatgpt" })
    );
    expect(identity.servicePrincipalId).toBe("sp_mcp_chatgpt");
    expect(identity.actor).toEqual({
      kind: "service",
      id: "sp_mcp_chatgpt",
      status: "active",
    });
    expect(authorize({ actor: identity.actor, capability: "task.checkout" }).allowed).toBe(true);
    expect(authorize({ actor: identity.actor, capability: "permissions.manage" }).allowed).toBe(
      false
    );
  });

  it("loads the ChatGPT principal from its migration 030 row when enforcement is on", async () => {
    vi.stubEnv("PLX_MC_PERMISSIONS_ENFORCEMENT_ENABLED", "1");
    const identityQuery = vi.fn(async () => [
      { id: "sp_mcp_chatgpt", name: "PLX MC MCP ChatGPT", status: "active" },
    ]);
    const identity = await verifyMcpRequest(
      req({ "x-api-key": "chatgpt-key", ...OPERATOR_HEADERS }),
      { query: identityQuery }
    );
    expect(identity.actor).toEqual({
      kind: "service",
      id: "sp_mcp_chatgpt",
      status: "active",
    });
    expect(identityQuery).toHaveBeenCalledWith(
      expect.stringContaining("FROM service_principals"),
      ["sp_mcp_chatgpt"]
    );
  });

  it("authenticates the agent runner key as sp_mcp_agent_runner with the MCP bundle", async () => {
    const { authorize } = await import("@/lib/permissions");
    const identity = await verifyMcpRequest(
      req({ "x-api-key": "runner-key", ...OPERATOR_HEADERS })
    );
    expect(identity.servicePrincipalId).toBe("sp_mcp_agent_runner");
    expect(identity.actor).toEqual({
      kind: "service",
      id: "sp_mcp_agent_runner",
      status: "active",
    });
    expect(authorize({ actor: identity.actor, capability: "task.checkout" }).allowed).toBe(true);
    expect(authorize({ actor: identity.actor, capability: "permissions.manage" }).allowed).toBe(
      false
    );
    expect(authorize({ actor: identity.actor, capability: "repo.approve" }).allowed).toBe(false);
  });

  // TASK-4313: the portal holds sp_mcp_cip's task rights (checkout, complete included).
  it("authenticates the portal key as sp_mcp_portal with CIP's task rights", async () => {
    const { authorize } = await import("@/lib/permissions");
    const identity = await verifyMcpRequest(
      req({ "x-api-key": "portal-key", ...OPERATOR_HEADERS })
    );
    expect(identity.servicePrincipalId).toBe("sp_mcp_portal");
    expect(identity.actor).toEqual({ kind: "service", id: "sp_mcp_portal", status: "active" });
    expect(authorize({ actor: identity.actor, capability: "task.create" }).allowed).toBe(true);
    expect(authorize({ actor: identity.actor, capability: "task.read" }).allowed).toBe(true);
    expect(authorize({ actor: identity.actor, capability: "task.checkout" }).allowed).toBe(true);
    expect(authorize({ actor: identity.actor, capability: "task.complete" }).allowed).toBe(true);
    expect(authorize({ actor: identity.actor, capability: "task.cancel" }).allowed).toBe(false);
    expect(authorize({ actor: identity.actor, capability: "bucket.create" }).allowed).toBe(false);
  });

  it("loads the portal principal from its migration 028 row when enforcement is on", async () => {
    vi.stubEnv("PLX_MC_PERMISSIONS_ENFORCEMENT_ENABLED", "1");
    const identityQuery = vi.fn(async () => [
      { id: "sp_mcp_portal", name: "PLX MC MCP Portal", status: "active" },
    ]);
    const identity = await verifyMcpRequest(
      req({ "x-api-key": "portal-key", ...OPERATOR_HEADERS }),
      { query: identityQuery }
    );
    expect(identity.actor).toEqual({ kind: "service", id: "sp_mcp_portal", status: "active" });
    expect(identityQuery).toHaveBeenCalledWith(
      expect.stringContaining("FROM service_principals"),
      ["sp_mcp_portal"]
    );
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

  it("loads the agent runner principal from its migration 027 row when enforcement is on", async () => {
    vi.stubEnv("PLX_MC_PERMISSIONS_ENFORCEMENT_ENABLED", "1");
    const identityQuery = vi.fn(async () => [
      { id: "sp_mcp_agent_runner", name: "PLX MC MCP Agent Runner", status: "active" },
    ]);
    const identity = await verifyMcpRequest(
      req({ "x-api-key": "runner-key", ...OPERATOR_HEADERS }),
      { query: identityQuery }
    );
    expect(identity.actor).toEqual({
      kind: "service",
      id: "sp_mcp_agent_runner",
      status: "active",
    });
    expect(identityQuery).toHaveBeenCalledWith(
      expect.stringContaining("FROM service_principals"),
      ["sp_mcp_agent_runner"]
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
    expect(recordPermissionDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        site: "mcp.auth",
        allowed: false,
        reasonCode: "actor_revoked",
        actorId: "sp_mcp_claude_code",
      })
    );
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


describe("MCP credential rotation and event attribution", () => {
  function rotate(overrides = {}) {
    vi.stubEnv("PLX_MC_MCP_AGENT_KEY_ROTATIONS", JSON.stringify({
      sp_mcp_claude_code: { next: "fake-next-key", ...overrides },
    }));
  }

  it("accepts current and next keys during overlap as the same principal", async () => {
    rotate();
    for (const key of ["claude-key", "fake-next-key"]) {
      const identity = await verifyMcpRequest(req({ "x-api-key": key, ...OPERATOR_HEADERS }));
      expect(identity.servicePrincipalId).toBe("sp_mcp_claude_code");
      expect(identity.actor.id).toBe("sp_mcp_claude_code");
    }
  });

  it.each([
    [{ currentEnabled: false }, "claude-key", "fake-next-key"],
    [{ nextEnabled: false }, "fake-next-key", "claude-key"],
  ])("rejects a disabled rotation slot with key_revoked, keeping the other usable: %j", async (flags, disabled, enabled) => {
    rotate(flags);
    await expect(verifyMcpRequest(req({ "x-api-key": disabled, ...OPERATOR_HEADERS })))
      .rejects.toMatchObject({ code: "invalid_api_key", status: 401 });
    expect(resolveMcpPrincipalIdFromKey(disabled)).toBeNull();
    expect(recordPermissionDecision).toHaveBeenCalledWith(expect.objectContaining({
      site: "mcp.auth", actorId: "sp_mcp_claude_code", allowed: false, reasonCode: "key_revoked",
    }));
    expect((await verifyMcpRequest(req({ "x-api-key": enabled, ...OPERATOR_HEADERS }))).actor.id)
      .toBe("sp_mcp_claude_code");
  });

  it("records key_revoked when the legacy shared key is disabled", async () => {
    vi.stubEnv("PLX_MC_MCP_SHARED_KEY_ENABLED", "0");
    await expect(verifyMcpRequest(req({ "x-api-key": "shared-key", ...OPERATOR_HEADERS })))
      .rejects.toMatchObject({ code: "invalid_api_key", status: 401 });
    expect(recordPermissionDecision).toHaveBeenCalledWith(expect.objectContaining({
      actorId: "sp_mcp_cursor", reasonCode: "key_revoked", allowed: false,
    }));
  });

  it.each(["{bad-json", '{"sp_mcp_claude_code":{"currentEnabled":"false"}}'])
    ("fails closed on malformed rotation config without leaking it: %s", async (config) => {
      vi.stubEnv("PLX_MC_MCP_AGENT_KEY_ROTATIONS", config);
      await expect(verifyMcpRequest(req({ "x-api-key": "claude-key", ...OPERATOR_HEADERS })))
        .rejects.toMatchObject({ code: "mcp_key_config_invalid", status: 503 });
    });

  it("rejects a credential shared by two principals instead of choosing the first", async () => {
    vi.stubEnv("PLX_MC_MCP_AGENT_KEYS", JSON.stringify({
      sp_mcp_claude_code: "fake-duplicate", sp_mcp_codex: "fake-duplicate",
    }));
    await expect(verifyMcpRequest(req({ "x-api-key": "fake-duplicate", ...OPERATOR_HEADERS })))
      .rejects.toMatchObject({ code: "invalid_api_key", status: 401 });
  });

  it("a disabled key cannot be re-enabled by reusing it in the next slot", async () => {
    rotate({ next: "claude-key", currentEnabled: false });
    expect(resolveMcpPrincipalIdFromKey("claude-key")).toBeNull();
  });

  it("emits two distinct principals for two keys despite identical operator and runtime headers", async () => {
    for (const [index, key] of ["claude-key", "codex-key"].entries()) {
      const identity = await verifyMcpRequest(req({ "x-api-key": key, ...OPERATOR_HEADERS }));
      await recordMcpToolCall({ tool: "mc_self_check", identity, requestId: `fake-req-${index}`, ok: index === 0, durationMs: 1 });
    }
    expect(vi.mocked(appendEvent).mock.calls.map(([event]) => event.actor))
      .toEqual(["sp_mcp_claude_code", "sp_mcp_codex"]);
    for (const [event] of vi.mocked(appendEvent).mock.calls) {
      expect(event.kind).toBe("mcp.tool.invoked");
      expect(event.payload).toMatchObject({
        servicePrincipalId: event.actor, workerId: "w1", runtime: "claude-code", operatorEmail: "vince@petrasoap.com",
      });
      expect(JSON.stringify(event)).not.toMatch(/claude-key|codex-key/);
    }
  });

  it("never logs unreviewed registry property names that may contain misplaced credentials", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("PLX_MC_MCP_AGENT_KEYS", '{"fake-misplaced-secret":"fake-key"}');
    expect(mcpAgentKeyRegistry().size).toBe(0);
    expect(JSON.stringify(error.mock.calls)).not.toContain("fake-misplaced-secret");
    error.mockRestore();
  });
});
