// TASK-3166 r2: uploaded evidence sits in the shared SharePoint library, which a
// restricted project's access rules do not cover. MC refuses to move a task with
// evidence into a restricted project, to re-parent its bucket there, or to
// restrict its project, on every write path: the REST routes and MCP tools run
// through the real patchTask / patchBucket / patchProject, and so does the
// keep-SharePoint conflict resolution. Nothing is written and no file is touched.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bucket, Project } from "@/lib/mc-data";

type Row = { id: string; data: Record<string, unknown>; dirty_fields: string[]; field_attribution: Record<string, unknown>; sp_item_id: string | null };

const h = vi.hoisted(() => ({
  tasks: new Map<string, Row>(),
  buckets: [] as Bucket[],
  projects: [] as Project[],
  writes: [] as string[],
  conflict: null as null | Record<string, string>,
}));

vi.mock("@/lib/db", () => ({
  query: vi.fn(async () => []),
  withTransaction: vi.fn(async (fn: (q: unknown) => unknown) => fn(vi.fn(async () => []))),
}));
vi.mock("@/lib/sync/engine", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sync/engine")>()),
  ensureSeeded: vi.fn(async () => true),
  ensureReposSeeded: vi.fn(async () => {}),
  ensureProjectsSeeded: vi.fn(async () => {}),
  ensureBucketsSeeded: vi.fn(async () => {}),
}));
vi.mock("@/lib/sync/repo", () => ({
  stamp: () => "2026.10.19 · 12:00",
  getRepos: async () => [],
  getEntity: async (_type: string, id: string) => (h.tasks.has(id) ? structuredClone(h.tasks.get(id)) : null),
  getEntities: async () => [...h.tasks.values()].map((row) => structuredClone(row)),
  getBuckets: async () => h.buckets,
  getBucketRows: async () => h.buckets.map((bucket) => ({ bucket, dirtyFields: [], fieldAttribution: {}, spItemId: null, syncState: "synced" })),
  getProjects: async () => h.projects,
  getProjectRows: async () => [],
  getConflict: async () => h.conflict,
  updateEntity: vi.fn(async (_type: string, id: string) => void h.writes.push(`task:${id}`)),
  updateBucket: vi.fn(async (id: string) => void h.writes.push(`bucket:${id}`)),
  upsertBucket: vi.fn(async (b: Bucket) => void h.writes.push(`bucket:${b.id}`)),
  upsertProject: vi.fn(async (p: Project) => void h.writes.push(`project:${p.id}`)),
  setProjectSync: vi.fn(async () => {}),
  resolveConflictRow: vi.fn(async () => {}),
  appendAudit: vi.fn(async () => {}),
}));
vi.mock("@/lib/compliance/repo", () => ({ appendEvent: vi.fn(async () => "1"), appendEventTx: vi.fn(async () => "1") }));
vi.mock("@/lib/routing/mutations/actors", () => ({
  requireSessionActor: async () => ({ actor: {}, actorId: "oid-1", auditLabel: "vince@example.com" }),
  aclPrincipalFromAuthorized: () => ({ tokens: ["oid-1"] }),
  requireMcpActor: () => ({ actorId: "sp_mcp_claude_code", auditLabel: "cos@petrasoap.com" }),
  aclPrincipalFromMcp: () => ({ tokens: ["sp_mcp_claude_code"] }),
}));
vi.mock("@/lib/permissions/project-acl-guard", () => ({
  assertBucketProjectAccess: async () => undefined,
  assertTaskProjectAccess: async () => undefined,
  assertProjectIdAccess: async () => undefined,
}));
vi.mock("@/lib/permissions/agent-assignee-guard", () => ({ assertAgentAssigneeAllowed: () => undefined }));
vi.mock("@/lib/mcp/tool-allowlist", () => ({ assertMcpToolAllowed: () => undefined }));
vi.mock("@/lib/api/route", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/route")>()),
  route: (handler: unknown) => handler,
}));

import { patchBucket, patchProject, patchTask } from "@/lib/sync/state";
import { resolveConflict } from "@/lib/sync/engine";
import { actionUpdateTask } from "@/lib/mcp/task-update-actions";
import { actionUpdateBucket } from "@/lib/mcp/actions";
import { PATCH as patchTaskRoute } from "@/app/api/tasks/[id]/route";
import { PATCH as patchBucketRoute } from "@/app/api/buckets/[id]/route";
import { PATCH as patchProjectRoute } from "@/app/api/projects/[id]/route";
import type { McpIdentity } from "@/lib/mcp/auth";

const identity: McpIdentity = {
  operatorEmail: "cos@petrasoap.com",
  runtime: "claude-code",
  workerId: "test",
  repo: "petralabx/PLX_MC",
  servicePrincipalId: "sp_mcp_claude_code",
  actor: { kind: "service", id: "sp_mcp_claude_code", status: "active" },
};
const artifact = { kind: "screenshot", name: "a.png", caption: "c", url: "https://sp/a.png", driveItemId: "item-1", contentType: "image/png", size: 1, sha256: "ab", uploadedAt: "2026-10-19T00:00:00Z" };
const REFUSAL = /has evidence files in the shared SharePoint evidence library.*A person must relocate the files first\.$/;
const refused = { code: "shared_evidence", status: 409, message: expect.stringMatching(REFUSAL) };

const putTask = (id: string, bucket: string, withEvidence: boolean) =>
  h.tasks.set(id, {
    id,
    data: {
      id, title: id, bucket, stage: "progress", labels: ["lane:claude-cos"],
      evidence: { summary: "", items: [], ...(withEvidence ? { artifacts: [artifact] } : {}) },
    },
    dirty_fields: [], field_attribution: {}, sp_item_id: "1",
  });

const rest = (handler: unknown, path: string, id: string, body: Record<string, unknown>) =>
  (handler as (req: Request, ctx: unknown) => Promise<unknown>)(
    new Request(`http://localhost${path}/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ id }) }
  );

beforeEach(() => {
  h.tasks.clear();
  h.writes.length = 0;
  h.projects = [
    { id: "PRJ-SHARED", name: "Shared", owner: "vince", visibility: "shared", members: [] },
    { id: "PRJ-SHARED-2", name: "Shared 2", owner: "vince", visibility: "shared", members: [] },
    { id: "PRJ-PRIVATE", name: "Private", owner: "vince", visibility: "restricted", members: ["vince"] },
  ] as unknown as Project[];
  h.buckets = [
    { id: "BKT-SHARED", project: "PRJ-SHARED" },
    { id: "BKT-SHARED-2", project: "PRJ-SHARED-2" },
    { id: "BKT-PRIVATE", project: "PRJ-PRIVATE" },
  ] as unknown as Bucket[];
  putTask("TASK-1", "BKT-SHARED", true);
  h.conflict = null;
});

describe("moving a task with shared-library evidence into a restricted project", () => {
  it("patchTask refuses on every caller, without enforceClosedProject, and writes nothing", async () => {
    await expect(patchTask("TASK-1", { bucket: "BKT-PRIVATE" }, "vince")).rejects.toMatchObject(refused);
    expect(h.writes).toEqual([]);
  });

  it("PATCH /api/tasks/{id} refuses", async () => {
    await expect(rest(patchTaskRoute, "/api/tasks", "TASK-1", { bucket: "BKT-PRIVATE" })).rejects.toMatchObject(refused);
    expect(h.writes).toEqual([]);
  });

  it("mc_update_task refuses", async () => {
    await expect(actionUpdateTask(identity, { taskId: "TASK-1", patch: { bucket: "BKT-PRIVATE" } })).rejects.toMatchObject(refused);
    expect(h.writes).toEqual([]);
  });

  it("keep-SharePoint conflict resolution refuses and leaves the conflict open", async () => {
    h.conflict = { id: "cf-1", entityType: "task", entityId: "TASK-1", field: "bucket", mcVal: "BKT-SHARED", spVal: "BKT-PRIVATE" };
    await expect(resolveConflict("cf-1", "sp", "vince")).rejects.toMatchObject(refused);
    expect(h.writes).toEqual([]);
  });

  it("still moves a task without evidence, and a task with evidence into a shared project", async () => {
    putTask("TASK-2", "BKT-SHARED", false);
    await expect(patchTask("TASK-2", { bucket: "BKT-PRIVATE" }, "vince")).resolves.toBeTruthy();
    await expect(patchTask("TASK-1", { bucket: "BKT-SHARED-2" }, "vince")).resolves.toBeTruthy();
    expect(h.writes).toEqual(["task:TASK-2", "task:TASK-1"]);
  });
});

describe("re-parenting a bucket with shared-library evidence under a restricted project", () => {
  it("PATCH /api/buckets/{id} refuses", async () => {
    await expect(rest(patchBucketRoute, "/api/buckets", "BKT-SHARED", { project: "PRJ-PRIVATE" })).rejects.toMatchObject(refused);
    expect(h.writes).toEqual([]);
  });

  it("mc_update_bucket refuses", async () => {
    await expect(actionUpdateBucket(identity, { id: "BKT-SHARED", project: "PRJ-PRIVATE" })).rejects.toMatchObject(refused);
    expect(h.writes).toEqual([]);
  });

  it("keep-SharePoint conflict resolution refuses", async () => {
    h.conflict = { id: "cf-1", entityType: "bucket", entityId: "BKT-SHARED", field: "project", mcVal: "PRJ-SHARED", spVal: "PRJ-PRIVATE" };
    await expect(resolveConflict("cf-1", "sp", "vince")).rejects.toMatchObject(refused);
    expect(h.writes).toEqual([]);
  });

  it("still re-parents a bucket whose tasks have no evidence", async () => {
    putTask("TASK-1", "BKT-SHARED", false);
    await expect(patchBucket("BKT-SHARED", { project: "PRJ-PRIVATE" }, "vince")).resolves.toMatchObject({ project: "PRJ-PRIVATE" });
  });
});

describe("restricting a project that holds shared-library evidence", () => {
  it("PATCH /api/projects/{id} refuses visibility=restricted", async () => {
    await expect(rest(patchProjectRoute, "/api/projects", "PRJ-SHARED", { visibility: "restricted", members: ["vince"] })).rejects.toMatchObject(refused);
    expect(h.writes).toEqual([]);
  });

  it("still restricts a project without evidence, and edits an already restricted one", async () => {
    putTask("TASK-1", "BKT-SHARED-2", false);
    await expect(patchProject("PRJ-SHARED", { visibility: "restricted", members: ["vince"] }, "vince")).resolves.toMatchObject({ visibility: "restricted" });
    putTask("TASK-3", "BKT-PRIVATE", true);
    await expect(patchProject("PRJ-PRIVATE", { desc: "renamed" }, "vince")).resolves.toMatchObject({ desc: "renamed" });
  });
});
