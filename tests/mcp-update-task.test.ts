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
  allowPool: false,
  invocation: vi.fn(async () => "1000"),
}));

vi.mock("@/lib/permissions/decision-log", () => ({ recordPermissionDecision: vi.fn(async () => true) }));
vi.mock("@/lib/mcp/audit", () => ({ recordMcpToolCall: h.invocation }));
vi.mock("@/lib/db", () => {
  async function execute(sql: string, params: unknown[] = [], transaction = false) {
    h.queries.push({ sql, transaction });
    if (!transaction && !h.allowPool) throw new Error("Update requested a second pool connection");
    if (sql.includes("FROM buckets ORDER BY")) return [
      { id: "BKT-OPEN", data: { id: "BKT-OPEN", project: null } },
      { id: "BKT-PROJECT", data: { id: "BKT-PROJECT", project: "PRJ-OPEN" } },
      { id: "BKT-SECRET", data: { id: "BKT-SECRET", project: "PRJ-SECRET" } },
    ];
    if (sql.includes("FROM projects ORDER BY")) return [
      { id: "PRJ-OPEN", data: { id: "PRJ-OPEN", visibility: "shared", members: [] } },
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
      if (!transaction && !h.allowPool) throw new Error("Event escaped transaction");
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

import { POST as mcpPost } from "@/app/api/cursor/mcp/route";
import { POST as updateRoute } from "@/app/api/cursor/tasks/update/route";
import { POST as batchRoute } from "@/app/api/cursor/tasks/update-batch/route";
import { actionUpdateTask } from "@/lib/mcp/task-update-actions";
import { outboundFields } from "@/lib/sync/mapping";

const identity: McpIdentity = {
  operatorEmail: "vince@petrasoap.com", runtime: "codex", workerId: "update-test",
  repo: "petralabx/PLX_MC", servicePrincipalId: "sp_mcp_codex",
  actor: { kind: "service", id: "sp_mcp_codex", status: "active" },
};

function seed(id = "TASK-1", overrides: Record<string, unknown> = {}) {
  h.rows.set(id, {
    entity_type: "task", id, sp_item_id: "1", sync_state: "synced", dirty_fields: [], field_attribution: {},
    data: {
      id, bucket: "BKT-OPEN", stage: "planned", labels: ["lane:codex", "old"],
      title: "Original", description: "Original description", priority: "medium",
      evidence: { items: [{ done: true, label: "existing proof" }] }, prs: [{ url: "https://example.com/pr/1" }],
      comments: [{ body: "Lane: lane:codex · Depends on: TASK-2" }],
      sync: { state: "synced", ts: "before", sp: "ToDos · item 1" },
      ...overrides,
    },
  });
}

function headers(key = "codex-key") {
  return {
    "content-type": "application/json", accept: "application/json, text/event-stream",
    "x-api-key": key, "x-mc-operator-email": identity.operatorEmail,
    "x-mc-repo": identity.repo, "x-mc-runtime": identity.runtime, "x-mc-worker-id": identity.workerId,
  };
}
// Parsed wire results vary across success, validation and batch errors.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = Record<string, any>;
async function call(transport: "MCP" | "REST", tool: string, args: unknown, key = "codex-key") {
  if (transport === "MCP") {
    const response = await mcpPost(new Request("http://localhost/api/cursor/mcp", {
      method: "POST", headers: headers(key),
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tool, arguments: args } }),
    }));
    if (!response.ok) return { ok: false, status: response.status, body: await response.json() as Body };
    const json = await response.json();
    const result = json.result;
    let body: Body;
    try { body = JSON.parse(result.content[0].text); }
    catch { body = { validation: result.content[0].text }; }
    return { ok: result.isError !== true, status: null, body };
  }
  const route = tool === "mc_update_tasks" ? batchRoute : updateRoute;
  const response = await route(new Request("http://localhost/api/cursor/tasks/update", {
    method: "POST", headers: headers(key), body: JSON.stringify(args),
  }), { params: Promise.resolve({}) });
  return { ok: response.ok, status: response.status, body: await response.json() as Body };
}

beforeEach(() => {
  vi.stubEnv("PLX_MC_MCP_ENABLED", "1");
  vi.stubEnv("PLX_MC_MCP_API_KEY", "");
  vi.stubEnv("PLX_MC_MCP_AGENT_KEYS", JSON.stringify({ sp_mcp_codex: "codex-key", sp_mcp_portal: "portal-key" }));
  vi.stubEnv("PLX_MC_ALLOWED_USERS", "vince@petrasoap.com");
  vi.stubEnv("PLX_MC_PERMISSIONS_ENFORCEMENT", "off");
  h.rows.clear(); h.events.length = 0; h.syncAudits.length = 0; h.queries.length = 0;
  h.failEvent = false; h.allowPool = false; h.invocation.mockClear();
  seed();
});
afterEach(() => vi.unstubAllEnvs());

for (const transport of ["MCP", "REST"] as const) {
  describe("task updates via " + transport, () => {
    const update = (patch: unknown, taskId = "TASK-1") => call(transport, "mc_update_task", { taskId, patch });
    it("patches metadata, persists the exact actor/diff row and queues only pushed fields", async () => {
      const before = structuredClone(h.rows.get("TASK-1")!.data);
      const result = await update({ title: " Renamed ", description: "New description", priority: "high", addLabels: ["new"] });
      expect(result.ok).toBe(true);
      const diff = {
        title: { before: "Original", after: "Renamed" },
        description: { before: "Original description", after: "New description" },
        priority: { before: "medium", after: "high" },
        labels: { before: ["lane:codex", "old"], after: ["lane:codex", "old", "new"] },
      };
      expect(result.body.data.diff).toEqual(diff);
      expect(h.events).toEqual([{
        kind: "task.updated", actor: "codex:vince@petrasoap.com", repo: "petralabx/PLX_MC", taskId: "TASK-1",
        payload: { servicePrincipalId: "sp_mcp_codex", workerId: "update-test", diff },
      }]);
      const row = h.rows.get("TASK-1")!;
      expect(row.sync_state).toBe("pending");
      expect(row.dirty_fields.sort()).toEqual(["description", "priority", "title"]);
      expect(row.field_attribution.title).toMatchObject({ source: "service", actorId: "sp_mcp_codex" });
      expect(row.data).toMatchObject({ stage: before.stage, evidence: before.evidence, prs: before.prs, comments: before.comments });
      expect(h.queries.some((q) => q.transaction && q.sql.endsWith("FOR UPDATE"))).toBe(true);
      expect(h.invocation).toHaveBeenCalledWith(expect.objectContaining({ tool: "mc_update_task", ok: true, taskId: "TASK-1" }));
      expect(outboundFields("task", row.data, { only: row.dirty_fields })).not.toHaveProperty("Labels");
    });
    it("refuses cancel and reopen from a task.progress-only principal that forges an allowlisted admin email (TASK-2529)", async () => {
      h.allowPool = true; // a denial is audited on its own connection, before any transaction
      for (const patch of [{ cancel: { reason: "obsolete" } }, { reopen: {} }]) {
        const result = await update(patch);
        expect(result.ok).toBe(false);
        expect(JSON.stringify(result.body)).toMatch(/forbidden|denied/);
      }
      expect(h.rows.get("TASK-1")!.data.stage).toBe("planned");
      expect(h.events.map((e) => e.kind)).toEqual(["task.cancel_denied", "task.reopen_denied"]);
    });
    it("adds, removes, trims and deduplicates labels without queuing SharePoint", async () => {
      expect((await update({ addLabels: [" new ", "new"], removeLabels: [" old "] })).ok).toBe(true);
      const row = h.rows.get("TASK-1")!;
      expect(row.data.labels).toEqual(["lane:codex", "new"]);
      expect(row.sync_state).toBe("synced");
      expect(row.dirty_fields).toEqual([]);
      expect(h.syncAudits).toEqual([]);
      expect(h.events).toHaveLength(1);
    });
    it("preserves an already queued push during a labels-only edit", async () => {
      const row = h.rows.get("TASK-1")!;
      row.sync_state = "pending"; row.dirty_fields = ["due"];
      expect((await update({ addLabels: ["new"] })).ok).toBe(true);
      expect(h.rows.get("TASK-1")!.dirty_fields).toEqual(["due"]);
      expect(h.rows.get("TASK-1")!.sync_state).toBe("pending");
    });
    it("replaces the entire label set and allows a lane replacement in one incremental call", async () => {
      expect((await update({ labels: ["lane:ledger", " replace ", "replace"] })).ok).toBe(true);
      expect(h.rows.get("TASK-1")!.data.labels).toEqual(["lane:ledger", "replace"]);
      expect((await update({ removeLabels: ["lane:ledger"], addLabels: ["lane:cos"] })).ok).toBe(true);
      expect(h.rows.get("TASK-1")!.data.labels).toEqual(["replace", "lane:cos"]);
    });
    it("rejects a second lane without writing either the task or the audit", async () => {
      expect((await update({ addLabels: ["lane:cos"] })).ok).toBe(false);
      expect(h.rows.get("TASK-1")!.data.labels).toEqual(["lane:codex", "old"]);
      expect(h.events).toEqual([]);
    });
    it("requires one lane, including when backfilling an unlabeled legacy task", async () => {
      seed("TASK-1", { labels: [] });
      expect((await update({ title: "No lane" })).ok).toBe(false);
      expect((await update({ addLabels: ["lane:ledger"], title: "Has lane" })).ok).toBe(true);
      expect((await update({ removeLabels: ["lane:ledger"] })).ok).toBe(false);
    });
    it("appends description with two newlines and allows clearing by replacement", async () => {
      expect((await update({ appendDescription: " Next " })).ok).toBe(true);
      expect(h.rows.get("TASK-1")!.data.description).toBe("Original description\n\nNext");
      expect((await update({ description: "" })).ok).toBe(true);
      expect((await update({ appendDescription: "First" })).ok).toBe(true);
      expect(h.rows.get("TASK-1")!.data.description).toBe("First");
    });
    it("audits a no-op with an empty diff and does not enqueue it", async () => {
      expect((await update({ title: "Original", addLabels: ["old"] })).ok).toBe(true);
      expect(h.events[0].payload.diff).toEqual({});
      expect(h.rows.get("TASK-1")!.sync_state).toBe("synced");
      expect(h.queries.filter((q) => q.sql.startsWith("UPDATE"))).toEqual([]);
    });
    for (const [name, patch] of Object.entries({
      empty: {}, blankLabel: { addLabels: [" "] }, longLabel: { addLabels: ["x".repeat(129)] },
      tooManyLabels: { labels: ["lane:codex", ...Array.from({ length: 100 }, (_, i) => "l" + i)] },
      blankLane: { labels: ["lane:"] }, noLane: { labels: [] },
      labelModes: { labels: ["lane:codex"], addLabels: [] },
      removeMode: { labels: ["lane:codex"], removeLabels: [] },
      descriptionModes: { description: "", appendDescription: "x" },
      blankTitle: { title: " " }, longTitle: { title: "x".repeat(256) },
      wrongPriority: { priority: "critical" }, nullPriority: { priority: null },
      blankAppend: { appendDescription: " " }, longDescription: { description: "x".repeat(32_001) },
    })) {
      it("rejects invalid patch: " + name, async () => {
        expect((await update(patch)).ok).toBe(false);
        expect(h.events).toEqual([]);
        expect(h.queries.filter((q) => q.sql.startsWith("UPDATE"))).toEqual([]);
      });
    }
    for (const field of ["stage", "evidence", "checkout", "checkoutId", "checkoutRef", "checkouts", "verified", "accountableOwner"]) {
      it("rejects forbidden field " + field + " in the patch and at the top level", async () => {
        expect((await update({ title: "Invalid", [field]: "verified" })).ok).toBe(false);
        expect((await call(transport, "mc_update_task", { taskId: "TASK-1", patch: { title: "Invalid" }, [field]: "verified" })).ok).toBe(false);
        expect(h.events).toEqual([]);
        expect(h.rows.get("TASK-1")!.data.title).toBe("Original");
      });
    }
    it("limits the resulting description, not just the appended text", async () => {
      seed("TASK-1", { description: "x".repeat(32_000) });
      expect((await update({ appendDescription: "x" })).ok).toBe(false);
      expect(h.events).toEqual([]);
    });
    it("caps the resulting label set but permits a deduplicated no-op at the cap", async () => {
      seed("TASK-1", { labels: ["lane:codex", ...Array.from({ length: 99 }, (_, i) => "l" + i)] });
      expect((await update({ addLabels: ["l0"] })).ok).toBe(true);
      expect((await update({ addLabels: ["new"] })).ok).toBe(false);
    });
    it("returns not_found for an unknown task", async () => {
      const out = await update({ title: "Missing" }, "TASK-MISSING");
      expect(out.body).toMatchObject({ error: { code: "not_found" } });
      if (transport === "REST") expect(out.status).toBe(404);
      expect(h.events).toEqual([]);
    });
    it("denies restricted projects, missing keys and the portal principal", async () => {
      seed("TASK-1", { bucket: "BKT-SECRET" });
      const hidden = await update({ title: "Secret" });
      expect(hidden.ok).toBe(false);
      expect(hidden.body.error.code).toBe("project_acl_denied");
      seed();
      for (const tool of ["mc_update_task", "mc_update_tasks"]) {
        const args = tool === "mc_update_task" ? { taskId: "TASK-1", patch: { title: "Bad" } } : { items: [{ taskId: "TASK-1", patch: { title: "Bad" } }] };
        expect((await call(transport, tool, args, "portal-key")).body.error.code).toBe("forbidden");
        expect((await call(transport, tool, args, "bad-key")).status).toBe(401);
      }
      expect(h.events).toEqual([]);
    });
    it("rolls back the patch, sync queue and sync audit when event writing fails", async () => {
      const before = structuredClone(h.rows.get("TASK-1"));
      h.failEvent = true;
      const out = await update({ title: "Rollback", addLabels: ["new"] });
      expect(out.ok).toBe(false);
      expect(out.body.error.code).toBe("internal");
      expect(h.rows.get("TASK-1")).toEqual(before);
      expect(h.events).toEqual([]);
      expect(h.syncAudits).toEqual([]);
    });
    it("isolates invalid, unknown and unauthorized batch items and continues in order", async () => {
      seed("TASK-SECRET", { bucket: "BKT-SECRET" });
      const out = await call(transport, "mc_update_tasks", { items: [
        { taskId: "TASK-1", patch: { addLabels: ["first"] } },
        { taskId: "TASK-1", patch: { stage: "verified" } },
        null,
        { taskId: "TASK-MISSING", patch: { title: "Missing" } },
        { taskId: "TASK-SECRET", patch: { title: "Secret" } },
        { taskId: "TASK-1", patch: { removeLabels: ["old"], addLabels: ["last"] } },
      ] });
      expect(out.ok).toBe(true);
      expect(out.body.data).toMatchObject({ updated: 2, failed: 4 });
      expect(out.body.data.results.map((r: Body) => [r.index, r.ok])).toEqual([[0, true], [1, false], [2, false], [3, false], [4, false], [5, true]]);
      expect(out.body.data.results.slice(1, 5).map((r: Body) => r.error.code)).toEqual(["invalid_request", "invalid_request", "not_found", "project_acl_denied"]);
      expect(h.rows.get("TASK-1")!.data.labels).toEqual(["lane:codex", "first", "last"]);
      expect(h.events).toHaveLength(2);
    });
    it("isolates an internal batch failure and commits the next item", async () => {
      seed("TASK-2");
      h.failEvent = true;
      const out = await call(transport, "mc_update_tasks", { items: [
        { taskId: "TASK-1", patch: { title: "Rolled back" } },
        { taskId: "TASK-2", patch: { title: "Committed" } },
      ] });
      expect(out.body.data).toMatchObject({ updated: 1, failed: 1 });
      expect(out.body.data.results[0]).toMatchObject({ ok: false, error: { code: "internal" } });
      expect(h.rows.get("TASK-1")!.data.title).toBe("Original");
      expect(h.rows.get("TASK-2")!.data.title).toBe("Committed");
      expect(h.events).toHaveLength(1);
    });
    it("accepts the 99-task Ledger backfill without pushing labels to SharePoint", async () => {
      const items = Array.from({ length: 99 }, (_, i) => {
        const taskId = "TASK-" + (i + 1);
        seed(taskId, { labels: [] });
        return { taskId, patch: { addLabels: ["lane:codex", "depends-on:TASK-2"] } };
      });
      const out = await call(transport, "mc_update_tasks", { items });
      expect(out.body.data).toMatchObject({ updated: 99, failed: 0 });
      expect(h.events).toHaveLength(99);
      expect([...h.rows.values()].every((row) => row.sync_state === "synced" && row.dirty_fields.length === 0)).toBe(true);
      expect(h.syncAudits).toEqual([]);
    });
    it("returns compact receipts so a 100-item batch of large descriptions stays under the response cap", async () => {
      const big = "x".repeat(32_000);
      const items = Array.from({ length: 100 }, (_, i) => {
        seed("TASK-" + (i + 1), { description: "" });
        return { taskId: "TASK-" + (i + 1), patch: { description: big } };
      });
      const out = await call(transport, "mc_update_tasks", { items });
      expect(out.body.data).toMatchObject({ updated: 100, failed: 0 });
      expect(out.body.data.results[0]).toEqual({ index: 0, ok: true, taskId: "TASK-1", changed: ["description"], eventSeq: "1" });
      // Vercel caps responses at 4.5 MB; the full diff lives in the task.updated event.
      expect(JSON.stringify(out.body).length).toBeLessThan(100_000);
      expect(h.events[0].payload.diff).toMatchObject({ description: { after: big } });
    });
    it("rejects empty and over-limit batches before writes", async () => {
      for (const items of [[], Array(101).fill({ taskId: "TASK-1", patch: { title: "No" } })]) {
        expect((await call(transport, "mc_update_tasks", { items })).ok).toBe(false);
      }
      expect(h.events).toEqual([]);
    });
  });
}

describe("update authorization and locked incremental edits", () => {
  it("keeps task, hierarchy and audit queries on one transaction connection", async () => {
    seed("TASK-1", { bucket: "BKT-PROJECT" });
    await expect(actionUpdateTask(identity, { taskId: "TASK-1", patch: { title: "Single connection" } })).resolves.toMatchObject({ taskId: "TASK-1" });
    expect(h.queries.every((query) => query.transaction)).toBe(true);
    expect(h.queries.some((query) => query.sql.includes("FROM projects"))).toBe(true);
    expect(h.events).toHaveLength(1);
  });

  it("refuses revoked and ungranted service actors before opening a transaction", async () => {
    for (const actor of [
      { kind: "service", id: "sp_mcp_codex", status: "revoked" },
      { kind: "service", id: "sp_sync_inbound", status: "active" },
    ] as const) {
      await expect(actionUpdateTask({ ...identity, actor }, { taskId: "TASK-1", patch: { title: "Denied" } })).rejects.toMatchObject({ code: "forbidden" });
    }
    expect(h.queries).toEqual([]);
  });
  it("computes each incremental diff from the locked predecessor", async () => {
    await Promise.all([
      actionUpdateTask(identity, { taskId: "TASK-1", patch: { addLabels: ["first"], appendDescription: "First" } }),
      actionUpdateTask(identity, { taskId: "TASK-1", patch: { addLabels: ["second"], appendDescription: "Second" } }),
    ]);
    expect(h.rows.get("TASK-1")!.data.labels).toEqual(["lane:codex", "old", "first", "second"]);
    expect(h.rows.get("TASK-1")!.data.description).toBe("Original description\n\nFirst\n\nSecond");
    expect(h.events[1].payload.diff).toMatchObject({
      labels: { before: ["lane:codex", "old", "first"], after: ["lane:codex", "old", "first", "second"] },
    });
    // Per edit: the action's predecessor lock, then updateEntity's own row lock (same transaction).
    expect(h.queries.filter((q) => q.sql.endsWith("FOR UPDATE"))).toHaveLength(4);
  });
});
