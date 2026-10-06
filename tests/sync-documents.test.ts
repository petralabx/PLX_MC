// TASK-628 — a PRD uploaded to the Project Documents library appears linked on
// its initiative after a sweep. A fake Graph drive delta (fixture shaped like
// Graph's driveItem delta) is driven through the REAL runSweep + real mapping;
// repo/graph are in-memory fakes. No Graph or SharePoint access is used.

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  audits: [] as string[],
  files: new Map<string, Record<string, unknown>>(),
  buckets: [] as { bucket: Record<string, unknown>; syncState: string; spItemId: string | null }[],
  driveItems: [] as Record<string, unknown>[],
  roadmapPatches: [] as { itemId: string; fields: Record<string, unknown> }[],
}));

vi.mock("@/lib/db", () => ({
  query: async () => [],
  withTransaction: async (fn: (q: unknown) => Promise<unknown>) => fn(async () => []),
}));

vi.mock("@/lib/sync/graph", () => {
  class GraphError extends Error {
    constructor(
      public status: number,
      public body: string
    ) {
      super(`graph ${status}`);
    }
  }
  return {
    GraphError,
    siteContext: async () => ({
      siteId: "s",
      listIds: { todos: "t", risks: "r", projects: "p", roadmap: "m", documents: "d" },
    }),
    listDelta: async () => ({ items: [], deltaLink: "dl" }),
    documentsDriveId: async () => "drive-1",
    driveRootId: async () => "root-id",
    driveDelta: async () => ({ items: h.driveItems, deltaLink: "dl-documents" }),
    patchListItemFields: async (_ctx: unknown, list: string, itemId: string, fields: Record<string, unknown>) => {
      if (list === "roadmap") h.roadmapPatches.push({ itemId, fields });
    },
    createListItem: async () => "new-item",
    findItemByField: async () => null,
    REPO_REGISTRY_KEY: "reporegistry",
    PROJECTS_KEY: "projects",
    ROADMAP_KEY: "roadmap",
    resolveSiteUserLookupId: async () => null,
    resolveEmailByLookupId: async () => null,
  };
});

vi.mock("@/lib/sync/repo", () => ({
  stamp: () => "2026.10.06 · 00:00",
  entityCount: async () => 1,
  getEntity: async (type: string, id: string) =>
    type === "file" && id.startsWith("file-sp-") ? (h.files.get(id) ? { id, data: h.files.get(id) } : null) : { id: "seed" },
  insertEntity: async (type: string, id: string, data: Record<string, unknown>) => {
    if (type === "file") h.files.set(id, data);
  },
  updateEntity: async (type: string, id: string, opts: { patch?: Record<string, unknown> }) => {
    // Real repo.updateEntity merges the patch into the stored data.
    if (type === "file" && opts.patch) h.files.set(id, { ...h.files.get(id), ...opts.patch });
  },
  insertConflict: async () => {},
  insertPushError: async () => {},
  appendAudit: async (_actor: string, body: string) => {
    h.audits.push(body);
  },
  getEntities: async (type: string) =>
    type === "file" ? [...h.files.entries()].map(([id, data]) => ({ id, data })) : [],
  getDeltaLink: async () => null,
  saveDeltaLink: async () => {},
  countsByList: async () => ({}),
  seedRepos: async () => {},
  getRepos: async () => [],
  getProjectRows: async () => [],
  getBucketRows: async () => h.buckets.map((b) => ({ ...b, dirtyFields: [] })),
  getBucketBySpItemId: async () => null,
  updateBucket: async (id: string, opts: { patch?: Record<string, unknown>; syncState?: string }) => {
    const row = h.buckets.find((b) => b.bucket.id === id);
    if (!row) return;
    row.bucket = { ...row.bucket, ...(opts.patch ?? {}) };
    if (opts.syncState) row.syncState = opts.syncState;
  },
  setBucketSync: async (id: string, state: string) => {
    const row = h.buckets.find((b) => b.bucket.id === id);
    if (row) row.syncState = state;
  },
  seedBuckets: async () => {},
  seedProjects: async () => {},
  markRegisterInboundComplete: async () => {},
}));

import { runSweep } from "@/lib/sync/engine";
import { documentLinkFor } from "@/lib/sync/documents";

const PRD_URL = "https://petra.sharepoint.com/sites/plx/Project%20Documents/Customer%20Portal%20v2/PRD/PRD-CPV2.docx";

function bucket(id: string, name: string, prd: string | null = null) {
  return {
    bucket: { id, name, owner: "vince", health: "track", target: "", started: "", desc: "", repos: [], prd, sync: {} },
    syncState: "synced",
    spItemId: `sp-${id}`,
  };
}

// Graph's drive delta returns folders as items and children with only
// parentReference.id (no path) — ancestry must be resolved by id.
const folderItems = [
  { id: "f-cpv2", name: "Customer Portal v2", folder: {}, parentReference: { id: "root-id" } },
  { id: "f-cpv2-prd", name: "PRD", folder: {}, parentReference: { id: "f-cpv2" } },
  { id: "f-cpv2-ev", name: "Evidence", folder: {}, parentReference: { id: "f-cpv2" } },
  { id: "f-shared", name: "Shared", folder: {}, parentReference: { id: "root-id" } },
];

function prdItem(over: Record<string, unknown> = {}) {
  return {
    id: "di-prd",
    name: "PRD-CPV2.docx",
    file: { mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
    size: 49152,
    webUrl: PRD_URL,
    lastModifiedDateTime: "2026-10-05T10:00:00Z",
    parentReference: { id: "f-cpv2-prd" },
    ...over,
  };
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("PLX_MC_DOCUMENTS_SYNC_ENABLED", "1");
  h.audits.length = 0;
  h.files.clear();
  h.roadmapPatches.length = 0;
  h.buckets = [bucket("BKT-CPV2", "Customer Portal v2"), bucket("BKT-OTHER", "Other")];
  h.driveItems = [];
});

describe("Project Documents → initiative links (TASK-628)", () => {
  it("a PRD uploaded under its initiative folder is linked on that initiative after a sweep", async () => {
    h.driveItems = [...folderItems, prdItem()];
    await runSweep();
    expect(h.files.get("file-sp-di-prd")).toMatchObject({ bucket: "BKT-CPV2", docType: "PRD", webUrl: PRD_URL });
    expect(h.buckets.find((b) => b.bucket.id === "BKT-CPV2")?.bucket.prd).toBe(PRD_URL);
    expect(h.buckets.find((b) => b.bucket.id === "BKT-OTHER")?.bucket.prd).toBeNull();
    // The re-queued bucket pushes PRDLink out to the Roadmap list in the same sweep.
    expect(h.roadmapPatches).toEqual([
      { itemId: "sp-BKT-CPV2", fields: expect.objectContaining({ PRDLink: PRD_URL }) },
    ]);
  });

  it("is idempotent: a second sweep neither re-links nor re-pushes", async () => {
    h.driveItems = [...folderItems, prdItem()];
    await runSweep();
    h.roadmapPatches.length = 0;
    await runSweep();
    expect(h.roadmapPatches).toEqual([]);
    expect(h.audits.filter((a) => a.includes("PRD linked"))).toHaveLength(1);
  });

  it("never replaces a PRD link a human set by hand", async () => {
    h.buckets = [bucket("BKT-CPV2", "Customer Portal v2", "https://example.com/hand-set")];
    h.driveItems = [...folderItems, prdItem()];
    await runSweep();
    expect(h.buckets[0].bucket.prd).toBe("https://example.com/hand-set");
    expect(h.files.get("file-sp-di-prd")).toMatchObject({ bucket: "BKT-CPV2", docType: "PRD" });
  });

  it("follows a re-uploaded PRD (new URL) when the link was written by the mirror", async () => {
    h.driveItems = [...folderItems, prdItem()];
    await runSweep();
    const v2 = `${PRD_URL}?v=2`;
    h.driveItems = [prdItem({ webUrl: v2 })]; // folders now come from the stored rows
    await runSweep();
    expect(h.buckets[0].bucket.prd).toBe(v2);
  });

  it("links an evidence bundle to its initiative and task without touching bucket.prd", async () => {
    h.driveItems = [
      ...folderItems,
      prdItem({
        id: "di-ev",
        name: "TASK-628-evidence.zip",
        webUrl: "https://x/ev.zip",
        parentReference: { id: "f-cpv2-ev" },
      }),
    ];
    await runSweep();
    expect(h.files.get("file-sp-di-ev")).toMatchObject({ bucket: "BKT-CPV2", docType: "Evidence", task: "TASK-628" });
    expect(h.buckets[0].bucket.prd).toBeNull();
  });

  it("leaves files outside an initiative folder unlinked", async () => {
    h.driveItems = [...folderItems, prdItem({ id: "di-s", parentReference: { id: "f-shared" } })];
    await runSweep();
    const entry = h.files.get("file-sp-di-s");
    expect(entry).toBeDefined();
    expect(entry).not.toHaveProperty("bucket");
    expect(h.buckets[0].bucket.prd).toBeNull();
  });
});

describe("link maintenance", () => {
  it("unlinks a file moved out of its initiative folder (merge-patch clears stale fields)", async () => {
    h.driveItems = [...folderItems, prdItem()];
    await runSweep();
    expect(h.files.get("file-sp-di-prd")).toMatchObject({ bucket: "BKT-CPV2", docType: "PRD" });
    h.driveItems = [prdItem({ parentReference: { id: "f-shared" } })];
    await runSweep();
    const entry = h.files.get("file-sp-di-prd");
    expect(entry?.bucket ?? null).toBeNull();
    expect(entry?.docType ?? null).toBeNull();
  });

  it("does not guess an initiative when the folder chain cannot be resolved", async () => {
    h.driveItems = [prdItem({ parentReference: { id: "f-unknown" } })];
    await runSweep();
    expect(h.files.get("file-sp-di-prd")?.bucket ?? null).toBeNull();
    expect(h.buckets[0].bucket.prd).toBeNull();
  });
});

describe("documentLinkFor", () => {
  const buckets = [{ id: "BKT-CPV2", name: "Customer Portal v2" }];
  it("ignores folders and unknown initiatives", () => {
    expect(
      documentLinkFor({ id: "f", name: "PRD", folder: {}, parentReference: { path: "/drives/d/root:/BKT-CPV2" } }, buckets)
    ).toEqual({});
    expect(
      documentLinkFor({ id: "f", name: "a.pdf", parentReference: { path: "/drives/d/root:/Nope/PRD" } }, buckets)
    ).toEqual({});
  });
});
