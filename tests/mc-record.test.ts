import { beforeEach, describe, expect, it } from "vitest";

import { REPOS } from "@/lib/mc-data";
import type { FileEntry } from "@/lib/mc-data";
import { buildBreadcrumbPath, deriveRepoRows } from "@/components/mc/record-logic";
import { allTasks, fileById, resetStore } from "@/lib/mc-data/store";

beforeEach(() => resetStore());

describe("buildBreadcrumbPath", () => {
  it("returns an empty trail for root", () => {
    expect(buildBreadcrumbPath(null, fileById)).toEqual([]);
  });

  it("builds an ancestor-to-leaf breadcrumb trail", () => {
    const trail = buildBreadcrumbPath("fo-cpv2-ev", fileById).map((entry) => entry.name);
    expect(trail).toEqual(["Customer Portal v2", "Evidence"]);
  });

  it("returns known ancestors even if the chain breaks", () => {
    const fakeById = (id: string): FileEntry | undefined => {
      if (id === "child") {
        return { id: "child", name: "Child", kind: "folder", parent: "missing" };
      }
      return undefined;
    };
    expect(buildBreadcrumbPath("child", fakeById).map((entry) => entry.name)).toEqual(["Child"]);
  });
});

describe("deriveRepoRows", () => {
  it("derives open PR counts from task PRs", () => {
    const rows = deriveRepoRows(REPOS, allTasks());
    const web = rows.find((row) => row.repo.id === "portal-web");
    expect(web?.openPrCount).toBe(2);
    expect(web?.prs).toHaveLength(3);
  });

  it("derives task counts from repo membership, not fixture rollups", () => {
    const rows = deriveRepoRows(REPOS, allTasks());
    const infra = rows.find((row) => row.repo.id === "infra");
    const ids = infra?.tasks.map((t) => t.id);
    expect(ids).toContain("TASK-140");
    expect(ids).toContain("TASK-235"); // go-live infra checklist (plan seed)
    expect(infra?.tasks).toHaveLength(2);
  });

  it("retains task linkage on repo PR rows", () => {
    const rows = deriveRepoRows(REPOS, allTasks());
    const api = rows.find((row) => row.repo.id === "portal-api");
    const pr42 = api?.prs.find((pr) => pr.num === 42);
    expect(pr42?.taskId).toBe("TASK-214");
    expect(pr42?.status).toBe("open");
  });
});
