import { beforeEach, describe, expect, it } from "vitest";

import { REPOS, TASKS } from "@/lib/mc-data";
import type { FileEntry, Task } from "@/lib/mc-data";
import { buildBreadcrumbPath, deriveRepoRows } from "@/components/mc/record-logic";
import { allTasks, fileById, resetStore } from "@/lib/mc-data/store";

beforeEach(() => resetStore());

describe("buildBreadcrumbPath", () => {
  it("returns an empty trail for root", () => {
    expect(buildBreadcrumbPath(null, fileById)).toEqual([]);
  });

  it("resolves a top-level workstream folder", () => {
    const trail = buildBreadcrumbPath("fo-uat", fileById).map((entry) => entry.name);
    expect(trail).toEqual(["UAT"]);
  });

  it("builds an ancestor-to-leaf breadcrumb trail across nesting", () => {
    const byId = (id: string): FileEntry | undefined =>
      (
        {
          parent: { id: "parent", name: "Finance", kind: "folder", parent: null },
          child: { id: "child", name: "Evidence", kind: "folder", parent: "parent" },
        } as Record<string, FileEntry>
      )[id];
    expect(buildBreadcrumbPath("child", byId).map((entry) => entry.name)).toEqual([
      "Finance",
      "Evidence",
    ]);
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
  // Plan tasks carry no PRs yet, so PR aggregation invariants are protected
  // with synthetic tasks layered over the real fixture set.
  const withPrs: Task[] = [
    ...TASKS,
    {
      ...TASKS.find((t) => t.id === "TASK-222")!,
      id: "TASK-9001",
      repos: ["portal-api"],
      prs: [
        { repo: "portal-api", num: 7, status: "open", title: "feat: swagger contract" },
        { repo: "portal-api", num: 8, status: "merged", title: "chore: scaffolding" },
      ],
    },
  ];

  it("derives open PR counts from task PRs", () => {
    const rows = deriveRepoRows(REPOS, withPrs);
    const api = rows.find((row) => row.repo.id === "portal-api");
    expect(api?.openPrCount).toBe(1);
    expect(api?.prs).toHaveLength(2);
  });

  it("derives task counts from repo membership, not fixture rollups", () => {
    const rows = deriveRepoRows(REPOS, allTasks());
    const infra = rows.find((row) => row.repo.id === "infra");
    expect(infra?.tasks.map((t) => t.id)).toEqual(["TASK-235"]); // go-live infra checklist
    const api = rows.find((row) => row.repo.id === "portal-api");
    expect(api?.tasks.map((t) => t.id)).toContain("TASK-222");
  });

  it("retains task linkage on repo PR rows", () => {
    const rows = deriveRepoRows(REPOS, withPrs);
    const api = rows.find((row) => row.repo.id === "portal-api");
    const pr7 = api?.prs.find((pr) => pr.num === 7);
    expect(pr7?.taskId).toBe("TASK-9001");
    expect(pr7?.status).toBe("open");
  });
});
