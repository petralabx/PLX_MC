import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createBucket: vi.fn(),
  createProject: vi.fn(),
}));

vi.stubEnv("PLX_MC_MCP_ENABLED", "1");
vi.stubEnv("PLX_MC_MCP_API_KEY", "test-mcp-key");
vi.stubEnv("PLX_MC_MCP_AGENT_KEYS", "");
vi.stubEnv("PLX_MC_ALLOWED_USERS", "vince@petrasoap.com");
vi.stubEnv("PLX_MC_PUBLIC_URL", "https://mc.plxcustomer.io");

vi.mock("@/lib/mcp/audit", () => ({
  recordMcpToolCall: vi.fn(async () => "1"),
}));

vi.mock("@/lib/mcp/actions", () => ({
  actionCreateBucket: mocks.createBucket,
  actionCreateProject: mocks.createProject,
}));

import { POST as createBucket } from "@/app/api/cursor/buckets/route";
import { POST as createProject } from "@/app/api/cursor/projects/route";

const ctx = { params: Promise.resolve({} as Record<string, string>) };

function post(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": "test-mcp-key",
      "x-mc-operator-email": "vince@petrasoap.com",
      "x-mc-repo": "petralabx/PLX_MC",
      "x-mc-runtime": "cursor",
      "x-mc-worker-id": "hierarchy-test",
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createProject.mockResolvedValue({
    project: { id: "PRJ-COS-COMPANION" },
    projectId: "PRJ-COS-COMPANION",
    sync: { state: "pending" },
  });
  mocks.createBucket.mockResolvedValue({
    bucket: { id: "BKT-PWA-SPIKE" },
    bucketId: "BKT-PWA-SPIKE",
    sync: { state: "pending" },
  });
});

describe("cursor project and bucket creation routes", () => {
  it("validates and creates a project through the authenticated envelope", async () => {
    const response = await createProject(
      post("http://localhost/api/cursor/projects", {
        name: "COS Companion",
        description: "Standalone COS surface",
        repos: ["portal-web"],
      }),
      ctx
    );

    expect(response.status).toBe(200);
    expect(mocks.createProject).toHaveBeenCalledWith(
      expect.objectContaining({ servicePrincipalId: "sp_mcp_cursor" }),
      {
        name: "COS Companion",
        description: "Standalone COS surface",
        repos: ["portal-web"],
      }
    );
    await expect(response.json()).resolves.toMatchObject({
      data: { projectId: "PRJ-COS-COMPANION" },
      meta: { audit: { kinds: ["mc_create_project", "mcp.tool.invoked"] } },
    });
  });

  it("validates and creates a bucket under an existing project", async () => {
    const response = await createBucket(
      post("http://localhost/api/cursor/buckets", {
        name: "PWA spike",
        project: "PRJ-COS-COMPANION",
      }),
      ctx
    );

    expect(response.status).toBe(200);
    expect(mocks.createBucket).toHaveBeenCalledWith(
      expect.objectContaining({ servicePrincipalId: "sp_mcp_cursor" }),
      { name: "PWA spike", project: "PRJ-COS-COMPANION" }
    );
    await expect(response.json()).resolves.toMatchObject({
      data: { bucketId: "BKT-PWA-SPIKE" },
      meta: { audit: { kinds: ["mc_create_bucket", "mcp.tool.invoked"] } },
    });
  });

  it("rejects malformed hierarchy creation before calling an action", async () => {
    const response = await createProject(
      post("http://localhost/api/cursor/projects", { name: "" }),
      ctx
    );

    expect(response.status).toBe(400);
    expect(mocks.createProject).not.toHaveBeenCalled();
  });
});
