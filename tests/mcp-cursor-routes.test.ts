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

import { ApiError } from "@/lib/api/route";
import { parseIdentity, verifyMcpRequest, mcpEnabled } from "@/lib/mcp/auth";
import { buildMeta, publicMcBaseUrl, taskLink } from "@/lib/mcp/envelope";

function req(headers: Record<string, string>): Request {
  return new Request("http://localhost/api/cursor/self-check", { headers });
}

describe("mcp auth", () => {
  it("reports enabled when flag is 1", () => {
    expect(mcpEnabled()).toBe(true);
  });

  it("accepts valid api key + operator headers", () => {
    const identity = verifyMcpRequest(
      req({
        "x-api-key": "test-mcp-key",
        "x-mc-operator-email": "vince@petrasoap.com",
        "x-mc-repo": "taylorvalton/PLX_MC",
        "x-mc-runtime": "cursor",
        "x-mc-worker-id": "w1",
      })
    );
    expect(identity.operatorEmail).toBe("vince@petrasoap.com");
    expect(identity.repo).toBe("taylorvalton/PLX_MC");
  });

  it("rejects missing operator email", () => {
    expect(() =>
      parseIdentity(
        req({
          "x-mc-repo": "taylorvalton/PLX_MC",
        })
      )
    ).toThrow(ApiError);
  });

  it("rejects invalid api key", () => {
    expect(() =>
      verifyMcpRequest(
        req({
          "x-api-key": "wrong",
          "x-mc-operator-email": "vince@petrasoap.com",
          "x-mc-repo": "taylorvalton/PLX_MC",
        })
      )
    ).toThrow(ApiError);
  });

  it("rejects non-allowlisted operator", () => {
    expect(() =>
      parseIdentity(
        req({
          "x-mc-operator-email": "outsider@example.com",
          "x-mc-repo": "taylorvalton/PLX_MC",
        })
      )
    ).toThrow(ApiError);
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
      repo: "taylorvalton/PLX_MC",
    });
    expect(meta.requestId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(meta.actor.operatorEmail).toBe("vince@petrasoap.com");
    expect(meta.links.mcBase).toBe("https://mc.plxcustomer.io");
  });
});
