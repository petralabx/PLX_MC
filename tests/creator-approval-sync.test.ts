// TASK-3530 (astra-P1-1) — the creator-principal approval gate holds on the
// SharePoint side too. A pending task whose Status changes in SharePoint must
// not move into progress or later: the inbound pull raises a Sync conflict,
// keep-SP refuses the value, and the shared write boundary (repo.updateEntity)
// refuses the raw write. Each SharePoint refusal is a creator_approval.blocked
// event. Graph and the repo are in-memory fixtures; the engine runs for real.
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
  events: [] as { kind: string; actor: string; taskId?: string | null; payload?: Record<string, unknown> }[],
  deltas: {} as Record<string, { items: unknown[]; deltaLink: string }>,
}));

vi.mock("@/lib/db", () => ({ query: async () => [], withTransaction: async (fn: (q: unknown) => unknown) => fn(async () => []) }));

vi.mock("@/lib/compliance/repo", () => ({
  async appendEvent(e: (typeof h.events)[number]) {
    h.events.push(e);
    return String(h.events.length);
  },
  async appendEventTx(_q: unknown, e: (typeof h.events)[number]) {
    h.events.push(e);
    return String(h.events.length);
  },
}));

vi.mock("@/lib/sync/graph", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/sync/graph")>();
  return {
    ...real,
    siteContext: async () => ({
      siteId: "s",
      listIds: { todos: "t", risks: "r", roadmap: "roadmap", projects: "projects", reporegistry: "rr" },
    }),
    listDelta: async (_ctx: unknown, listKey: string) => h.deltas[listKey] ?? { items: [], deltaLink: `dl-${listKey}` },
    patchListItemFields: async () => {},
    createListItem: async () => "new-item",
    findItemByField: async () => null,
    resolveSiteUserLookupId: async () => null,
    resolveEmailByLookupId: async () => null,
  };
});

vi.mock("@/lib/sync/repo", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/sync/repo")>();
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
  // A TxQuery over the in-memory rows, so the REAL updateEntity (the shared
  // write boundary under test) reads and writes them.
  const fakeQuery = async (sql: string, params: unknown[] = []) => {
    const row = tasks.get(params[1] as string);
    if (sql.trimStart().startsWith("SELECT")) {
      return row ? [{ ...row, completed_at: null, cancellation: null }] : [];
    }
    if (sql.trimStart().startsWith("UPDATE") && row) {
      row.data = JSON.parse(params[2] as string);
      row.sync_state = params[3] as string;
      if (params[5]) row.dirty_fields = JSON.parse(params[5] as string);
      if (params[6]) row.field_attribution = JSON.parse(params[6] as string);
    }
    return [];
  };
  return {
    stamp: () => "2026.10.21 · 00:00",
    entityCount: async () => 1,
    getEntity: async (_t: string, id: string) => tasks.get(id) ?? null,
    getEntities: async (type: string) => (type === "task" ? [...tasks.values()] : []),
    insertEntity: async () => {},
    insertPushError: async () => {},
    updateEntity: (type: "task", id: string, opts: Parameters<typeof real.updateEntity>[2]) =>
      real.updateEntity(type, id, opts, fakeQuery as never),
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
    markRegisterInboundComplete: async () => {},
    getRegisterInboundCompletions: async () => ({}),
    countsByList: async () => ({}),
    seedRepos: async () => {},
    getRepos: async () => [],
    getBuckets: async () => [],
    getProjects: async () => [],
    getProjectRows: async () => [],
    getBucketRows: async () => [],
    getBucketBySpItemId: async () => null,
    seedBuckets: async () => {},
    seedProjects: async () => {},
  };
});

import { resolveConflict, runSweep } from "@/lib/sync/engine";
import * as repo from "@/lib/sync/repo";

const pending = { principal: "sp_mcp_workbench_intake", status: "pending", requestedAt: "2026-10-21T12:00:00.000Z" };

function seedTask(creatorApproval: unknown = pending) {
  h.tasks.set("TASK-9001", {
    entity_type: "task",
    id: "TASK-9001",
    data: { id: "TASK-9001", title: "intake task", stage: "planned", ...(creatorApproval ? { creatorApproval } : {}) },
    sync_state: "synced",
    sp_item_id: "11",
    dirty_fields: [],
    field_attribution: {},
  } satisfies Row);
}

// SharePoint: a human set the Status to In Progress.
function inboundStatus(status = "In Progress") {
  h.deltas.todos = {
    items: [
      {
        id: "11",
        fields: { TaskID: "TASK-9001", Title: "intake task", Status: status },
        lastModifiedBy: { user: { email: "human.fake@example.test" } },
        lastModifiedDateTime: "2026-10-21T10:00:00.000Z",
      },
    ],
    deltaLink: "dl-todos",
  };
}

const row = () => h.tasks.get("TASK-9001") as Row;
const blocked = () => h.events.filter((e) => e.kind === "creator_approval.blocked");

beforeEach(() => {
  h.tasks.clear();
  h.conflicts.length = 0;
  h.audits.length = 0;
  h.events.length = 0;
  h.deltas = {};
});

describe("astra-P1-1: SharePoint cannot move a task past a pending creator approval", () => {
  it("astra-P1-1: the shared write boundary refuses a raw stage write into progress", async () => {
    seedTask();
    await expect(repo.updateEntity("task", "TASK-9001", { patch: { stage: "progress" } })).rejects.toMatchObject({
      code: "creator_approval_pending",
      status: 409,
    });
    expect(row().data.stage).toBe("planned");
    // A move before progress, and any non-stage write, still go through.
    await repo.updateEntity("task", "TASK-9001", { patch: { stage: "approved", title: "renamed" } });
    expect(row().data).toMatchObject({ stage: "approved", title: "renamed" });
  });

  it("astra-P1-1: an inbound Status change raises a Sync conflict and a blocked event, not a stage move", async () => {
    seedTask();
    inboundStatus();

    const result = await runSweep("scribe");

    expect(row().data.stage).toBe("planned");
    expect(row().sync_state).toBe("conflict");
    expect(result.conflicts).toBe(1);
    const [conflict] = await repo.openConflicts();
    expect(conflict).toMatchObject({ entityId: "TASK-9001", field: "Status", mcVal: "planned", spVal: "progress" });
    expect(conflict!.note).toContain("creator approval");
    expect(blocked()).toHaveLength(1);
    expect(blocked()[0]).toMatchObject({
      taskId: "TASK-9001",
      actor: "scribe",
      payload: { action: "stage", requestedStage: "progress", creatorPrincipal: "sp_mcp_workbench_intake", door: "sharepoint" },
    });
  });

  it("astra-P1-1: keep-SP on that conflict is refused, audited, and leaves the conflict open", async () => {
    seedTask();
    inboundStatus();
    await runSweep("scribe");
    const [conflict] = await repo.openConflicts();
    h.events.length = 0;

    await expect(resolveConflict(conflict!.id, "sp", "oid-fake-human")).rejects.toMatchObject({
      code: "creator_approval_pending",
      status: 409,
    });

    expect(row().data.stage).toBe("planned");
    expect(await repo.openConflicts()).toHaveLength(1);
    expect(blocked()).toHaveLength(1);
    expect(blocked()[0]).toMatchObject({ actor: "oid-fake-human", payload: { requestedStage: "progress", door: "sync_conflict_keep_sp" } });
    expect(h.audits.at(-1)).toMatchObject({ actor: "oid-fake-human", state: "error" });
  });

  it("an approved task takes the same inbound Status change with no conflict", async () => {
    seedTask({ ...pending, status: "approved", approvedBy: "vince@petrasoap.com", approvedAt: "2026-10-21T13:00:00.000Z" });
    inboundStatus();

    const result = await runSweep("scribe");

    expect(result.conflicts).toBe(0);
    expect(row().data.stage).toBe("progress");
    expect(blocked()).toHaveLength(0);
  });
});
