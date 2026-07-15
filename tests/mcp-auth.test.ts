// MCP auth — shared API key authenticates a durable service principal;
// operator email is allowlisted audit context only (no human capability grant).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.stubEnv("PLX_MC_MCP_ENABLED", "1");
vi.stubEnv("PLX_MC_MCP_API_KEY", "test-mcp-key");
vi.stubEnv("PLX_MC_ALLOWED_USERS", "vince@petrasoap.com");

import { ApiError } from "@/lib/api/route";
import { authorize } from "@/lib/permissions";
import {
  MCP_SERVICE_PRINCIPAL_ID,
  parseOperatorContext,
  verifyMcpRequest,
} from "@/lib/mcp/auth";

function req(headers: Record<string, string>): Request {
  return new Request("http://localhost/api/cursor/self-check", { headers });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("MCP service principal auth", () => {
  beforeEach(() => {
    vi.stubEnv("PLX_MC_MCP_ENABLED", "1");
    vi.stubEnv("PLX_MC_MCP_API_KEY", "test-mcp-key");
    vi.stubEnv("PLX_MC_ALLOWED_USERS", "vince@petrasoap.com");
  });

  it("resolves the durable MCP service principal from a valid API key", async () => {
    const identity = await verifyMcpRequest(
      req({
        "x-api-key": "test-mcp-key",
        "x-mc-operator-email": "vince@petrasoap.com",
        "x-mc-repo": "petralabx/PLX_MC",
        "x-mc-runtime": "cursor",
        "x-mc-worker-id": "w1",
      })
    );
    expect(identity.servicePrincipalId).toBe(MCP_SERVICE_PRINCIPAL_ID);
    expect(identity.actor.kind).toBe("service");
    expect(identity.actor.id).toBe(MCP_SERVICE_PRINCIPAL_ID);
    expect(identity.operatorEmail).toBe("vince@petrasoap.com");
  });

  it("keeps operator email as context without escalating service capabilities", async () => {
    const identity = await verifyMcpRequest(
      req({
        "x-api-key": "test-mcp-key",
        "x-mc-operator-email": "vince@petrasoap.com",
        "x-mc-repo": "petralabx/PLX_MC",
      })
    );
    // Owner email on the allowlist must not escalate the service actor.
    expect(authorize({ actor: identity.actor, capability: "permissions.manage" }).allowed).toBe(
      false
    );
    expect(authorize({ actor: identity.actor, capability: "repo.approve" }).allowed).toBe(false);
    expect(authorize({ actor: identity.actor, capability: "task.create" }).allowed).toBe(true);
    expect(authorize({ actor: identity.actor, capability: "routing.suggest" }).allowed).toBe(true);
  });

  it("still validates allowlisted operator context", () => {
    expect(() =>
      parseOperatorContext(
        req({
          "x-mc-operator-email": "outsider@example.com",
          "x-mc-repo": "petralabx/PLX_MC",
        })
      )
    ).toThrow(ApiError);
  });

  it("rejects invalid api keys before operator parsing grants anything", async () => {
    await expect(
      verifyMcpRequest(
        req({
          "x-api-key": "wrong",
          "x-mc-operator-email": "vince@petrasoap.com",
          "x-mc-repo": "petralabx/PLX_MC",
        })
      )
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("does not query durable identities when permissions enforcement is off", async () => {
    vi.stubEnv("PLX_MC_PERMISSIONS_ENFORCEMENT_ENABLED", "0");
    const identityQuery = vi.fn();

    await verifyMcpRequest(
      req({
        "x-api-key": "test-mcp-key",
        "x-mc-operator-email": "vince@petrasoap.com",
        "x-mc-repo": "petralabx/PLX_MC",
      }),
      { query: identityQuery }
    );

    expect(identityQuery).not.toHaveBeenCalled();
  });

  it("loads an active MCP service principal when enforcement is on", async () => {
    vi.stubEnv("PLX_MC_PERMISSIONS_ENFORCEMENT_ENABLED", "1");
    const identityQuery = vi.fn(async () => [
      { id: "sp_mcp_cursor", name: "PLX MC MCP", status: "active" },
    ]);

    const identity = await verifyMcpRequest(
      req({
        "x-api-key": "test-mcp-key",
        "x-mc-operator-email": "vince@petrasoap.com",
        "x-mc-repo": "petralabx/PLX_MC",
      }),
      { query: identityQuery }
    );

    expect(identity.actor).toEqual({
      kind: "service",
      id: "sp_mcp_cursor",
      status: "active",
    });
    expect(identityQuery).toHaveBeenCalledWith(
      expect.stringContaining("FROM service_principals"),
      ["sp_mcp_cursor"]
    );
  });

  it("rejects a missing MCP service principal when enforcement is on", async () => {
    vi.stubEnv("PLX_MC_PERMISSIONS_ENFORCEMENT_ENABLED", "1");
    const identityQuery = vi.fn(async () => []);

    await expect(
      verifyMcpRequest(
        req({
          "x-api-key": "test-mcp-key",
          "x-mc-operator-email": "vince@petrasoap.com",
          "x-mc-repo": "petralabx/PLX_MC",
        }),
        { query: identityQuery }
      )
    ).rejects.toMatchObject({
      code: "mcp_service_principal_missing",
      status: 503,
    });
  });

  it("rejects a revoked MCP service principal when enforcement is on", async () => {
    vi.stubEnv("PLX_MC_PERMISSIONS_ENFORCEMENT_ENABLED", "1");
    const identityQuery = vi.fn(async () => [
      { id: "sp_mcp_cursor", name: "PLX MC MCP", status: "revoked" },
    ]);

    await expect(
      verifyMcpRequest(
        req({
          "x-api-key": "test-mcp-key",
          "x-mc-operator-email": "vince@petrasoap.com",
          "x-mc-repo": "petralabx/PLX_MC",
        }),
        { query: identityQuery }
      )
    ).rejects.toMatchObject({
      code: "mcp_service_principal_revoked",
      status: 403,
    });
  });
});
