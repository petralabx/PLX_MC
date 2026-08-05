import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bucket, Project } from "@/lib/mc-data";
import type { CreateBucketInput, CreateProjectInput } from "@/lib/sync";

const mocks = vi.hoisted(() => ({
  buckets: [] as CreateBucketInput[],
  projects: [] as CreateProjectInput[],
  requireMcpActor: vi.fn(() => ({
    actor: { kind: "service", id: "sp_mcp_cursor", status: "active" },
    actorId: "sp_mcp_cursor",
    actorKind: "service",
    auditLabel: "vince@petrasoap.com",
  })),
}));

vi.mock("@/lib/compliance/service", () => ({
  complete: vi.fn(),
  checkout: vi.fn(),
}));

vi.mock("@/lib/compliance/repo", () => ({
  getDispatch: vi.fn(async () => null),
  appendEvent: vi.fn(async () => undefined),
}));

vi.mock("@/lib/sync", () => ({
  createBucket: vi.fn(async (input: CreateBucketInput) => {
    mocks.buckets.push(input);
    return {
      id: "BKT-COS-COMPANION",
      ...input,
      sync: { state: "pending", ts: "now", sp: "Roadmap · unprovisioned" },
    } as Bucket;
  }),
  createProject: vi.fn(async (input: CreateProjectInput) => {
    mocks.projects.push(input);
    return {
      id: "PRJ-COS-COMPANION",
      ...input,
      sync: { state: "pending", ts: "now", sp: "Projects · unprovisioned" },
    } as Project;
  }),
  createTask: vi.fn(),
  patchTask: vi.fn(),
  snapshot: vi.fn(),
}));

vi.mock("@/lib/sync/repo", () => ({
  getEntity: vi.fn(async () => null),
}));

vi.mock("@/lib/mcp/sync-meta", () => ({
  syncMetaForTask: vi.fn(async () => ({ status: "queued" })),
}));

vi.mock("@/lib/routing/mutations/actors", () => ({
  requireMcpActor: mocks.requireMcpActor,
}));

import { actionCreateBucket, actionCreateProject } from "@/lib/mcp/actions";
import type { McpIdentity } from "@/lib/mcp/auth";

const identity: McpIdentity = {
  operatorEmail: "vince@petrasoap.com",
  runtime: "cursor",
  workerId: "test",
  repo: "petralabx/PLX_MC",
  servicePrincipalId: "sp_mcp_cursor",
  actor: { kind: "service", id: "sp_mcp_cursor", status: "active" },
};

beforeEach(() => {
  mocks.buckets.length = 0;
  mocks.projects.length = 0;
  mocks.requireMcpActor.mockClear();
});

describe("MCP planning hierarchy creation actions", () => {
  it("authorizes and creates a project with operator-backed ownership", async () => {
    const result = await actionCreateProject(identity, {
      name: "COS Companion",
      description: "Standalone COS surface",
      repos: ["portal-web"],
    });

    expect(mocks.requireMcpActor).toHaveBeenCalledWith(identity, "project.create");
    expect(mocks.projects).toEqual([
      expect.objectContaining({
        name: "COS Companion",
        desc: "Standalone COS surface",
        owner: "vince",
        repos: ["portal-web"],
      }),
    ]);
    expect(result).toMatchObject({
      projectId: "PRJ-COS-COMPANION",
      sync: { state: "pending" },
    });
  });

  it("authorizes a bucket against its parent project and preserves explicit owner", async () => {
    const result = await actionCreateBucket(identity, {
      name: "PWA spike",
      description: "Prove standalone auth",
      owner: "greg",
      project: "PRJ-COS-COMPANION",
      repos: ["portal-web"],
    });

    expect(mocks.requireMcpActor).toHaveBeenCalledWith(
      identity,
      "bucket.create",
      { type: "project", id: "PRJ-COS-COMPANION" }
    );
    expect(mocks.buckets).toEqual([
      expect.objectContaining({
        name: "PWA spike",
        desc: "Prove standalone auth",
        owner: "greg",
        project: "PRJ-COS-COMPANION",
      }),
    ]);
    expect(result).toMatchObject({
      bucketId: "BKT-COS-COMPANION",
      sync: { state: "pending" },
    });
  });
});
