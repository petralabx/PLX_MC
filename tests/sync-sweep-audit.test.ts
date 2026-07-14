// runSweep's audit discipline (the conditional "Sweep completed" row). Under the
// scheduled 5-min cron the common case is an idle sweep; it must NOT write an
// audit row (that would flood sync_audit_log), while a sweep that actually
// changed something still records one. The repo + graph + mapping seams are
// mocked in-memory (same technique as tests/mc-patch.test.ts), so this exercises
// the real runSweep orchestration without a live DB/Graph.

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  audits: [] as { actor: string; body: string; state: string }[],
  pending: { task: [] as Record<string, unknown>[], risk: [] as Record<string, unknown>[] },
  saved: [] as string[],
}));

vi.mock("@/lib/sync/graph", () => {
  class GraphError extends Error {}
  return {
    GraphError,
    siteContext: async () => ({ siteId: "s", listIds: { todos: "t", risks: "r" } }),
    listDelta: async () => ({ items: [], deltaLink: "dl" }),
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
  outboundFields: () => ({ Title: "x" }),
  inboundBucketPatches: () => ({}),
  inboundPatches: () => ({}),
  displayFieldFor: (_t: string, f: string) => f,
  displayValue: (v: unknown) => String(v ?? "—"),
  mcFieldFor: (_t: string, f: string) => f,
  parseFieldValue: () => undefined,
  reconcileInbound: () => ({ apply: {}, conflicts: [] }),
  // main's pushEntity resolves person columns before a push; an empty plan keeps
  // it a no-op (no Graph lookups) for these audit-discipline cases.
  planTaskPersons: () => ({ clear: [], resolve: [] }),
  actorIdByEmail: () => null,
  repoOutboundFields: () => ({}),
  projectOutboundFields: () => ({}),
  bucketOutboundFields: () => ({}),
  TASK_PERSON_FIELDS: [],
}));

vi.mock("@/lib/sync/repo", () => ({
  stamp: () => "2026.06.23 · 00:00",
  // Make ensureSeeded early-return (no fixture seeding side effects).
  entityCount: async () => 1,
  getEntity: async () => ({ id: "seed" }),
  insertEntity: async () => {},
  insertConflict: async () => {},
  insertPushError: async () => {},
  appendAudit: async (actor: string, body: string, state: string) => {
    h.audits.push({ actor, body, state });
  },
  getEntities: async (type: "task" | "risk" | "file") => (type === "file" ? [] : h.pending[type]),
  getDeltaLink: async () => null,
  saveDeltaLink: async (listKey: string) => {
    h.saved.push(listKey);
  },
  updateEntity: async () => {},
  countsByList: async () => ({}),
  // main's runSweep also seeds the repo registry and mirrors it; an empty
  // registry makes that a no-op so the "idle" sweep is genuinely idle.
  seedRepos: async () => {},
  getRepos: async () => [],
  getProjectRows: async () => [],
  getBucketRows: async () => [],
  getBucketBySpItemId: async () => null,
  seedBuckets: async () => {},
  seedProjects: async () => {},
  markRegisterInboundComplete: async () => {},
}));

// Imported AFTER the mocks so engine's repo/graph/mapping imports resolve to them.
import { runSweep } from "@/lib/sync/engine";

const SWEEP_ROW = "Sweep completed";

beforeEach(() => {
  h.audits.length = 0;
  h.pending.task = [];
  h.pending.risk = [];
  h.saved.length = 0;
});

describe("runSweep — conditional audit (no noise on idle sweeps)", () => {
  it("writes NO 'Sweep completed' row when nothing changed", async () => {
    const result = await runSweep("scribe");
    expect(result).toMatchObject({ pushed: 0, pulled: 0, conflicts: 0, pushErrors: 0 });
    expect(h.audits.find((a) => a.body.startsWith(SWEEP_ROW))).toBeUndefined();
    // ...but the heartbeat still advanced: both list cursors were re-saved.
    expect(h.saved).toEqual(expect.arrayContaining(["todos", "risks"]));
  });

  it("writes a 'Sweep completed' row when a pending entity is pushed", async () => {
    h.pending.task = [
      {
        entity_type: "task",
        id: "TASK-237",
        data: { title: "x" },
        sync_state: "pending",
        sp_item_id: "16",
        dirty_fields: ["title"],
      },
    ];
    const result = await runSweep("scribe");
    expect(result.pushed).toBe(1);
    const row = h.audits.find((a) => a.body.startsWith(SWEEP_ROW));
    expect(row).toBeDefined();
    expect(row!.body).toContain("1 outbound push");
  });
});
