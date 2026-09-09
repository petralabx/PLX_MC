import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/route";
import {
  assertCanAccessProject,
  canAccessBucket,
  canAccessProject,
  canAccessTask,
  filterBucketsByAcl,
  filterProjectsByAcl,
  filterStateSideChannels,
  filterTasksByAcl,
  hiddenHierarchyIds,
  indexById,
  isRestrictedProject,
  mentionsHiddenHierarchyId,
  normalizeProjectMembers,
  principalFromTokens,
  projectVisibility,
} from "@/lib/permissions/project-acl";

const vince = principalFromTokens("vince@petrasoap.com", "vince", "oid-vince");
const tanush = principalFromTokens("tanush@petrasoap.com");
const agent = principalFromTokens("sp_mcp_cursor");
const outsider = principalFromTokens("greg@petrasoap.com", "sp_mcp_grok");

const restricted = {
  id: "PRJ-SECRET",
  visibility: "restricted" as const,
  members: ["vince@petrasoap.com", "tanush@petrasoap.com", "sp_mcp_cursor", "vince"],
};

const shared = { id: "PRJ-OPEN", visibility: "shared" as const, members: [] };

describe("project ACL membership", () => {
  it("treats omitted visibility as shared", () => {
    expect(projectVisibility({})).toBe("shared");
    expect(isRestrictedProject({})).toBe(false);
    expect(canAccessProject({}, outsider)).toBe(true);
  });

  it("allows Vince, tanush@, and listed agent principals on a restricted project", () => {
    expect(canAccessProject(restricted, vince)).toBe(true);
    expect(canAccessProject(restricted, tanush)).toBe(true);
    expect(canAccessProject(restricted, agent)).toBe(true);
  });

  it("denies non-members, including other reviewed agents", () => {
    expect(canAccessProject(restricted, outsider)).toBe(false);
    expect(canAccessProject(restricted, principalFromTokens())).toBe(false);
  });

  it("fail-closes a restricted project with an empty member list", () => {
    expect(canAccessProject({ visibility: "restricted", members: [] }, vince)).toBe(false);
    expect(() =>
      assertCanAccessProject({ visibility: "restricted", members: [] }, vince)
    ).toThrow(ApiError);
  });

  it("normalizes emails and service-principal ids case-insensitively", () => {
    expect(normalizeProjectMembers([" Vince@PetraSoap.com ", "SP_MCP_CURSOR", ""])).toEqual([
      "vince@petrasoap.com",
      "sp_mcp_cursor",
    ]);
    expect(
      canAccessProject(
        { visibility: "restricted", members: ["Vince@PetraSoap.com"] },
        principalFromTokens("VINCE@PETRASOAP.COM")
      )
    ).toBe(true);
  });
});

describe("project ACL list filters", () => {
  const buckets = [
    { id: "BKT-OPEN", project: "PRJ-OPEN" },
    { id: "BKT-SECRET", project: "PRJ-SECRET" },
    { id: "BKT-ORPHAN", project: null },
  ];
  const tasks = [
    { id: "TASK-1", bucket: "BKT-OPEN", title: "public" },
    { id: "TASK-2", bucket: "BKT-SECRET", title: "private contents" },
    { id: "TASK-3", bucket: "BKT-ORPHAN", title: "unparented" },
  ];
  const projectsById = indexById([shared, restricted]);
  const bucketsById = indexById(buckets);

  it("hides restricted projects, buckets, and tasks from outsiders", () => {
    expect(filterProjectsByAcl([shared, restricted], outsider).map((p) => p.id)).toEqual([
      "PRJ-OPEN",
    ]);
    expect(filterBucketsByAcl(buckets, projectsById, outsider).map((b) => b.id)).toEqual([
      "BKT-OPEN",
      "BKT-ORPHAN",
    ]);
    expect(filterTasksByAcl(tasks, bucketsById, projectsById, outsider).map((t) => t.id)).toEqual([
      "TASK-1",
      "TASK-3",
    ]);
  });

  it("keeps restricted contents visible to members", () => {
    expect(filterProjectsByAcl([shared, restricted], tanush).map((p) => p.id)).toEqual([
      "PRJ-OPEN",
      "PRJ-SECRET",
    ]);
    expect(canAccessBucket(buckets[1], projectsById, agent)).toBe(true);
    expect(canAccessTask(tasks[1], bucketsById, projectsById, vince)).toBe(true);
  });

  it("fail-opens unparented buckets and tasks (null/empty project)", () => {
    expect(canAccessBucket({ project: null }, projectsById, outsider)).toBe(true);
    expect(canAccessBucket({ project: "" }, projectsById, outsider)).toBe(true);
    expect(canAccessBucket({ project: undefined }, projectsById, outsider)).toBe(true);
    expect(canAccessTask({ bucket: "BKT-ORPHAN" }, bucketsById, projectsById, outsider)).toBe(true);
  });

  it("fail-closes a whitespace-only project id (non-empty, no row)", () => {
    expect(canAccessBucket({ project: "   " }, projectsById, outsider)).toBe(false);
  });

  it("fail-closes a bucket whose project id is set but missing from the map", () => {
    const dangling = { id: "BKT-DANGLING", project: "PRJ-GONE" };
    expect(canAccessBucket(dangling, projectsById, outsider)).toBe(false);
    expect(canAccessBucket(dangling, projectsById, vince)).toBe(false);
    expect(filterBucketsByAcl([...buckets, dangling], projectsById, vince).map((b) => b.id)).toEqual([
      "BKT-OPEN",
      "BKT-SECRET",
      "BKT-ORPHAN",
    ]);
  });

  it("fail-closes a task whose bucket points at a missing project parent", () => {
    const danglingBucket = { id: "BKT-DANGLING", project: "PRJ-GONE" };
    const danglingTask = { id: "TASK-DANGLING", bucket: "BKT-DANGLING" };
    const withDangling = indexById([...buckets, danglingBucket]);
    expect(canAccessTask(danglingTask, withDangling, projectsById, outsider)).toBe(false);
    expect(canAccessTask(danglingTask, withDangling, projectsById, vince)).toBe(false);
    expect(
      filterTasksByAcl([...tasks, danglingTask], withDangling, projectsById, vince).map((t) => t.id)
    ).toEqual(["TASK-1", "TASK-2", "TASK-3"]);
  });
});

describe("project ACL state side channels", () => {
  const hidden = hiddenHierarchyIds({
    tasks: [{ id: "TASK-2" }, { id: "TASK-1" }],
    buckets: [{ id: "BKT-SECRET" }, { id: "BKT-OPEN" }],
    projects: [{ id: "PRJ-SECRET" }, { id: "PRJ-OPEN" }],
    visible: {
      tasks: [{ id: "TASK-1" }],
      buckets: [{ id: "BKT-OPEN" }],
      projects: [{ id: "PRJ-OPEN" }],
    },
  });

  it("collects only hierarchy ids hidden from the caller", () => {
    expect([...hidden].sort()).toEqual(["BKT-SECRET", "PRJ-SECRET", "TASK-2"]);
  });

  it("matches hidden ids as whole tokens, not substrings", () => {
    expect(mentionsHiddenHierarchyId("Edited TASK-2 — pending ToDos mirror.", hidden)).toBe(true);
    expect(mentionsHiddenHierarchyId("Edited TASK-20 — pending ToDos mirror.", hidden)).toBe(false);
  });

  it("drops conflicts, errors, and audit rows that name a hidden id", () => {
    const side = filterStateSideChannels({
      hiddenIds: hidden,
      conflicts: [
        {
          id: "cf-secret",
          entity: "ToDos",
          entityId: "TASK-2",
          field: "title",
          mcVal: "private contents",
          spVal: "x",
        },
        {
          id: "cf-open",
          entity: "ToDos",
          entityId: "TASK-1",
          field: "title",
          mcVal: "public",
          spVal: "y",
        },
        {
          id: "cf-note",
          entity: "Risk",
          entityId: "RISK-1",
          field: "note",
          mcVal: "see BKT-SECRET",
          spVal: "",
        },
      ],
      errors: [
        {
          id: "er-secret",
          entity: "Project",
          entityId: "PRJ-SECRET",
          field: "name",
          value: "hidden",
          reason: "lookup",
        },
        {
          id: "er-open",
          entity: "Project",
          entityId: "PRJ-OPEN",
          field: "name",
          value: "ok",
          reason: "lookup",
        },
      ],
      audit: [
        { ts: "t1", actor: "sync", body: "Created task TASK-2 (private contents).", state: "synced" },
        { ts: "t2", actor: "sync", body: "Created task TASK-1 (public).", state: "synced" },
      ],
    });
    expect(side.conflicts.map((row) => row.id)).toEqual(["cf-open"]);
    expect(side.errors.map((row) => row.id)).toEqual(["er-open"]);
    expect(side.audit.map((row) => row.ts)).toEqual(["t2"]);
  });
});
