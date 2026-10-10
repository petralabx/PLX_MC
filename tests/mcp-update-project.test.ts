// mc_update_project / mc_list_projects (TASK-2530): steward authorization,
// owner validation, audited before/after, and list counts by status.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "@/lib/mc-data";

const mocks = vi.hoisted(() => ({
  archiveContainer: vi.fn(async () => ({ archivedAt: "2026-10-09", archivedBy: "vince", archiveReason: "retired" })),
  patchProject: vi.fn(),
  snapshot: vi.fn(),
  getProjects: vi.fn(),
  appendEvent: vi.fn(async () => "42"),
  assertProjectIdAccess: vi.fn(async () => undefined),
}));

vi.mock("@/lib/sync", () => ({
  archiveContainer: mocks.archiveContainer,
  patchProject: mocks.patchProject,
  snapshot: mocks.snapshot,
}));
vi.mock("@/lib/sync/repo", () => ({ getProjects: mocks.getProjects }));
vi.mock("@/lib/compliance/repo", () => ({ appendEvent: mocks.appendEvent }));
vi.mock("@/lib/permissions/project-acl-guard", () => ({
  assertProjectIdAccess: mocks.assertProjectIdAccess,
}));
vi.mock("@/lib/permissions/decision-log", () => ({
  recordPermissionDecision: vi.fn(async () => true),
}));

import type { McpIdentity } from "@/lib/mcp/auth";
import { actionListProjects, actionUpdateProject, resolveKnownProjectOwner } from "@/lib/mcp/project-actions";

const identity = (servicePrincipalId: string): McpIdentity => ({
  operatorEmail: "vince@petrasoap.com",
  runtime: "cursor",
  workerId: "test",
  repo: "petralabx/PLX_MC",
  servicePrincipalId: servicePrincipalId as McpIdentity["servicePrincipalId"],
  actor: { kind: "service", id: servicePrincipalId, status: "active" },
});
const steward = identity("sp_mcp_cursor");

const project = (over: Partial<Project> = {}): Project => ({
  id: "PRJ-COS-COMPANION",
  name: "COS Companion",
  owner: "vince",
  health: "track",
  target: "—",
  started: "2026.06.11",
  desc: "old",
  repos: [],
  sync: { state: "pending", ts: "—", sp: "Projects · unprovisioned" },
  prd: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getProjects.mockResolvedValue([project()]);
  mocks.patchProject.mockImplementation(async (_id: string, patch: Partial<Project>) => ({
    ...project(),
    ...patch,
  }));
});

describe("actionUpdateProject", () => {

  it("routes archive to the shared cascade with the authorized actor and reason", async () => {
    await actionUpdateProject(steward, { projectId: "PRJ-COS-COMPANION", action: "archive", reason: "retired", force: true });
    expect(mocks.archiveContainer).toHaveBeenCalledWith(expect.objectContaining({ entityType: "project", action: "archive", reason: "retired", force: true, actor: "vince@petrasoap.com" }));
    expect(mocks.patchProject).not.toHaveBeenCalled();
    await expect(actionUpdateProject(steward, { projectId: "PRJ-COS-COMPANION", action: "archive", reason: "retired", status: "closed" })).rejects.toMatchObject({ code: "invalid_request" });
  });
  it("closes a project, audits before/after on project.updated and passes the operator as actor", async () => {
    const result = await actionUpdateProject(steward, {
      projectId: "PRJ-COS-COMPANION",
      status: "closed",
      note: "52 done / 0 remaining",
    });

    expect(mocks.patchProject).toHaveBeenCalledWith(
      "PRJ-COS-COMPANION",
      { status: "closed" },
      "vince@petrasoap.com"
    );
    expect(mocks.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "project.updated",
        payload: expect.objectContaining({
          projectId: "PRJ-COS-COMPANION",
          before: { status: "active" },
          after: { status: "closed" },
          note: "52 done / 0 remaining",
        }),
      })
    );
    expect(result).toMatchObject({ changed: ["status"], eventSeq: "42" });
  });

  it("updates owner (resolved to the directory id) and description, leaving health alone", async () => {
    await actionUpdateProject(steward, {
      projectId: "PRJ-COS-COMPANION",
      owner: "Stephen@petrasoap.com",
      description: "new",
    });
    expect(mocks.patchProject).toHaveBeenCalledWith(
      "PRJ-COS-COMPANION",
      { owner: "stephen", desc: "new" },
      "vince@petrasoap.com"
    );
  });

  it("reopens a closed project with status=active", async () => {
    mocks.getProjects.mockResolvedValue([project({ status: "closed" })]);
    await actionUpdateProject(steward, { projectId: "PRJ-COS-COMPANION", status: "active" });
    expect(mocks.patchProject).toHaveBeenCalledWith(
      "PRJ-COS-COMPANION",
      { status: "active" },
      "vince@petrasoap.com"
    );
  });

  it("rejects an unknown owner without writing", async () => {
    await expect(
      actionUpdateProject(steward, { projectId: "PRJ-COS-COMPANION", owner: "nobody@example.com" })
    ).rejects.toMatchObject({ code: "invalid_owner", status: 422 });
    expect(mocks.patchProject).not.toHaveBeenCalled();
    expect(mocks.appendEvent).not.toHaveBeenCalled();
  });

  it("requires at least one field", async () => {
    await expect(
      actionUpdateProject(steward, { projectId: "PRJ-COS-COMPANION", note: "only a note" })
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(mocks.patchProject).not.toHaveBeenCalled();
  });

  it("rejects a principal without project.update (portal, inbound sync) and writes nothing", async () => {
    for (const id of ["sp_mcp_portal", "sp_sync_inbound"]) {
      await expect(
        actionUpdateProject(identity(id), { projectId: "PRJ-COS-COMPANION", status: "closed" })
      ).rejects.toMatchObject({ status: 403 });
    }
    expect(mocks.patchProject).not.toHaveBeenCalled();
    expect(mocks.appendEvent).not.toHaveBeenCalled();
  });

  it("applies the project ACL guard and reports unknown projects as 404", async () => {
    await actionUpdateProject(steward, { projectId: "PRJ-COS-COMPANION", status: "closed" });
    expect(mocks.assertProjectIdAccess).toHaveBeenCalledWith(
      "PRJ-COS-COMPANION",
      expect.objectContaining({ tokens: expect.arrayContaining(["sp_mcp_cursor"]) })
    );
    mocks.getProjects.mockResolvedValue([]);
    await expect(
      actionUpdateProject(steward, { projectId: "PRJ-NOPE", status: "closed" })
    ).rejects.toMatchObject({ status: 404 });
  });

  it("is a no-op (no write, no event) when nothing changes", async () => {
    const result = await actionUpdateProject(steward, { projectId: "PRJ-COS-COMPANION", status: "active" });
    expect(result).toMatchObject({ unchanged: true, changed: [] });
    expect(mocks.patchProject).not.toHaveBeenCalled();
    expect(mocks.appendEvent).not.toHaveBeenCalled();
  });
});

describe("resolveKnownProjectOwner", () => {
  it("accepts people (id or email), agents and service principals only", () => {
    expect(resolveKnownProjectOwner("vince")).toBe("vince");
    expect(resolveKnownProjectOwner("VINCE@petrasoap.com")).toBe("vince");
    expect(resolveKnownProjectOwner("atlas")).toBe("atlas");
    expect(resolveKnownProjectOwner("sp_mcp_cursor")).toBe("sp_mcp_cursor");
    expect(resolveKnownProjectOwner("stranger")).toBeNull();
  });
});

describe("actionListProjects", () => {
  beforeEach(() => {
    mocks.snapshot.mockResolvedValue({
      projects: [
        project({ id: "PRJ-A", name: "Alpha" }),
        project({ id: "PRJ-B", name: "Beta", status: "closed", closedAt: "2026-10-07T00:00:00.000Z" }),
        project({ id: "PRJ-R", name: "Secret", visibility: "restricted", members: ["someone-else"] }),
      ],
      buckets: [
        { id: "BKT-1", project: "PRJ-A" },
        { id: "BKT-2", project: "PRJ-A" },
        { id: "BKT-3", project: "PRJ-B" },
      ],
      tasks: [
        { id: "T1", bucket: "BKT-1", stage: "doing" },
        { id: "T2", bucket: "BKT-1", stage: "merged" },
        { id: "T3", bucket: "BKT-2", stage: "verified" },
        { id: "T4", bucket: "BKT-3", stage: "merged" },
        { id: "T5", bucket: "BKT-3", stage: "verified" },
      ],
    });
  });


  it("hides archived projects and buckets from default counts; includeArchived restores discovery", async () => {
    const snap = await mocks.snapshot();
    snap.projects[0].archivedAt = "2026-10-09";
    expect((await actionListProjects(steward, { status: "all" })).projects.map((p) => p.id)).toEqual(["PRJ-B"]);
    expect((await actionListProjects(steward, { status: "all", includeArchived: true })).projects.map((p) => p.id)).toEqual(["PRJ-A", "PRJ-B"]);
    snap.projects[0].archivedAt = null;
    snap.buckets[0].archivedAt = "2026-10-09";
    expect((await actionListProjects(steward)).projects[0].bucketCount).toBe(1);
  });
  it("returns active projects by default with accurate counts and hides restricted ones", async () => {
    const result = await actionListProjects(steward, {});
    expect(result.projects).toEqual([
      {
        id: "PRJ-A",
        name: "Alpha",
        owner: "vince",
        status: "active",
        health: "track",
        bucketCount: 2,
        openTaskCount: 1,
        doneTaskCount: 2,
        closedAt: null,
        archivedAt: null, archivedBy: null, archiveReason: null,
      },
    ]);
  });

  it("returns closed projects for status=closed, and both for all", async () => {
    const closed = await actionListProjects(steward, { status: "closed" });
    expect(closed.projects).toMatchObject([
      { id: "PRJ-B", status: "closed", bucketCount: 1, openTaskCount: 0, doneTaskCount: 2, closedAt: "2026-10-07T00:00:00.000Z" },
    ]);
    const all = await actionListProjects(steward, { status: "all", q: "alp" });
    expect(all.projects.map((p) => p.id)).toEqual(["PRJ-A"]);
  });

  it("is not available to the portal principal", async () => {
    await expect(actionListProjects(identity("sp_mcp_portal"), {})).rejects.toMatchObject({ status: 403 });
  });
});
