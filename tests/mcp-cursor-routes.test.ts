// MCP cursor API auth + envelope unit tests (no live DB).

import { beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({
  PLX_MC_MCP_ENABLED: "1",
  PLX_MC_MCP_API_KEY: "test-mcp-key",
  PLX_MC_ALLOWED_USERS: "vince@petrasoap.com",
  PLX_MC_PUBLIC_URL: "https://mc.plxcustomer.io",
}));

vi.stubEnv("PLX_MC_MCP_ENABLED", env.PLX_MC_MCP_ENABLED);
vi.stubEnv("PLX_MC_MCP_API_KEY", env.PLX_MC_MCP_API_KEY);
vi.stubEnv("PLX_MC_ALLOWED_USERS", env.PLX_MC_ALLOWED_USERS);
vi.stubEnv("PLX_MC_PUBLIC_URL", env.PLX_MC_PUBLIC_URL);

vi.mock("@/lib/mcp/audit", () => ({
  recordMcpToolCall: vi.fn(async () => "1"),
}));

import { ApiError } from "@/lib/api/route";
import {
  MCP_SERVICE_PRINCIPAL_ID,
  parseOperatorContext,
  verifyMcpRequest,
  mcpEnabled,
} from "@/lib/mcp/auth";
import { buildMeta, publicMcBaseUrl, taskLink } from "@/lib/mcp/envelope";
import { cursorRoute } from "@/lib/mcp/route";

function req(headers: Record<string, string>, init?: RequestInit): Request {
  return new Request("http://localhost/api/cursor/self-check", {
    ...init,
    headers,
  });
}

describe("mcp auth", () => {
  beforeEach(() => {
    vi.stubEnv("PLX_MC_MCP_ENABLED", "1");
    vi.stubEnv("PLX_MC_MCP_API_KEY", "test-mcp-key");
    vi.stubEnv("PLX_MC_ALLOWED_USERS", "vince@petrasoap.com");
  });

  it("reports enabled when flag is 1", () => {
    expect(mcpEnabled()).toBe(true);
  });

  it("accepts valid api key + operator headers asynchronously", async () => {
    const identity = await verifyMcpRequest(
      req({
        "x-api-key": "test-mcp-key",
        "x-mc-operator-email": "vince@petrasoap.com",
        "x-mc-repo": "petralabx/PLX_MC",
        "x-mc-runtime": "cursor",
        "x-mc-worker-id": "w1",
      })
    );
    expect(identity.operatorEmail).toBe("vince@petrasoap.com");
    expect(identity.repo).toBe("petralabx/PLX_MC");
    expect(identity.servicePrincipalId).toBe(MCP_SERVICE_PRINCIPAL_ID);
    expect(identity.actor.kind).toBe("service");
  });

  it("rejects missing operator email", () => {
    expect(() =>
      parseOperatorContext(
        req({
          "x-mc-repo": "petralabx/PLX_MC",
        })
      )
    ).toThrow(ApiError);
  });

  it("rejects invalid api key", async () => {
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

  it("rejects non-allowlisted operator", () => {
    expect(() =>
      parseOperatorContext(
        req({
          "x-mc-operator-email": "outsider@example.com",
          "x-mc-repo": "petralabx/PLX_MC",
        })
      )
    ).toThrow(ApiError);
  });
});

describe("async cursor route wrapper", () => {
  it("awaits async MCP identity resolution before invoking the handler", async () => {
    const seen: {
      servicePrincipalId?: string;
      actorId?: string;
    } = {};
    const route = cursorRoute("mc_self_check", async (_req, _ctx, identity) => {
      seen.servicePrincipalId = identity.servicePrincipalId;
      seen.actorId = identity.actor.id;
      return { data: { ok: true } };
    });
    const res = await route(
      req({
        "x-api-key": "test-mcp-key",
        "x-mc-operator-email": "vince@petrasoap.com",
        "x-mc-repo": "petralabx/PLX_MC",
      }),
      { params: Promise.resolve({}) }
    );
    expect(res.status).toBe(200);
    expect(seen.servicePrincipalId).toBe(MCP_SERVICE_PRINCIPAL_ID);
    expect(seen.actorId).toBe(MCP_SERVICE_PRINCIPAL_ID);
  });
});

describe("routing suggest cursor route", () => {
  it("registers POST /api/cursor/routing/suggest behind cursorRoute auth", async () => {
    vi.stubEnv("PLX_MC_ROUTING_SUGGEST_ENABLED", "1");
    const { POST } = await import("@/app/api/cursor/routing/suggest/route");
    // Without API key the shared wrapper rejects before the handler runs.
    const denied = await POST(
      req(
        {
          "x-mc-operator-email": "vince@petrasoap.com",
          "x-mc-repo": "petralabx/PLX_MC",
        },
        { method: "POST", body: JSON.stringify({ title: "x" }) }
      ),
      { params: Promise.resolve({}) }
    );
    expect(denied.status).toBe(401);

    // Valid MCP key reaches the suggest handler path (may 503 without full
    // sync/DB mocks — auth admission is the contract under test here).
    const admitted = await POST(
      req(
        {
          "x-api-key": "test-mcp-key",
          "x-mc-operator-email": "vince@petrasoap.com",
          "x-mc-repo": "petralabx/PLX_MC",
          "x-mc-runtime": "cursor",
          "x-mc-worker-id": "w1",
        },
        { method: "POST", body: JSON.stringify({ title: "routing suggest" }) }
      ),
      { params: Promise.resolve({}) }
    );
    // Handler may succeed or fail on mocked deps; must not be an auth failure.
    expect([200, 403, 500, 503]).toContain(admitted.status);
    expect(admitted.status).not.toBe(401);
  });
});

describe("mcp envelope", () => {
  it("uses configured public base URL", () => {
    expect(publicMcBaseUrl()).toBe("https://mc.plxcustomer.io");
    expect(taskLink("TASK-1")).toBe("https://mc.plxcustomer.io/tasks/TASK-1");
  });

  it("builds meta with request id and actor", () => {
    const meta = buildMeta({
      operatorEmail: "vince@petrasoap.com",
      runtime: "cursor",
      workerId: "w1",
      repo: "petralabx/PLX_MC",
      servicePrincipalId: MCP_SERVICE_PRINCIPAL_ID,
      actor: {
        kind: "service",
        id: MCP_SERVICE_PRINCIPAL_ID,
        status: "active",
      },
    });
    expect(meta.requestId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(meta.actor.operatorEmail).toBe("vince@petrasoap.com");
    expect(meta.actor.servicePrincipalId).toBe(MCP_SERVICE_PRINCIPAL_ID);
    expect(meta.links.mcBase).toBe("https://mc.plxcustomer.io");
  });
});
