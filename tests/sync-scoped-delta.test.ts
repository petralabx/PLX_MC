// TASK-627/628 — targeted delta processing + Project Documents inbound.
// runScopedListDelta pulls ONE register; unknown keys make the queue runner
// fall back to a full sweep; the documents increment mirrors driveItems.

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  saved: [] as string[],
  registersCompleted: [] as string[],
  files: new Map<string, Record<string, unknown>>(),
  audits: [] as string[],
  driveId: "drive-1" as string | null,
  driveItems: [] as Record<string, unknown>[],
  fullSweeps: 0,
}));

vi.mock("@/lib/db", () => ({
  query: async () => [],
  withTransaction: async (fn: (q: unknown) => Promise<unknown>) => fn(async () => []),
}));

vi.mock("@/lib/sync/graph", () => {
  class GraphError extends Error {}
  return {
    GraphError,
    siteContext: async () => ({
      siteId: "s",
      listIds: { todos: "t", risks: "r", projects: "p", roadmap: "m", documents: "d" },
    }),
    listDelta: async (_ctx: unknown, listKey: string) => {
      h.saved.push(`delta:${listKey}`);
      return { items: [], deltaLink: `dl-${listKey}` };
    },
    documentsDriveId: async () => h.driveId,
    driveDelta: async () => ({ items: h.driveItems, deltaLink: "dl-documents" }),
    patchListItemFields: async () => {},
    createListItem: async () => "new-item",
    findItemByField: async () => null,
    REPO_REGISTRY_KEY: "reporegistry",
    PROJECTS_KEY: "projects",
    ROADMAP_KEY: "roadmap",
    resolveSiteUserLookupId: async () => null,
    resolveEmailByLookupId: async () => null,
  };
});

vi.mock("@/lib/sync/mapping", () => ({
  outboundFields: () => ({}),
  inboundBucketPatches: () => ({}),
  inboundProjectPatches: () => ({}),
  inboundPatches: () => ({}),
  displayFieldFor: (_t: string, f: string) => f,
  displayValue: (v: unknown) => String(v ?? "—"),
  mcFieldFor: (_t: string, f: string) => f,
  parseFieldValue: () => undefined,
  reconcileInbound: () => ({ apply: {}, conflicts: [], clearedDirty: [], attributionEvents: [] }),
  planTaskPersons: () => ({ clear: [], resolve: [] }),
  actorIdByEmail: () => null,
  repoOutboundFields: () => ({}),
  projectOutboundFields: () => ({}),
  bucketOutboundFields: () => ({}),
  validateInboundAdoptionRow: () => ({ ok: false }),
  ROUTING_TASK_FIELDS: [],
  ROUTING_BUCKET_FIELDS: [],
  ROUTING_PROJECT_FIELDS: [],
  TASK_PERSON_FIELDS: [],
}));

vi.mock("@/lib/sync/repo", () => ({
  stamp: () => "2026.07.23 · 00:00",
  entityCount: async () => 1,
  // Mirror rows use file-sp-* ids; fixture ids resolve as already-seeded so
  // ensureSeeded() early-returns instead of seeding the FILES fixtures here.
  getEntity: async (type: string, id: string) =>
    type === "file" && id.startsWith("file-sp-") ? (h.files.get(id) ?? null) : { id: "seed" },
  insertEntity: async (type: string, id: string, data: Record<string, unknown>) => {
    if (type === "file") h.files.set(id, data);
  },
  insertConflict: async () => {},
  insertPushError: async () => {},
  appendAudit: async (_actor: string, body: string) => {
    h.audits.push(body);
  },
  getEntities: async () => [],
  getDeltaLink: async () => null,
  saveDeltaLink: async (listKey: string) => {
    h.saved.push(`saved:${listKey}`);
  },
  updateEntity: async (type: string, id: string, opts: { patch?: Record<string, unknown> }) => {
    if (type === "file" && opts.patch) h.files.set(id, opts.patch);
  },
  countsByList: async () => ({}),
  seedRepos: async () => {},
  getRepos: async () => [],
  getProjectRows: async () => [],
  getBucketRows: async () => [],
  getBucketBySpItemId: async () => null,
  seedBuckets: async () => {},
  seedProjects: async () => {},
  markRegisterInboundComplete: async (listKey: string) => {
    h.registersCompleted.push(listKey);
  },
}));

import { runScopedListDelta } from "@/lib/sync/engine";
import { defaultScopedDeltaRunner } from "@/lib/sync/notification-queue";

beforeEach(() => {
  vi.unstubAllEnvs();
  h.saved.length = 0;
  h.registersCompleted.length = 0;
  h.files.clear();
  h.audits.length = 0;
  h.driveId = "drive-1";
  h.driveItems = [];
  h.fullSweeps = 0;
});

describe("runScopedListDelta (TASK-627)", () => {
  it("pulls exactly the notified register", async () => {
    const result = await runScopedListDelta("todos");
    expect(result).not.toBeNull();
    expect(h.saved).toContain("delta:todos");
    expect(h.saved).not.toContain("delta:risks");
    expect(h.registersCompleted).toEqual(["todos"]);
  });

  it("routes roadmap and projects keys to their pulls", async () => {
    await runScopedListDelta("roadmap");
    expect(h.registersCompleted).toContain("roadmap");
    await runScopedListDelta("projects");
    expect(h.registersCompleted).toContain("projects");
  });

  it("returns null for unknown keys (caller falls back to a full sweep)", async () => {
    expect(await runScopedListDelta("bogus-list")).toBeNull();
  });

  it("documents key requires the sync flag", async () => {
    expect(await runScopedListDelta("documents")).toBeNull();
    vi.stubEnv("PLX_MC_DOCUMENTS_SYNC_ENABLED", "1");
    const result = await runScopedListDelta("documents");
    expect(result).not.toBeNull();
    expect(h.registersCompleted).toContain("documents");
  });
});

describe("defaultScopedDeltaRunner fallback", () => {
  it("known key: scoped pull only, no full sweep", async () => {
    await defaultScopedDeltaRunner("todos", "sp_sync_inbound");
    expect(h.saved).toContain("delta:todos");
    // A full sweep would also walk risks.
    expect(h.saved).not.toContain("delta:risks");
  });

  it("unknown key: falls back to one full sweep (recovery)", async () => {
    await defaultScopedDeltaRunner("mystery", "sp_sync_inbound");
    expect(h.saved).toContain("delta:todos");
    expect(h.saved).toContain("delta:risks");
  });
});

describe("pullDocuments via scoped delta (TASK-628)", () => {
  beforeEach(() => {
    vi.stubEnv("PLX_MC_DOCUMENTS_SYNC_ENABLED", "1");
  });

  it("mirrors driveItems as file entities and persists the drive deltaLink", async () => {
    h.driveItems = [
      {
        id: "di-1",
        name: "PRD.docx",
        file: { mimeType: "application/vnd" },
        size: 2048,
        lastModifiedDateTime: "2026-07-22T10:00:00Z",
        lastModifiedBy: { user: { displayName: "Vince" } },
        parentReference: { id: "di-root" },
      },
      { id: "di-2", name: "Evidence", folder: {} },
    ];
    const result = await runScopedListDelta("documents");
    expect(result?.pulled).toBe(2);
    expect(h.files.get("file-sp-di-1")).toMatchObject({
      name: "PRD.docx",
      kind: "doc",
      modifiedBy: "Vince",
      size: "2.0 KB",
    });
    expect(h.files.get("file-sp-di-2")).toMatchObject({ kind: "folder" });
    expect(h.saved).toContain("saved:documents");
  });

  it("audits and skips deleted items — the mirror never deletes", async () => {
    h.driveItems = [{ id: "di-9", name: "old.pdf", deleted: { state: "deleted" } }];
    const result = await runScopedListDelta("documents");
    expect(result?.pulled).toBe(0);
    expect(result?.skipped).toBe(1);
    expect(h.files.size).toBe(0);
    expect(h.audits.some((a) => a.includes("Document removed in SharePoint"))).toBe(true);
  });

  it("skips with an honest audit when the library is not provisioned", async () => {
    h.driveId = null;
    const result = await runScopedListDelta("documents");
    expect(result?.pulled).toBe(0);
    expect(h.audits.some((a) => a.includes("not provisioned"))).toBe(true);
  });
});
