import { afterEach, describe, expect, it, vi } from "vitest";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/mcp/create-http-server", () => ({ createPlxMcMcpServer: vi.fn() }));

import { config } from "@/middleware";
import { GET as resourceMetadata } from "@/app/.well-known/oauth-protected-resource/route";
import { GET as authorizationMetadata } from "@/app/.well-known/oauth-authorization-server/route";
import { POST } from "@/app/api/cursor/mcp/route";
import { createPlxMcMcpServer } from "@/lib/mcp/create-http-server";

const context = { params: Promise.resolve({}) };
function middlewareMatches(path: string) {
  return unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: `https://example.test${path}` });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("header-key MCP discovery", () => {
  it.each(["/.well-known/oauth-protected-resource", "/.well-known/oauth-authorization-server"])(
    "exempts exactly %s from session middleware",
    (path) => expect(middlewareMatches(path)).toBe(false)
  );

  it.each([
    "/.well-known/other", "/.well-known/oauth-protected-resource-extra",
    "/.well-known/oauth-authorization-server-extra", "/xwell-known/oauth-protected-resource",
    "/.well-known/oauth-protected-resource/private", "/.well-known/oauth-authorization-server/private",
    "/api/compliance/checkout", "/api/compliance/complete", "/api/events", "/",
  ])("keeps %s behind session middleware", (path) => expect(middlewareMatches(path)).toBe(true));

  it("returns unauthenticated RFC 9728 JSON with no authorization servers", async () => {
    vi.stubEnv("PLX_MC_PUBLIC_URL", "https://example.test/");
    const response = await resourceMetadata(new Request("https://example.test/.well-known/oauth-protected-resource"), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      resource: "https://example.test/api/cursor/mcp",
      authorization_servers: [],
    });
  });

  it("returns JSON 404 without redirecting or advertising an OAuth issuer", async () => {
    const response = await authorizationMetadata(new Request("https://example.test/.well-known/oauth-authorization-server"), context);
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("location")).toBeNull();
    expect(await response.json()).toMatchObject({ error: { code: "oauth_not_supported" } });
  });

  it.each([{}, { "x-api-key": "wrong" }, { authorization: "Bearer wrong" }])(
    "preserves unauthenticated MCP POST 401 JSON invalid_api_key with a Bearer challenge (%j)",
    async (headers) => {
      vi.stubEnv("PLX_MC_MCP_ENABLED", "1");
      vi.stubEnv("PLX_MC_MCP_API_KEY", "offline-test-key");
      vi.stubEnv("PLX_MC_MCP_AGENT_KEYS", "");
      vi.stubEnv("PLX_MC_MCP_SHARED_KEY_ENABLED", "1");
      expect(middlewareMatches("/api/cursor/mcp")).toBe(false);
      const response = await POST(new Request("https://example.test/api/cursor/mcp", {
        method: "POST", headers: headers as Record<string, string>,
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
      }));
      expect(response.status).toBe(401);
      expect(response.headers.get("content-type")).toContain("application/json");
      expect(response.headers.get("www-authenticate")).toBe("Bearer");
      expect(response.headers.get("location")).toBeNull();
      expect(await response.json()).toEqual({ error: {
        code: "invalid_api_key", message: "Invalid or missing MCP API key.",
      } });
      expect(createPlxMcMcpServer).not.toHaveBeenCalled();
    }
  );
});
