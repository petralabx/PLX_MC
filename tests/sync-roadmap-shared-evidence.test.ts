// TASK-3166 r3: a normal SharePoint Roadmap pull that re-parents a bucket into a
// restricted project hits the repo's shared-evidence guard (409 shared_evidence)
// when one of the bucket's tasks has uploaded evidence. The pull keeps MC's
// parent, applies the bucket's other fields, records a Sync conflict for a person
// and carries on: it neither crashes the sweep nor deletes anything.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/route";

const h = vi.hoisted(() => ({
  conflicts: [] as Record<string, unknown>[],
  bucketWrites: [] as { id: string; opts: Record<string, unknown> }[],
  audits: [] as string[],
  guard: true,
}));

vi.mock("@/lib/sync/graph", () => {
  class GraphError extends Error {}
  return {
    GraphError,
    siteContext: async () => ({ siteId: "s", listIds: { roadmap: "roadmap" } }),
    listDelta: async () => ({
      items: [
        {
          id: "71",
          fields: { InitiativeID: "BKT-SHARED", Title: "Renamed in SharePoint", ProjectLookupId: 91 },
          lastModifiedBy: { user: { email: "human@petrasoap.com" } },
          lastModifiedDateTime: "2026-10-19T10:00:00.000Z",
        },
      ],
      deltaLink: "dl-roadmap-2",
    }),
    REPO_REGISTRY_KEY: "reporegistry",
    PROJECTS_KEY: "projects",
    ROADMAP_KEY: "roadmap",
    normalizeLastModified: () => ({ source: "human", at: "2026-10-19T10:00:00.000Z" }),
  };
});

const project = (id: string, spItemId: string, visibility: string) => ({
  project: { id, name: id, visibility, members: [] },
  syncState: "synced",
  spItemId,
  dirtyFields: [],
  fieldAttribution: {},
});

vi.mock("@/lib/sync/repo", () => ({
  stamp: () => "2026.10.19 · 10:00",
  entityCount: async () => 1,
  getEntity: async () => ({ id: "seed" }),
  seedRepos: async () => {},
  getDeltaLink: async () => "dl-roadmap-1",
  saveDeltaLink: async () => {},
  markRegisterInboundComplete: async () => {},
  appendAudit: async (_actor: string, line: string) => void h.audits.push(line),
  insertConflict: async (row: Record<string, unknown>) => void h.conflicts.push(row),
  getProjectRows: async () => [project("PRJ-SHARED", "90", "shared"), project("PRJ-PRIVATE", "91", "restricted")],
  getBucketRows: async () => [
    {
      bucket: { id: "BKT-SHARED", name: "Shared", project: "PRJ-SHARED", sync: { state: "synced", ts: "—", sp: "Roadmap" } },
      syncState: "synced",
      spItemId: "71",
      dirtyFields: [],
      fieldAttribution: {},
    },
  ],
  // The real repo guard (tests/shared-evidence-repo-guard.test.ts) refuses a re-parent of a bucket with evidence.
  updateBucket: async (id: string, opts: Record<string, unknown>) => {
    if (h.guard && (opts.patch as { project?: string } | undefined)?.project === "PRJ-PRIVATE") {
      throw new ApiError("shared_evidence", "Cannot move bucket BKT-SHARED to PRJ-PRIVATE: TASK-1 has evidence files ...", 409);
    }
    h.bucketWrites.push({ id, opts });
  },
}));

import { runScopedListDelta } from "@/lib/sync/engine";

beforeEach(() => {
  h.conflicts.length = 0;
  h.bucketWrites.length = 0;
  h.audits.length = 0;
  h.guard = true;
});

describe("Roadmap pull re-parenting a bucket with evidence into a restricted project", () => {
  it("keeps MC's parent, applies the other fields, and records a conflict for a person", async () => {
    const result = await runScopedListDelta("roadmap");
    expect(result).toMatchObject({ conflicts: 1, pulled: 1 });
    expect(h.conflicts).toEqual([
      expect.objectContaining({ entityType: "bucket", entityId: "BKT-SHARED", field: "Project", mcVal: "PRJ-SHARED", spVal: "PRJ-PRIVATE" }),
    ]);
    expect(h.conflicts[0].note).toMatch(/shared_evidence|evidence files/);
    expect(h.bucketWrites).toHaveLength(1);
    expect(h.bucketWrites[0].opts).toMatchObject({ patch: { name: "Renamed in SharePoint" }, syncState: "conflict" });
    expect(h.bucketWrites[0].opts.patch).not.toHaveProperty("project");
  });

  it("applies the re-parent when the guard allows it", async () => {
    h.guard = false;
    const result = await runScopedListDelta("roadmap");
    expect(result).toMatchObject({ conflicts: 0, pulled: 1 });
    expect(h.bucketWrites[0].opts).toMatchObject({ patch: { name: "Renamed in SharePoint", project: "PRJ-PRIVATE" } });
  });
});
