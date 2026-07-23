// TASK-625 — partial-failure integration: Graph 429/5xx fault injection
// through the REAL runSweep + push-queue. One failing entity defers with
// backoff; the sweep completes for everything else and never aborts.

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  audits: [] as { actor: string; body: string; state: string }[],
  pending: { task: [] as Record<string, unknown>[], risk: [] as Record<string, unknown>[] },
  pushErrors: [] as Record<string, unknown>[],
  entityStates: new Map<string, string>(),
  patched: [] as string[],
  // Programmed faults: sp_item_id -> error to throw on patch.
  faults: new Map<string, Error>(),
  // In-memory outbound_push_retries ledger.
  retries: new Map<string, { attempts: number; nextAttemptAt: string }>(),
}));

vi.mock("@/lib/db", () => ({
  query: async (text: string, params: unknown[] = []) => {
    const sql = text.trimStart();
    if (!text.includes("outbound_push_retries")) return [];
    if (sql.startsWith("INSERT")) {
      const key = `${params[0]}:${params[1]}`;
      const row = h.retries.get(key);
      const attempts = (row?.attempts ?? 0) + 1;
      h.retries.set(key, { attempts, nextAttemptAt: String(params[2]) });
      return [{ attempts }];
    }
    if (sql.startsWith("UPDATE")) {
      const key = `${params[0]}:${params[1]}`;
      const row = h.retries.get(key);
      if (row) row.nextAttemptAt = String(params[2]);
      return [];
    }
    if (sql.startsWith("DELETE")) {
      h.retries.delete(`${params[0]}:${params[1]}`);
      return [];
    }
    if (sql.startsWith("SELECT")) {
      const cutoff = String(params[0]);
      return [...h.retries.entries()]
        .filter(([, row]) => row.nextAttemptAt > cutoff)
        .map(([key]) => {
          const [entity_kind, entity_id] = key.split(":");
          return { entity_kind, entity_id };
        });
    }
    return [];
  },
}));

vi.mock("@/lib/sync/graph", () => {
  class GraphError extends Error {
    constructor(
      public status: number,
      public body: string,
      url: string,
      public retryAfterMs?: number
    ) {
      super(`graph ${status} on ${url}`);
    }
  }
  return {
    GraphError,
    siteContext: async () => ({ siteId: "s", listIds: { todos: "t", risks: "r" } }),
    listDelta: async () => ({ items: [], deltaLink: "dl" }),
    patchListItemFields: async (_ctx: unknown, _list: string, itemId: string) => {
      const fault = h.faults.get(itemId);
      if (fault) throw fault;
      h.patched.push(itemId);
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

vi.mock("@/lib/sync/mapping", () => ({
  outboundFields: () => ({ Title: "x" }),
  inboundBucketPatches: () => ({}),
  inboundPatches: () => ({}),
  displayFieldFor: (_t: string, f: string) => f,
  displayValue: (v: unknown) => String(v ?? "—"),
  mcFieldFor: (_t: string, f: string) => f,
  parseFieldValue: () => undefined,
  reconcileInbound: () => ({ apply: {}, conflicts: [] }),
  planTaskPersons: () => ({ clear: [], resolve: [] }),
  actorIdByEmail: () => null,
  repoOutboundFields: () => ({}),
  projectOutboundFields: () => ({}),
  bucketOutboundFields: () => ({}),
  TASK_PERSON_FIELDS: [],
}));

vi.mock("@/lib/sync/repo", () => ({
  stamp: () => "2026.07.23 · 00:00",
  entityCount: async () => 1,
  getEntity: async () => ({ id: "seed" }),
  insertEntity: async () => {},
  insertConflict: async () => {},
  insertPushError: async (e: Record<string, unknown>) => {
    h.pushErrors.push(e);
  },
  appendAudit: async (actor: string, body: string, state: string) => {
    h.audits.push({ actor, body, state });
  },
  getEntities: async (type: "task" | "risk" | "file") => (type === "file" ? [] : h.pending[type]),
  getDeltaLink: async () => null,
  saveDeltaLink: async () => {},
  updateEntity: async (_type: string, id: string, opts: { syncState?: string }) => {
    if (opts.syncState) h.entityStates.set(id, opts.syncState);
  },
  countsByList: async () => ({}),
  seedRepos: async () => {},
  getRepos: async () => [],
  getProjectRows: async () => [],
  getBucketRows: async () => [],
  getBucketBySpItemId: async () => null,
  seedBuckets: async () => {},
  seedProjects: async () => {},
  markRegisterInboundComplete: async () => {},
}));

import { runSweep } from "@/lib/sync/engine";
import { GraphError } from "@/lib/sync/graph";
import { MAX_PUSH_ATTEMPTS } from "@/lib/sync/push-queue";

function pendingTask(id: string, spItemId: string): Record<string, unknown> {
  return {
    entity_type: "task",
    id,
    data: { title: id },
    sync_state: "pending",
    sp_item_id: spItemId,
    dirty_fields: ["title"],
  };
}

beforeEach(() => {
  h.audits.length = 0;
  h.pending.task = [];
  h.pending.risk = [];
  h.pushErrors.length = 0;
  h.entityStates.clear();
  h.patched.length = 0;
  h.faults.clear();
  h.retries.clear();
});

describe("runSweep under Graph 5xx fault injection (TASK-622/625)", () => {
  it("a 503 on one entity defers it and the sweep completes for the rest", async () => {
    h.pending.task = [pendingTask("TASK-1", "11"), pendingTask("TASK-2", "12")];
    h.faults.set("11", new GraphError(503, "service unavailable", "u"));

    const result = await runSweep("scribe");

    expect(result.pushed).toBe(1);
    expect(result.pushDeferred).toBe(1);
    expect(result.pushErrors).toBe(0);
    expect(h.patched).toEqual(["12"]);
    expect(h.retries.get("task:TASK-1")?.attempts).toBe(1);
    expect(h.audits.some((a) => a.body.includes("Push deferred for TASK-1"))).toBe(true);
    expect(h.audits.find((a) => a.body.startsWith("Sweep completed"))?.body).toContain(
      "1 deferred for retry"
    );
  });

  it("a deferred entity is skipped inside its backoff window on the next sweep", async () => {
    h.pending.task = [pendingTask("TASK-1", "11"), pendingTask("TASK-2", "12")];
    h.faults.set("11", new GraphError(503, "unavailable", "u"));
    await runSweep("scribe");

    h.faults.clear(); // Graph recovered — but TASK-1 is still inside backoff
    h.patched.length = 0;
    const second = await runSweep("scribe");

    expect(second.pushDeferred).toBe(1);
    expect(h.patched).toEqual(["12"]); // TASK-2 re-pushed; TASK-1 skipped
  });

  it("429 honors Retry-After for the deferral window", async () => {
    h.pending.task = [pendingTask("TASK-1", "11")];
    h.faults.set("11", new GraphError(429, "throttled", "u", 45 * 60_000));

    const result = await runSweep("scribe");

    expect(result.pushDeferred).toBe(1);
    const row = h.retries.get("task:TASK-1");
    expect(row).toBeDefined();
    expect(Date.parse(row!.nextAttemptAt)).toBeGreaterThan(Date.now() + 40 * 60_000);
  });

  it("4xx still parks in the error register without touching the retry ledger", async () => {
    h.pending.task = [pendingTask("TASK-1", "11")];
    h.faults.set("11", new GraphError(400, "bad field", "u"));

    const result = await runSweep("scribe");

    expect(result.pushErrors).toBe(1);
    expect(result.pushDeferred).toBe(0);
    expect(h.pushErrors).toHaveLength(1);
    expect(h.entityStates.get("TASK-1")).toBe("error");
    expect(h.retries.size).toBe(0);
  });

  it("exhausted retry budget parks the entity as a terminal push error", async () => {
    h.pending.task = [pendingTask("TASK-1", "11")];
    h.faults.set("11", new GraphError(503, "still down", "u"));
    h.retries.set("task:TASK-1", {
      attempts: MAX_PUSH_ATTEMPTS - 1,
      nextAttemptAt: new Date(Date.now() - 1000).toISOString(), // due now
    });

    const result = await runSweep("scribe");

    expect(result.pushErrors).toBe(1);
    expect(h.entityStates.get("TASK-1")).toBe("error");
    expect(h.pushErrors[0]?.reason).toContain("after 8 attempts");
    expect(h.retries.has("task:TASK-1")).toBe(false);
  });

  it("recovery: a successful push clears the retry ledger row", async () => {
    h.pending.task = [pendingTask("TASK-1", "11")];
    h.retries.set("task:TASK-1", {
      attempts: 2,
      nextAttemptAt: new Date(Date.now() - 1000).toISOString(), // window elapsed
    });

    const result = await runSweep("scribe");

    expect(result.pushed).toBe(1);
    expect(h.retries.size).toBe(0);
  });
});
