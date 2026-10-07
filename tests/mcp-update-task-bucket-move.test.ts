// Exercise real actions, auth, ACL, sync patch/repo and mc_events writer.
// Only database I/O is faked; no live database, Graph or SharePoint calls.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EntityRow } from "@/lib/sync/repo";
import type { TxQuery } from "@/lib/db";
import type { McpIdentity } from "@/lib/mcp/auth";

const h = vi.hoisted(() => ({
  rows: new Map<string, EntityRow>(),
  events: [] as { kind: string; actor: string; repo: string; taskId: string; payload: Record<string, unknown> }[],
  syncAudits: [] as unknown[][],
  queries: [] as { sql: string; transaction: boolean }[],
  failEvent: false,
  invocation: vi.fn(async () => "1000"),
}));

vi.mock("@/lib/permissions/decision-log", () => ({ recordPermissionDecision: vi.fn(async () => true) }));
vi.mock("@/lib/mcp/audit", () => ({ recordMcpToolCall: h.invocation }));
vi.mock("@/lib/db", () => {
  async function execute(sql: string, params: unknown[] = [], transaction = false) {
    h.queries.push({ sql, transaction });
    if (!transaction) throw new Error("Update requested a second pool connection");
    if (sql.includes("FROM buckets ORDER BY")) return [
      { id: "BKT-OPEN", data: { id: "BKT-OPEN", project: null } },
      { id: "BKT-PROJECT", data: { id: "BKT-PROJECT", project: "PRJ-OPEN" } },
      { id: "BKT-SECRET", data: { id: "BKT-SECRET", project: "PRJ-SECRET" } },
      { id: "BKT-OTHER", data: { id: "BKT-OTHER", project: null } },
      { id: "BKT-ARCHIVED", data: { id: "BKT-ARCHIVED", project: null, archived: true } },
      { id: "BKT-CLOSEDPRJ", data: { id: "BKT-CLOSEDPRJ", project: "PRJ-CLOSED" } },
      { id: "BKT-ORPHAN", data: { id: "BKT-ORPHAN", project: "PRJ-GONE" } },
    ];
    if (sql.includes("FROM projects ORDER BY")) return [
      { id: "PRJ-OPEN", data: { id: "PRJ-OPEN", visibility: "shared", members: [] } },
      { id: "PRJ-CLOSED", data: { id: "PRJ-CLOSED", visibility: "shared", members: [], status: "closed" } },
      { id: "PRJ-SECRET", data: { id: "PRJ-SECRET", visibility: "restricted", members: ["someone-else@petrasoap.com"] } },
    ];
    if (sql.includes("FROM entities WHERE")) {
      const row = h.rows.get(String(params[1]));
      return row ? [structuredClone(row)] : [];
    }
    if (sql.startsWith("UPDATE entities")) {
      if (!transaction) throw new Error("Task write escaped transaction");
      const id = String(params[1]);
      const row = h.rows.get(id)!;
      h.rows.set(id, {
        ...row, data: JSON.parse(String(params[2])),
        sync_state: params[3] as EntityRow["sync_state"],
        dirty_fields: JSON.parse(String(params[5])),
        field_attribution: JSON.parse(String(params[6])),
      });
      return [];
    }
    if (sql.startsWith("INSERT INTO sync_audit_log")) {
      if (!transaction) throw new Error("Sync audit escaped transaction");
      h.syncAudits.push(params);
      return [];
    }
    if (sql.startsWith("INSERT INTO mc_events")) {
      if (!transaction) throw new Error("Event escaped transaction");
      if (h.failEvent) { h.failEvent = false; throw new Error("Simulated audit failure"); }
      h.events.push({
        kind: String(params[0]), actor: String(params[1]), repo: String(params[2]),
        taskId: String(params[3]), payload: JSON.parse(String(params[5])),
      });
      return [{ seq: String(h.events.length) }];
    }
    throw new Error("Unexpected SQL: " + sql);
  }
  // Serial execution models the PostgreSQL row lock. Assertions below also
  // require the production SELECT FOR UPDATE, on the transaction connection.
  let pending = Promise.resolve();
  return {
    query: (sql: string, params?: unknown[]) => execute(sql, params),
    withTransaction: async <T,>(fn: (q: TxQuery) => Promise<T>): Promise<T> => {
      const previous = pending;
      let release!: () => void;
      pending = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      const rows = structuredClone(h.rows);
      const events = structuredClone(h.events);
      const audits = structuredClone(h.syncAudits);
      try {
        return await fn(((sql: string, params?: unknown[]) => execute(sql, params, true)) as TxQuery);
      } catch (err) {
        h.rows = rows;
        h.events = events;
        h.syncAudits = audits;
        throw err;
      } finally {
        release();
      }
    },
  };
});

import { outboundFields } from "@/lib/sync/mapping";
import { actionUpdateTask, actionUpdateTasks } from "@/lib/mcp/task-update-actions";
import { bucketMoveTargetViolation } from "@/lib/sync/bucket-move";

const identity: McpIdentity = {
  operatorEmail: "vince@petrasoap.com", runtime: "codex", workerId: "move-test",
  repo: "petralabx/PLX_MC", servicePrincipalId: "sp_mcp_codex",
  actor: { kind: "service", id: "sp_mcp_codex", status: "active" },
};

function seed(id: string, overrides: Record<string, unknown> = {}) {
  h.rows.set(id, {
    entity_type: "task", id, sp_item_id: "1", sync_state: "synced", dirty_fields: [], field_attribution: {},
    data: {
      id, bucket: "BKT-OPEN", stage: "backlog", labels: [], title: "Legacy", description: "d", priority: "medium",
      prs: [{ url: "https://example.com/pr/1" }], evidence: { items: [] },
      sync: { state: "synced", ts: "before", sp: "ToDos · item 1" }, ...overrides,
    },
  });
}
const update = (patch: unknown, taskId = "TASK-1") => actionUpdateTask(identity, { taskId, patch });

beforeEach(() => {
  vi.stubEnv("PLX_MC_PERMISSIONS_ENFORCEMENT", "off");
  h.rows.clear(); h.events.length = 0; h.syncAudits.length = 0; h.queries.length = 0; h.failEvent = false;
  seed("TASK-1");
});
afterEach(() => vi.unstubAllEnvs());

describe("lane rule for closure labels (TASK-2533)", () => {
  it("lets a lane-less backlog task gain closed:obsolete but not a non-closure label", async () => {
    await expect(update({ addLabels: ["closed:obsolete"] })).resolves.toMatchObject({ taskId: "TASK-1" });
    expect(h.rows.get("TASK-1")!.data.labels).toEqual(["closed:obsolete"]);
    seed("TASK-1");
    await expect(update({ addLabels: ["needs-vince"] })).rejects.toThrow(/exactly one non-empty lane/);
    await expect(update({ addLabels: ["closed:obsolete", "needs-vince"] })).rejects.toThrow(/exactly one non-empty lane/);
    expect(h.rows.get("TASK-1")!.data.labels).toEqual([]);
  });
  it("accepts every allowlisted closure label and allows removing one", async () => {
    for (const label of ["closed:duplicate", "closed:obsolete", "closed:superseded", "closed:delivered", "closed:wontfix", "not-needed"]) {
      seed("TASK-1");
      await expect(update({ addLabels: [label] })).resolves.toBeTruthy();
    }
    seed("TASK-1", { labels: ["closed:wontfix"] });
    await expect(update({ removeLabels: ["closed:wontfix"] })).resolves.toBeTruthy();
  });
  it("rejects a second lane on any task, even a terminal one", async () => {
    seed("TASK-1", { labels: ["lane:codex"] });
    await expect(update({ addLabels: ["lane:cos"] })).rejects.toThrow();
    seed("TASK-1", { stage: "merged", labels: ["lane:codex"] });
    await expect(update({ addLabels: ["lane:cos"] })).rejects.toThrow();
  });
  it("does not let a laned task drop its lane via a closure label", async () => {
    seed("TASK-1", { labels: ["lane:codex"] });
    await expect(update({ removeLabels: ["lane:codex"], addLabels: ["closed:obsolete"] })).rejects.toThrow();
  });
  it("lets a lane-less merged task take closure and other labels", async () => {
    seed("TASK-1", { stage: "merged" });
    await expect(update({ addLabels: ["closed:delivered", "needs-vince"] })).resolves.toBeTruthy();
    seed("TASK-1", { stage: "verified" });
    await expect(update({ labels: ["anything"] })).resolves.toBeTruthy();
  });
});

describe("task bucket move (TASK-2533)", () => {
  it("moves between open buckets, keeps stage/labels/PRs, audits task.moved and queues the ToDos push", async () => {
    seed("TASK-1", { stage: "planned", labels: ["x"], note: undefined });
    const before = structuredClone(h.rows.get("TASK-1")!.data);
    const out = await update({ bucket: "BKT-OTHER", note: "legacy cleanup" });
    expect(out.diff).toEqual({ bucket: { before: "BKT-OPEN", after: "BKT-OTHER" } });
    const row = h.rows.get("TASK-1")!;
    expect(row.data).toMatchObject({ bucket: "BKT-OTHER", stage: "planned", labels: ["x"], prs: before.prs, evidence: before.evidence });
    expect(row.sync_state).toBe("pending");
    expect(row.dirty_fields).toContain("bucket");
    expect(h.events.map((e) => e.kind)).toEqual(["task.updated", "task.moved"]);
    expect(h.events[1].payload).toMatchObject({ from: "BKT-OPEN", to: "BKT-OTHER", actor: "codex:vince@petrasoap.com", note: "legacy cleanup" });
    // Bucket counts derive from task rows, so the old/new counts follow the move.
    const counts = (id: string) => [...h.rows.values()].filter((r) => r.data.bucket === id).length;
    expect([counts("BKT-OPEN"), counts("BKT-OTHER")]).toEqual([0, 1]);
    expect(outboundFields("task", row.data, { only: row.dirty_fields, initiativeLookupId: 7 })).toMatchObject({ InitiativeLookupId: 7 });
  });
  it("moves a lane-less legacy task by bucket alone", async () => {
    await expect(update({ bucket: "BKT-OTHER" })).resolves.toBeTruthy();
    await expect(update({ bucket: "BKT-OPEN", title: "Also retitled" })).rejects.toThrow(/lane/);
  });
  it("does not record task.moved when the bucket is unchanged", async () => {
    await update({ bucket: "BKT-OPEN" });
    expect(h.events.map((e) => e.kind)).toEqual(["task.updated"]);
  });
  it("rejects nonexistent, archived, closed-project and unknown-project targets without writing", async () => {
    for (const bucket of ["BKT-NOPE", "BKT-ARCHIVED", "BKT-CLOSEDPRJ", "BKT-ORPHAN"]) {
      await expect(update({ bucket })).rejects.toMatchObject({ code: "invalid_request" });
    }
    expect(h.rows.get("TASK-1")!.data.bucket).toBe("BKT-OPEN");
    expect(h.events).toEqual([]);
  });
  it("rejects a restricted target without access and a restricted source", async () => {
    await expect(update({ bucket: "BKT-SECRET" })).rejects.toMatchObject({ code: "project_acl_denied" });
    seed("TASK-S", { bucket: "BKT-SECRET" });
    await expect(update({ bucket: "BKT-OTHER" }, "TASK-S")).rejects.toMatchObject({ code: "project_acl_denied" });
    expect(h.rows.get("TASK-S")!.data.bucket).toBe("BKT-SECRET");
  });
  it("rejects malformed bucket ids and a note without bucket", async () => {
    await expect(update({ bucket: "other" })).rejects.toMatchObject({ code: "invalid_request" });
    await expect(update({ note: "x" })).rejects.toMatchObject({ code: "invalid_request" });
  });
  it("isolates bad moves in a batch while valid items commit", async () => {
    seed("TASK-2"); seed("TASK-3"); seed("TASK-4");
    const out = await actionUpdateTasks(identity, { items: [
      { taskId: "TASK-1", patch: { bucket: "BKT-OTHER" } },
      { taskId: "TASK-2", patch: { bucket: "BKT-NOPE" } },
      { taskId: "TASK-3", patch: { bucket: "BKT-ARCHIVED" } },
      { taskId: "TASK-4", patch: { bucket: "BKT-SECRET" } },
      { taskId: "TASK-1", patch: { addLabels: ["closed:obsolete"] } },
    ] });
    expect(out).toMatchObject({ updated: 2, failed: 3 });
    expect(out.results.map((r) => r.ok)).toEqual([true, false, false, false, true]);
    expect(h.rows.get("TASK-1")!.data).toMatchObject({ bucket: "BKT-OTHER", labels: ["closed:obsolete"] });
    expect(["TASK-2", "TASK-3", "TASK-4"].map((id) => h.rows.get(id)!.data.bucket)).toEqual(["BKT-OPEN", "BKT-OPEN", "BKT-OPEN"]);
  });
});

describe("bucketMoveTargetViolation feature guards", () => {
  const bucket = { id: "BKT-A", project: "PRJ-A" } as never;
  it("ignores archive/closed signals the records do not expose yet", () => {
    expect(bucketMoveTargetViolation(bucket, { id: "PRJ-A" } as never)).toBeNull();
  });
  it("enforces them once present", () => {
    expect(bucketMoveTargetViolation({ id: "BKT-A", archivedAt: "2026-10-01" } as never, undefined)).toMatch(/archived/);
    expect(bucketMoveTargetViolation(bucket, { id: "PRJ-A", status: "closed" } as never)).toMatch(/closed/);
    expect(bucketMoveTargetViolation(undefined, undefined)).toMatch(/unknown bucket/);
  });
});
