import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/route";
import { principalFromTokens } from "@/lib/permissions/project-acl";

const getProjects = vi.hoisted(() => vi.fn());

vi.mock("@/lib/sync/repo", () => ({
  getProjects,
  getBuckets: vi.fn(),
  getEntity: vi.fn(),
}));

import { assertProjectIdAccess } from "@/lib/permissions/project-acl-guard";

const vince = principalFromTokens("vince@petrasoap.com");
const outsider = principalFromTokens("greg@petrasoap.com");

beforeEach(() => {
  getProjects.mockReset();
  getProjects.mockResolvedValue([
    { id: "PRJ-OPEN", visibility: "shared", members: [] },
    {
      id: "PRJ-SECRET",
      visibility: "restricted",
      members: ["vince@petrasoap.com"],
    },
  ]);
});

describe("assertProjectIdAccess", () => {
  it("allows when project id is null or empty (unparented)", async () => {
    await expect(assertProjectIdAccess(null, outsider)).resolves.toBeUndefined();
    await expect(assertProjectIdAccess(undefined, outsider)).resolves.toBeUndefined();
    await expect(assertProjectIdAccess("", outsider)).resolves.toBeUndefined();
    expect(getProjects).not.toHaveBeenCalled();
  });

  it("denies with 404 when project id is set but the row is missing", async () => {
    await expect(assertProjectIdAccess("PRJ-GONE", outsider)).rejects.toMatchObject({
      code: "not_found",
      status: 404,
    });
    await expect(assertProjectIdAccess("PRJ-GONE", vince)).rejects.toBeInstanceOf(ApiError);
  });

  it("still denies restricted non-members with 403 and allows members", async () => {
    await expect(assertProjectIdAccess("PRJ-SECRET", outsider)).rejects.toMatchObject({
      code: "project_acl_denied",
      status: 403,
    });
    await expect(assertProjectIdAccess("PRJ-SECRET", vince)).resolves.toBeUndefined();
    await expect(assertProjectIdAccess("PRJ-OPEN", outsider)).resolves.toBeUndefined();
  });
});
