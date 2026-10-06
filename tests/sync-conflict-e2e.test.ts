// TASK-496 — conflict console E2E. A REAL inbound conflict (fake Graph delta
// through the real runSweep → reconcileInbound → insertConflict path; nothing
// is seeded into the queue) is listed by openConflicts, resolved through the
// real POST /api/sync/conflicts/{id}/resolve route + engine.resolveConflict,
// and leaves an audit trail. The Sync console renders the same conflict and
// stays fail-closed until freshness is confirmed.
//
// No live Graph or Postgres is used: Graph is a fixture and the repo is a
// stateful in-memory stand-in for the sync_conflicts / entities / audit tables.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = {
  entity_type: "task";
  id: string;
  data: Record<string, unknown>;
  sync_state: string;
  sp_item_id: string | null;
  dirty_fields: string[];
  field_attribution: Record<string, unknown>;
};
type StoredConflict = {
  id: string;
  entityType: string;
  entityId: string;
  field: string;
  mcVal: string;
  spVal: string;
  by: string;
  note: string;
  resolved: "mc" | "sp" | null;
};

const h = vi.hoisted(() => ({
  tasks: new Map<string, unknown>(),
  conflicts: [] as unknown[],
  audits: [] as { actor: string; body: string; state: string }[],
  completions: {} as Record<string, Date | null>,
  patched: [] as { itemId: string; fields: Record<string, unknown> }[],
  deltas: {} as Record<string, { items: unknown[]; deltaLink: string }>,
}));

// The push-queue retry ledger reads Postgres directly (bypassing the repo mock);
// keep the suite hermetic regardless of PLX_MC_DATABASE_URL.
vi.mock("@/lib/db", () => ({ query: async () => [] }));

vi.mock("@/lib/sync/graph", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/sync/graph")>();
  return {
    ...real,
    siteContext: async () => ({
      siteId: "s",
      listIds: { todos: "t", risks: "r", roadmap: "roadmap", projects: "projects", reporegistry: "rr" },
    }),
    listDelta: async (_ctx: unknown, listKey: string) =>
      h.deltas[listKey] ?? { items: [], deltaLink: `dl-${listKey}` },
    patchListItemFields: async (_ctx: unknown, _list: string, itemId: string, fields: Record<string, unknown>) => {
      h.patched.push({ itemId, fields });
    },
    createListItem: async () => "new-item",
    findItemByField: async () => null,
    resolveSiteUserLookupId: async () => null,
    resolveEmailByLookupId: async () => null,
  };
});

vi.mock("@/lib/sync/repo", () => {
  const tasks = h.tasks as Map<string, Row>;
  const conflicts = h.conflicts as StoredConflict[];
  const toSp = (c: StoredConflict) => ({
    id: c.id,
    list: "todos",
    entity: "Task" as const,
    entityId: c.entityId,
    field: c.field,
    mcVal: c.mcVal,
    spVal: c.spVal,
    detected: "00:00",
    by: c.by,
    note: c.note,
  });
  return {
    stamp: () => "2026.10.06 · 00:00",
    entityCount: async () => 1,
    getEntity: async (_t: string, id: string) => tasks.get(id) ?? null,
    getEntities: async (type: string) => (type === "task" ? [...tasks.values()] : []),
    insertEntity: async () => {},
    insertPushError: async () => {},
    updateEntity: async (
      _t: string,
      id: string,
      opts: {
        patch?: Record<string, unknown>;
        syncState?: string;
        dirtyFields?: string[];
        fieldAttribution?: Record<string, unknown>;
        spItemId?: string;
      }
    ) => {
      const row = tasks.get(id);
      if (!row) return;
      if (opts.patch) row.data = { ...row.data, ...opts.patch };
      if (opts.syncState) row.sync_state = opts.syncState;
      if (opts.dirtyFields) row.dirty_fields = opts.dirtyFields;
      if (opts.fieldAttribution) row.field_attribution = opts.fieldAttribution;
      if (opts.spItemId) row.sp_item_id = opts.spItemId;
    },
    insertConflict: async (c: Omit<StoredConflict, "resolved">) => {
      if (!conflicts.some((x) => x.id === c.id)) conflicts.push({ ...c, resolved: null });
    },
    openConflicts: async () => conflicts.filter((c) => !c.resolved).map(toSp),
    getConflict: async (id: string) => {
      const c = conflicts.find((x) => x.id === id && !x.resolved);
      return c ? { ...toSp(c), entityType: c.entityType } : null;
    },
    resolveConflictRow: async (id: string, winner: "mc" | "sp") => {
      const c = conflicts.find((x) => x.id === id);
      if (c) c.resolved = winner;
    },
    appendAudit: async (actor: string, body: string, state: string) => {
      h.audits.push({ actor, body, state });
    },
    getDeltaLink: async () => null,
    saveDeltaLink: async () => {},
    markRegisterInboundComplete: async (listKey: string) => {
      h.completions[listKey] = new Date();
    },
    getRegisterInboundCompletions: async () => ({ ...h.completions }),
    countsByList: async () => ({}),
    seedRepos: async () => {},
    getRepos: async () => [],
    getProjectRows: async () => [],
    getBucketRows: async () => [],
    getBucketBySpItemId: async () => null,
    seedBuckets: async () => {},
    seedProjects: async () => {},
  };
});

// Session auth is out of scope here; the engine's resolveConflict stays real.
vi.mock("@/lib/sync/engine", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/sync/engine")>();
  return {
    ...real,
    requireSyncMutateActor: async () => ({ oid: "oid-vince", actor: {} }),
  };
});

import { SyncConsole } from "@/components/mc/sync-console";
import { SYNC_STALE_BANNER } from "@/components/mc/sync-console.freshness";
import { GET as freshnessGet } from "@/app/api/sync/freshness/route";
import { POST as resolvePost } from "@/app/api/sync/conflicts/[id]/resolve/route";
import { __setOpenConflictsForTests, resetStore } from "@/lib/mc-data/store";
import { runSweep } from "@/lib/sync/engine";
import * as repo from "@/lib/sync/repo";

const noParams = { params: Promise.resolve({}) };

function seedLocallyEditedTask() {
  h.tasks.set("TASK-9001", {
    entity_type: "task",
    id: "TASK-9001",
    data: { id: "TASK-9001", title: "MC title" },
    sync_state: "pending",
    sp_item_id: "11",
    dirty_fields: ["title"],
    field_attribution: {},
  } satisfies Row);
  // SharePoint: a human edited the same Title since MC changed it.
  h.deltas.todos = {
    items: [
      {
        id: "11",
        fields: { TaskID: "TASK-9001", Title: "SP title" },
        lastModifiedBy: { user: { email: "human@petrasoap.com" } },
        lastModifiedDateTime: "2026-10-06T10:00:00.000Z",
      },
    ],
    deltaLink: "dl-todos",
  };
}

async function resolve(id: string, winner: "mc" | "sp") {
  return resolvePost(
    new Request(`http://test/api/sync/conflicts/${id}/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ winner }),
    }),
    { params: Promise.resolve({ id }) }
  );
}

const render = () => renderToStaticMarkup(createElement(SyncConsole, { nav: () => {} } as never));

beforeEach(() => {
  h.tasks.clear();
  h.conflicts.length = 0;
  h.audits.length = 0;
  h.patched.length = 0;
  h.deltas = {};
  h.completions = {};
  resetStore();
});

describe("inbound conflict → openConflicts → resolve → audit (fixture Graph, no live SharePoint)", () => {
  it("the real sweep raises the conflict (the queue starts empty, nothing is seeded)", async () => {
    expect(await repo.openConflicts()).toEqual([]);
    seedLocallyEditedTask();

    const result = await runSweep("scribe");

    expect(result.conflicts).toBe(1);
    const open = await repo.openConflicts();
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({
      entityId: "TASK-9001",
      field: "Title",
      mcVal: "MC title",
      spVal: "SP title",
      by: "scribe",
    });
    expect((h.tasks.get("TASK-9001") as Row).sync_state).toBe("conflict");
    expect(h.audits.some((a) => a.state === "conflict" && a.body.includes("Conflict detected on TASK-9001"))).toBe(true);
  });

  it("keep SharePoint through the route applies the value, closes the conflict and audits the human", async () => {
    seedLocallyEditedTask();
    await runSweep("scribe");
    const [conflict] = await repo.openConflicts();

    const resp = await resolve(conflict!.id, "sp");

    expect(resp.status).toBe(200);
    expect(await repo.openConflicts()).toEqual([]);
    const row = h.tasks.get("TASK-9001") as Row;
    expect(row.data.title).toBe("SP title");
    expect(row.sync_state).toBe("synced");
    expect(row.dirty_fields).toEqual([]);
    expect(h.patched).toEqual([]); // keep-SP never writes back to SharePoint
    const audit = h.audits.at(-1)!;
    expect(audit.actor).toBe("oid-vince");
    expect(audit.body).toContain("Resolved conflict on TASK-9001 · Title — kept SharePoint");
    // Detection precedes resolution in the trail.
    const detected = h.audits.findIndex((a) => a.body.includes("Conflict detected on TASK-9001"));
    expect(detected).toBeGreaterThanOrEqual(0);
    expect(detected).toBeLessThan(h.audits.length - 1);
  });

  it("keep Mission Control pushes the MC value to SharePoint and audits the human", async () => {
    seedLocallyEditedTask();
    await runSweep("scribe");
    const [conflict] = await repo.openConflicts();

    const resp = await resolve(conflict!.id, "mc");

    expect(resp.status).toBe(200);
    expect(await repo.openConflicts()).toEqual([]);
    expect(h.patched).toHaveLength(1);
    expect(h.patched[0]).toMatchObject({ itemId: "11", fields: { Title: "MC title" } });
    const row = h.tasks.get("TASK-9001") as Row;
    expect(row.data.title).toBe("MC title");
    expect(row.sync_state).toBe("synced");
    const audit = h.audits.at(-1)!;
    expect(audit.actor).toBe("oid-vince");
    expect(audit.body).toContain("kept Mission Control");
  });

  it("an already-resolved conflict 404s and adds no second resolution audit", async () => {
    seedLocallyEditedTask();
    await runSweep("scribe");
    const [conflict] = await repo.openConflicts();
    await resolve(conflict!.id, "sp");
    const auditCount = h.audits.length;

    const again = await resolve(conflict!.id, "mc");

    expect(again.status).toBe(404);
    expect(h.audits).toHaveLength(auditCount);
  });
});

describe("Sync console human path over the live queue (fail-closed staleness)", () => {
  it("renders the swept conflict with resolutions paused while freshness is unknown", async () => {
    seedLocallyEditedTask();
    await runSweep("scribe");
    // The console hydrates this same list from GET /api/state → repo.openConflicts().
    __setOpenConflictsForTests(await repo.openConflicts());

    const html = render(); // first paint: freshness not yet confirmed

    expect(html).toContain("Conflict · TASK-9001 Title");
    expect(html).toContain("MC title");
    expect(html).toContain("SP title");
    expect(html).toContain('data-testid="sync-stale-banner"');
    expect(html).toContain(SYNC_STALE_BANNER);
    const resolveButtons = html.match(/<button[^>]*>(?:Keep Mission Control|Keep SharePoint)<\/button>/g) ?? [];
    expect(resolveButtons).toHaveLength(2);
    for (const button of resolveButtons) expect(button).toContain("disabled");
  });

  it("freshness endpoint is stale before any sweep and ok after a complete inbound sweep", async () => {
    const before = await (await freshnessGet(new Request("http://test/api/sync/freshness"), noParams)).json();
    expect(before.data.ok).toBe(false);
    expect(before.data.code).toBe("sync_stale");

    seedLocallyEditedTask();
    await runSweep("scribe");

    const after = await (await freshnessGet(new Request("http://test/api/sync/freshness"), noParams)).json();
    expect(after.data.ok).toBe(true);
  });
});
