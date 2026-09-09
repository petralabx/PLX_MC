import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/route";
import {
  assertCanAccessProject,
  canAccessBucket,
  canAccessProject,
  canAccessTask,
  filterBucketsByAcl,
  filterProjectsByAcl,
  filterTasksByAcl,
  indexById,
  isRestrictedProject,
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
});
