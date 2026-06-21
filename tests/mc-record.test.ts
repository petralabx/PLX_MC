import { beforeEach, describe, expect, it } from "vitest";

import { REPOS, TASKS } from "@/lib/mc-data";
import type { FileEntry, StageKey, Task } from "@/lib/mc-data";
import { buildBreadcrumbPath, deriveRepoRows, repoEditMode } from "@/components/mc/record-logic";
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
  // with synthetic tasks layered over the real fixture set. EN-002 backfilled
  // every task to portal-web (plx-customer-portal), so derivations key off it.
  const withPrs: Task[] = [
    ...TASKS,
    {
      ...TASKS.find((t) => t.id === "TASK-222")!,
      id: "TASK-9001",
      repos: ["portal-web"],
      prs: [
        { repo: "portal-web", num: 7, status: "open", title: "feat: swagger contract" },
        { repo: "portal-web", num: 8, status: "merged", title: "chore: scaffolding" },
      ],
    },
  ];

  it("derives open PR counts from task PRs", () => {
    const rows = deriveRepoRows(REPOS, withPrs);
    const portal = rows.find((row) => row.repo.id === "portal-web");
    expect(portal?.openPrCount).toBe(1);
    expect(portal?.prs).toHaveLength(2);
  });

  it("derives task counts from repo membership, not fixture rollups", () => {
    const rows = deriveRepoRows(REPOS, allTasks());
    const portal = rows.find((row) => row.repo.id === "portal-web");
    // Backfill (EN-002): every seeded task attaches plx-customer-portal.
    expect(portal?.tasks.map((t) => t.id)).toContain("TASK-235"); // go-live infra checklist
    expect(portal?.tasks.map((t) => t.id)).toContain("TASK-222"); // decoupling API
    expect(portal?.tasks).toHaveLength(allTasks().length);
  });

  it("retains task linkage on repo PR rows", () => {
    const rows = deriveRepoRows(REPOS, withPrs);
    const portal = rows.find((row) => row.repo.id === "portal-web");
    const pr7 = portal?.prs.find((pr) => pr.num === 7);
    expect(pr7?.taskId).toBe("TASK-9001");
    expect(pr7?.status).toBe("open");
  });
});

describe("repoEditMode (repo targeting lifecycle lock)", () => {
  const PLANNING: StageKey[] = ["backlog", "specced", "approved", "planned"];
  const IN_FLIGHT: StageKey[] = ["progress", "qa", "review", "merged", "verified"];

  it("is open through planning even when a target is set", () => {
    for (const stage of PLANNING) {
      expect(repoEditMode(stage, true)).toBe("open");
    }
  });

  it("locks an existing target once work is in flight", () => {
    for (const stage of IN_FLIGHT) {
      expect(repoEditMode(stage, true)).toBe("locked");
    }
  });

  it("stays open when no target is set", () => {
    for (const stage of [...PLANNING, ...IN_FLIGHT]) {
      expect(repoEditMode(stage, false)).toBe("open");
    }
  });
});
