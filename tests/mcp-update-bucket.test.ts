import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/route";

const mocks = vi.hoisted(() => ({
  patchBucket: vi.fn(),
  assertBucketProjectAccess: vi.fn(async () => undefined),
  assertProjectIdAccess: vi.fn(async () => undefined),
}));

vi.mock("@/lib/sync", () => ({
  createBucket: vi.fn(),
  createProject: vi.fn(),
  createTask: vi.fn(),
  patchBucket: mocks.patchBucket,
  patchTask: vi.fn(),
  snapshot: vi.fn(),
}));

vi.mock("@/lib/permissions/project-acl-guard", () => ({
  assertBucketProjectAccess: mocks.assertBucketProjectAccess,
  assertProjectIdAccess: mocks.assertProjectIdAccess,
  loadProjectAclMaps: vi.fn(),
}));

vi.mock("@/lib/permissions/decision-log", () => ({
  recordPermissionDecision: vi.fn(async () => true),
}));

import type { McpIdentity } from "@/lib/mcp/auth";
import { actionUpdateBucket } from "@/lib/mcp/actions";
import {
  MCP_AGENT_SERVICE_PRINCIPAL_IDS,
  authorize,
  capabilitiesForServicePrincipal,
} from "@/lib/permissions";

const mcpIdentity: McpIdentity = {
  operatorEmail: "vince@petrasoap.com",
  runtime: "cursor",
  workerId: "test",
  repo: "petralabx/PLX_MC",
  servicePrincipalId: "sp_mcp_cursor",
  actor: { kind: "service", id: "sp_mcp_cursor", status: "active" },
};

const inboundIdentity: McpIdentity = {
  ...mcpIdentity,
  servicePrincipalId: "sp_mcp_cursor",
  actor: { kind: "service", id: "sp_sync_inbound", status: "active" },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.patchBucket.mockResolvedValue({
    id: "BKT-P1-INGEST-TRUTH-ORPHANS",
    name: "P1 ingest truth orphans",
    prd: "https://github.com/petralabx/agentic-swarm/blob/main/docs/trading-v2/prd/index.md",
    sync: { state: "pending", ts: "now", sp: "Roadmap · pending" },
  });
});

describe("MCP bucket.update grant", () => {
  it("grants bucket.update to every reviewed MCP agent principal", () => {
    for (const principalId of MCP_AGENT_SERVICE_PRINCIPAL_IDS) {
      expect(capabilitiesForServicePrincipal(principalId)).toEqual(
        expect.arrayContaining(["bucket.update"])
      );
      expect(
        authorize({
          actor: { kind: "service", id: principalId, status: "active" },
          capability: "bucket.update",
          resource: { type: "bucket", id: "BKT-1" },
        }).allowed
      ).toBe(true);
    }
  });

  it("still denies project.update and bucket.update for the inbound sync principal", () => {
    expect(
      authorize({
        actor: { kind: "service", id: "sp_sync_inbound", status: "active" },
        capability: "bucket.update",
        resource: { type: "bucket", id: "BKT-1" },
      }).allowed
    ).toBe(false);
    expect(
      authorize({
        actor: { kind: "service", id: "sp_mcp_cursor", status: "active" },
        capability: "project.update",
      }).allowed
    ).toBe(false);
  });
});

describe("actionUpdateBucket", () => {
  it("authorizes bucket.update and patches an existing bucket (happy path)", async () => {
    const result = await actionUpdateBucket(mcpIdentity, {
      id: "BKT-P1-INGEST-TRUTH-ORPHANS",
      prd: "https://github.com/petralabx/agentic-swarm/blob/main/docs/trading-v2/prd/index.md",
    });

    expect(mocks.assertBucketProjectAccess).toHaveBeenCalledWith(
      "BKT-P1-INGEST-TRUTH-ORPHANS",
      expect.objectContaining({ tokens: expect.arrayContaining(["sp_mcp_cursor"]) })
    );
    expect(mocks.patchBucket).toHaveBeenCalledWith(
      "BKT-P1-INGEST-TRUTH-ORPHANS",
      { prd: "https://github.com/petralabx/agentic-swarm/blob/main/docs/trading-v2/prd/index.md" },
      "vince@petrasoap.com"
    );
    expect(result).toMatchObject({
      bucketId: "BKT-P1-INGEST-TRUTH-ORPHANS",
      sync: { state: "pending" },
    });
  });

  it("maps description onto desc and asserts destination project ACL", async () => {
    await actionUpdateBucket(mcpIdentity, {
      id: "BKT-1",
      description: "Updated note",
      health: "risk",
      project: "PRJ-SECRET",
    });
    expect(mocks.assertProjectIdAccess).toHaveBeenCalledWith(
      "PRJ-SECRET",
      expect.objectContaining({ tokens: expect.arrayContaining(["sp_mcp_cursor"]) })
    );
    expect(mocks.patchBucket).toHaveBeenCalledWith(
      "BKT-1",
      { desc: "Updated note", health: "risk", project: "PRJ-SECRET" },
      "vince@petrasoap.com"
    );
  });

  it("returns not_found for an unknown bucket", async () => {
    mocks.patchBucket.mockResolvedValueOnce(null);
    await expect(
      actionUpdateBucket(mcpIdentity, { id: "BKT-MISSING", prd: "https://example.com/prd.md" })
    ).rejects.toMatchObject({ code: "not_found", status: 404 });
  });

  it("rejects a principal without bucket.update before touching the store", async () => {
    await expect(
      actionUpdateBucket(inboundIdentity, { id: "BKT-1", prd: "https://example.com/prd.md" })
    ).rejects.toMatchObject({ code: "forbidden", status: 403 });
    expect(mocks.patchBucket).not.toHaveBeenCalled();
    expect(mocks.assertBucketProjectAccess).not.toHaveBeenCalled();
  });

  it("rejects an empty patch before touching the store", async () => {
    await expect(actionUpdateBucket(mcpIdentity, { id: "BKT-1" })).rejects.toBeInstanceOf(
      ApiError
    );
    await expect(actionUpdateBucket(mcpIdentity, { id: "BKT-1" })).rejects.toMatchObject({
      code: "invalid_request",
    });
    expect(mocks.patchBucket).not.toHaveBeenCalled();
  });
});
