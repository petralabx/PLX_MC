// Exercise real actions, auth, ACL, sync patch/repo and mc_events writer.
// Only database I/O is faked; no live database, Graph or SharePoint calls.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EntityRow } from "@/lib/sync/repo";
import type { TxQuery } from "@/lib/db";
import type { McpIdentity } from "@/lib/mcp/auth";
import { needsHuman } from "@/components/mc/project-overview.helpers";

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
import {
  BATCH_FINDINGS_PER_ITEM_MAX, BATCH_FINDINGS_TOTAL_MAX, BATCH_FINDING_MESSAGE_MAX, CLOSURE_LABELS, actionUpdateTask,
  staleCloseUatTicketTx,
} from "@/lib/mcp/task-update-actions";
import { cancelContextFor } from "@/lib/mcp/task-cancel-actions";
import { withTransaction } from "@/lib/db";
import { outboundFields } from "@/lib/sync/mapping";
import { STAGES, STAGE_IDX, countTaskProgress } from "@/lib/mc-data";
import type { Task } from "@/lib/mc-data";

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
    // TASK-4313: the portal now holds task.progress like sp_mcp_cip, so it is
    // no longer refused a plain metadata patch here.
    it("denies restricted projects and missing keys", async () => {
      seed("TASK-1", { bucket: "BKT-SECRET" });
      const hidden = await update({ title: "Secret" });
      expect(hidden.ok).toBe(false);
      expect(hidden.body.error.code).toBe("project_acl_denied");
      seed();
      for (const tool of ["mc_update_task", "mc_update_tasks"]) {
        const args = tool === "mc_update_task" ? { taskId: "TASK-1", patch: { title: "Bad" } } : { items: [{ taskId: "TASK-1", patch: { title: "Bad" } }] };
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

// TASK-3165: on a task a person must verify, the description text that an
// agent writes is held to STE-lite. Warn-only until 2026-10-24, then refused.
describe("task description evidence standard (TASK-3165)", () => {
  const long = `${Array.from({ length: 30 }, (_, i) => `word${i}`).join(" ")}.`;
  const update = (patch: unknown) => call("REST", "mc_update_task", { taskId: "TASK-1", patch });
  const at = (iso: string) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(iso));
  };
  afterEach(() => vi.useRealTimers());

  it("warns during the week and still writes the description", async () => {
    at("2026-10-20T12:00:00Z");
    seed("TASK-1", { labels: ["lane:codex", "verify:human"] });
    const result = await update({ description: long });
    expect(result.ok).toBe(true);
    expect(result.body.data.evidenceStandard).toMatchObject({ applies: true, mode: "warn" });
    expect(h.rows.get("TASK-1")!.data.description).toBe(long);
  });

  it("refuses the edit after the week and leaves the task as it was", async () => {
    at("2026-10-25T12:00:00Z");
    seed("TASK-1", { labels: ["lane:codex", "verify:human"] });
    const result = await update({ description: long });
    expect(result).toMatchObject({ ok: false, status: 400, body: { error: { code: "evidence_standard" } } });
    expect(h.rows.get("TASK-1")!.data.description).toBe("Original description");
    expect(h.events.filter((e) => e.kind === "task.updated")).toEqual([]);
  });

  it("checks a task that gains verify:human in the same edit, and skips one that needs no verification", async () => {
    at("2026-10-25T12:00:00Z");
    expect((await update({ description: long, addLabels: ["verify:human"] })).ok).toBe(false);
    const plain = await update({ description: long });
    expect(plain.ok).toBe(true);
    expect(plain.body.data.evidenceStandard).toBeUndefined();
  });

  it("checks only the appended text, not the description already there", async () => {
    at("2026-10-25T12:00:00Z");
    seed("TASK-1", { labels: ["lane:codex", "kind:human-test"], description: long });
    expect((await update({ appendDescription: "Open the Goals screen. Check the totals." })).ok).toBe(true);
    expect((await update({ appendDescription: long })).ok).toBe(false);
  });
});

describe("batch description evidence standard (TASK-3165)", () => {
  afterEach(() => vi.useRealTimers());
  it("returns the warn-week report in each mc_update_tasks receipt", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-20T12:00:00Z"));
    seed("TASK-1", { labels: ["lane:codex", "verify:human"] });
    const long = `${Array.from({ length: 30 }, (_, i) => `word${i}`).join(" ")}.`;
    const result = await call("REST", "mc_update_tasks", { items: [{ taskId: "TASK-1", patch: { description: long } }] });
    expect(result.ok).toBe(true);
    expect(result.body.data.results[0]).toMatchObject({ ok: true, evidenceStandard: { applies: true, mode: "warn" } });
  });
});

// Sol review of PR #352: the findings are advice during the warn week and some
// stay advice after it, so the writes commit. The receipts must stay far below
// Vercel's 4.5 MB response cap, or the client sees a failure after the writes.
describe("batch evidence findings stay small (TASK-3165)", () => {
  const n = (count: number) => Array.from({ length: count }, (_, i) => `word${i + 1}`).join(" ");
  afterEach(() => vi.useRealTimers());
  const batch = async (description: string) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-20T12:00:00Z"));
    const ids = Array.from({ length: 100 }, (_, i) => `TASK-${i + 1}`);
    for (const id of ids) seed(id, { labels: ["lane:codex", "verify:human"] });
    const result = await call("REST", "mc_update_tasks", { items: ids.map((taskId) => ({ taskId, patch: { description } })) });
    expect(result.ok).toBe(true);
    expect(result.body.data.updated).toBe(100);
    for (const id of ids) expect(h.rows.get(id)!.data.description).toBe(description);
    return result;
  };

  it("caps the findings of a full batch of 30,800-character descriptions, and says how many there were", async () => {
    const description = "- It was fixed.\n".repeat(1925);
    expect(description).toHaveLength(30_800);
    const result = await batch(description);
    expect(JSON.stringify(result.body).length).toBeLessThan(1_000_000);
    const [first, last] = [result.body.data.results[0], result.body.data.results[99]];
    expect(first.evidenceStandard).toMatchObject({ applies: true, mode: "warn", findingsTotal: 1925, findingsTruncated: true });
    expect(first.evidenceStandard.findings).toHaveLength(BATCH_FINDINGS_PER_ITEM_MAX);
    expect(last.evidenceStandard).toMatchObject({ findings: [], findingsTotal: 1925, findingsTruncated: true });
    expect(result.body.data.evidenceFindings).toEqual({ total: 192_500, returned: BATCH_FINDINGS_TOTAL_MAX, truncated: true });
  });

  it("shortens a long finding message, so one very long word cannot grow the receipt", async () => {
    const description = `It was ${"x".repeat(15_000)}ed ${n(30)}.\n\n`.repeat(2);
    const result = await batch(description);
    expect(JSON.stringify(result.body).length).toBeLessThan(1_000_000);
    const { findings } = result.body.data.results[0].evidenceStandard;
    expect(findings.length).toBeGreaterThan(0);
    for (const finding of findings) expect(finding.message.length).toBeLessThanOrEqual(BATCH_FINDING_MESSAGE_MAX);
  });

  it("returns every finding, untruncated, when they fit", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-20T12:00:00Z"));
    seed("TASK-1", { labels: ["lane:codex", "verify:human"] });
    const result = await call("REST", "mc_update_tasks", { items: [{ taskId: "TASK-1", patch: { description: `${n(30)}. It was fixed.` } }] });
    expect(result.body.data.results[0].evidenceStandard).toMatchObject({ findingsTotal: 2, findingsTruncated: false, findings: [{ rule: "sentence-length" }, { rule: "passive-voice" }] });
    expect(result.body.data.evidenceFindings).toEqual({ total: 2, returned: 2, truncated: false });
  });
});

// TASK-3407: assignee and accountable owner through the API, with an audited reason.
describe("assignee and accountable owner (TASK-3407)", () => {
  const steward: McpIdentity = {
    ...identity, runtime: "cursor", servicePrincipalId: "sp_mcp_ledger", agent: "cursor/ledger",
    actor: { kind: "service", id: "sp_mcp_ledger", status: "active" },
  };
  const reason = "Ledger re-owns per CoS on 2026-10-20";

  it("lets a task.assign holder set both, records the reason and names the lane", async () => {
    await actionUpdateTask(steward, { taskId: "TASK-1", patch: { assignee: "stephen", accountableOwner: "Stephen@PetraSoap.com", reason } });
    expect(h.rows.get("TASK-1")!.data).toMatchObject({ assignee: "stephen", accountableOwner: "stephen" });
    const ev = h.events.find((e) => e.kind === "task.assignment.changed")!;
    expect(ev.actor).toBe("cursor/ledger:vince@petrasoap.com");
    expect(ev.payload).toMatchObject({
      assignee: { before: null, after: "stephen" },
      accountableOwner: { before: null, after: "stephen" },
      reason,
    });
  });

  it("clears the assignee with null, even on a lane-less task", async () => {
    seed("TASK-1", { labels: [], assignee: "stephen" });
    await actionUpdateTask(steward, { taskId: "TASK-1", patch: { assignee: null, reason } });
    expect(h.rows.get("TASK-1")!.data.assignee).toBeNull();
  });

  it("refuses a principal without task.assign", async () => {
    h.allowPool = true;
    await expect(actionUpdateTask(identity, { taskId: "TASK-1", patch: { accountableOwner: "stephen", reason } }))
      .rejects.toMatchObject({ code: "forbidden" });
    expect(h.rows.get("TASK-1")!.data.accountableOwner).toBeUndefined();
  });

  it("requires a reason, and an accountable owner who is a person", async () => {
    await expect(actionUpdateTask(steward, { taskId: "TASK-1", patch: { accountableOwner: "stephen" } }))
      .rejects.toMatchObject({ code: "invalid_request" });
    await expect(actionUpdateTask(steward, { taskId: "TASK-1", patch: { accountableOwner: "cos@petrasoap.com", reason } }))
      .rejects.toMatchObject({ code: "invalid_request" });
    await expect(actionUpdateTask(steward, { taskId: "TASK-1", patch: { title: "x", reason } }))
      .rejects.toMatchObject({ code: "invalid_request" });
  });

  it("refuses an agent: assignee that names no registered agent principal", async () => {
    h.allowPool = true;
    await expect(actionUpdateTask(steward, { taskId: "TASK-1", patch: { assignee: "agent:claude-uat", reason } }))
      .rejects.toMatchObject({ code: "forbidden" });
  });

  it("never puts an agent: executor on a human-only task (EN-003)", async () => {
    seed("TASK-1", { humanOnly: true });
    await expect(actionUpdateTask(steward, { taskId: "TASK-1", patch: { assignee: "agent:lane_claude_uat", reason } }))
      .rejects.toMatchObject({ message: expect.stringContaining("human-only") });
    expect(h.rows.get("TASK-1")!.data.assignee).toBeUndefined();
  });

  it("lets a task.assign holder name a registered agent principal (TASK-4005 c)", async () => {
    await actionUpdateTask(steward, { taskId: "TASK-1", patch: { assignee: "agent:lane_claude_uat", reason } });
    expect(h.rows.get("TASK-1")!.data.assignee).toBe("agent:lane_claude_uat");
    expect(h.events.find((e) => e.kind === "task.assignment.changed")!.payload).toMatchObject({
      assignee: { before: null, after: "agent:lane_claude_uat" },
    });
  });
});

// TASK-3697: the portal mirrors a ticket onto its UAT ticket task (kind:code
// plus uat:<feedbackId>, no lane until Steward leases it). The portal key holds
// task.uat_sync and not task.progress; the codex key is an ordinary agent.
describe("UAT ticket task mirror (TASK-3697)", () => {
  const uat = (id: string, overrides: Record<string, unknown> = {}) => seed(id, {
    labels: ["kind:code", "uat:cmfb7q2xk0001", "uat-attempt:1", "repo:petralabx/plx-customer-portal"],
    stage: "backlog", accountableOwner: "vince@petrasoap.com", ...overrides,
  });
  const portal = (patch: unknown, taskId = "TASK-UAT", transport: "MCP" | "REST" = "REST") =>
    call(transport, "mc_update_task", { taskId, patch }, "portal-key");
  const agent = (patch: unknown, taskId = "TASK-UAT") => call("REST", "mc_update_task", { taskId, patch });
  const data = (id = "TASK-UAT") => h.rows.get(id)!.data as unknown as Task;
  beforeEach(() => uat("TASK-UAT"));

  for (const transport of ["MCP", "REST"] as const) {
    it("lets the portal add uat:hold, replay it, and remove it on a lane-less UAT ticket task via " + transport, async () => {
      expect((await portal({ addLabels: ["uat:hold"] }, "TASK-UAT", transport)).ok).toBe(true);
      expect(data().labels).toContain("uat:hold");
      // An outbox retry of the same mirror succeeds and changes nothing.
      const replay = await portal({ addLabels: ["uat:hold"] }, "TASK-UAT", transport);
      expect(replay.ok).toBe(true);
      expect(replay.body.data.diff).toEqual({});
      expect((await portal({ removeLabels: ["uat:hold"], addLabels: ["uat-attempt:2"] }, "TASK-UAT", transport)).ok).toBe(true);
      expect(data().labels).toEqual(["kind:code", "uat:cmfb7q2xk0001", "uat-attempt:1", "repo:petralabx/plx-customer-portal", "uat-attempt:2"]);
      expect(h.events.map((e) => e.kind)).toEqual(["task.updated", "task.updated", "task.updated"]);
      expect(h.events[0].payload.servicePrincipalId).toBe("sp_mcp_portal");
      expect(h.rows.get("TASK-UAT")!.sync_state).toBe("synced");
    });
  }

  it("lets the portal cancel a lane-less UAT ticket task without task.cancel", async () => {
    const result = await portal({ cancel: { reason: "obsolete", note: "Staff rejected ticket R5JD2K" } });
    expect(result.ok).toBe(true);
    expect(result.body.data.diff).toEqual({ stage: { before: "backlog", after: "cancelled" } });
    expect(data().stage).toBe("cancelled");
    expect(h.events).toEqual([expect.objectContaining({
      kind: "task.cancelled", taskId: "TASK-UAT",
      payload: expect.objectContaining({ reason: "obsolete", previousStage: "backlog", cancelledBy: "sp_mcp_portal", servicePrincipalId: "sp_mcp_portal" }),
    })]);
  });

  it("lets the portal verify a merged UAT ticket task: it shows Verified and the rollup counts it done", async () => {
    uat("TASK-UAT", { stage: "merged" });
    // Merged, waiting for the submitter's re-test: in progress, not done.
    expect(countTaskProgress([data()])).toMatchObject({ done: 0, inProgress: 1, remaining: 1 });
    const result = await portal({ verify: { note: "Submitter pressed Works now on R5JD2K" } });
    expect(result.ok).toBe(true);
    expect(result.body.data.diff).toEqual({ stage: { before: "merged", after: "verified" } });
    expect(data().stage).toBe("verified");
    expect(STAGES[STAGE_IDX[data().stage]].name).toBe("Verified");
    expect(countTaskProgress([data()])).toMatchObject({ done: 1, inProgress: 0, remaining: 0, pctDone: 1 });
    expect(h.events).toEqual([{
      kind: "task.verified", actor: "codex:vince@petrasoap.com", repo: "petralabx/PLX_MC", taskId: "TASK-UAT",
      payload: {
        servicePrincipalId: "sp_mcp_portal", workerId: "update-test",
        previousStage: "merged", verifiedBy: "sp_mcp_portal", note: "Submitter pressed Works now on R5JD2K",
      },
    }]);
    expect(h.rows.get("TASK-UAT")!.dirty_fields).toContain("stage");
    // Verified again changes nothing and writes nothing, so a retried mirror succeeds.
    const replay = await portal({ verify: {} });
    expect(replay.ok).toBe(true);
    expect(replay.body.data.diff).toEqual({});
    expect(h.events).toHaveLength(1);
  });

  it("keeps the evidence gate on verify: 409 stage_blocked, which a retry cannot fix", async () => {
    uat("TASK-UAT", { stage: "merged", evidence: { summary: "x", items: [{ key: "rollback", done: false, label: "Rollback plan" }] } });
    const result = await portal({ verify: {} });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe("stage_blocked");
    expect(data().stage).toBe("merged");
    expect(h.events).toEqual([]);
  });

  it("treats a replayed portal cancel as done, not as a conflict", async () => {
    expect((await portal({ cancel: { reason: "obsolete" } })).ok).toBe(true);
    const replay = await portal({ cancel: { reason: "obsolete" } });
    expect(replay.ok).toBe(true);
    expect(replay.body.data.diff).toEqual({});
    expect(h.events.map((e) => e.kind)).toEqual(["task.cancelled"]);
  });

  it("refuses a portal label edit that would stop the task being a UAT ticket task", async () => {
    for (const patch of [{ removeLabels: ["kind:code"] }, { removeLabels: ["kind:code"], addLabels: ["kind:decision"] }]) {
      const result = await portal(patch);
      expect({ patch, ok: result.ok, code: result.body.error?.code }).toEqual({ patch, ok: false, code: "forbidden" });
    }
    expect(data().labels).toContain("kind:code");
    expect(h.events).toEqual([]);
  });

  it("refuses to verify a UAT ticket task whose fix has not merged", async () => {
    uat("TASK-UAT", { stage: "review" });
    const result = await portal({ verify: {} });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe("not_merged");
    expect(data().stage).toBe("review");
    expect(h.events).toEqual([]);
  });

  it("never lets an agent verify a task, and audits the attempt", async () => {
    h.allowPool = true; // the denial is audited on its own connection, before the transaction
    uat("TASK-UAT", { stage: "merged" });
    const result = await agent({ verify: {} });
    expect(result.ok).toBe(false);
    expect(result.body.error.code).toBe("forbidden");
    expect(result.body.error.message).toContain("task.uat_sync");
    expect(data().stage).toBe("merged");
    expect(h.events.map((e) => e.kind)).toEqual(["task.verify_denied"]);
  });

  it("lets an agent add and remove uat:hold on a lane-less UAT ticket task, but not other labels", async () => {
    expect((await agent({ addLabels: ["uat:hold"] })).ok).toBe(true);
    expect((await agent({ removeLabels: ["uat:hold"] })).ok).toBe(true);
    expect((await agent({ addLabels: ["needs-review-later"] })).ok).toBe(false);
    // A lane-less task that is not a UAT ticket task still needs a lane for uat:hold.
    seed("TASK-1", { labels: ["kind:code"] });
    const plain = await agent({ addLabels: ["uat:hold"] }, "TASK-1");
    expect(plain.ok).toBe(false);
    expect(plain.body.error.code).toBe("invalid_request");
    expect(h.events).toHaveLength(2);
  });

  // TASK-3967: Steward marks a ticket it gave up on before any lane is leased.
  it("lets Steward block a lane-less UAT ticket task with uat:blocked and uat:cause:<x> alone, and clear it", async () => {
    uat("TASK-UAT", { stage: "backlog", accountableOwner: "vince" });
    expect(needsHuman(data())).toBe(false);
    expect((await agent({ addLabels: ["uat:blocked", "uat:cause:quota"] })).ok).toBe(true);
    expect(data().labels).toEqual(expect.arrayContaining(["uat:blocked", "uat:cause:quota"]));
    expect(needsHuman(data())).toBe(true);
    expect((await agent({ removeLabels: ["uat:blocked", "uat:cause:quota"] })).ok).toBe(true);
    expect(data().labels).toEqual(["kind:code", "uat:cmfb7q2xk0001", "uat-attempt:1", "repo:petralabx/plx-customer-portal"]);
    // An empty cause, or a block on a task that is not a UAT ticket task, still needs a lane.
    expect((await agent({ addLabels: ["uat:cause:"] })).ok).toBe(false);
    seed("TASK-1", { labels: ["kind:code"] });
    const plain = await agent({ addLabels: ["uat:blocked"] }, "TASK-1");
    expect(plain.ok).toBe(false);
    expect(plain.body.error.code).toBe("invalid_request");
    expect(h.events).toHaveLength(2);
  });

  // TASK-4313: the portal holds task.progress like sp_mcp_cip, so title,
  // description, priority and bucket patches take the normal path. A verify,
  // cancel or label-only patch from it is still held to the mirror rules. A
  // reopen needs task.reopen, which neither it nor sp_mcp_cip holds.
  it("refuses the portal every other mirror patch, and every task that is not a UAT ticket task", async () => {
    uat("TASK-UAT", { stage: "merged" });
    for (const patch of [ { addLabels: ["lane:claude-uat"] }, { addLabels: ["uat:blocked"] }, { addLabels: ["uat:cause:quota"] },
      { removeLabels: ["uat:cmfb7q2xk0001"] },
    ]) {
      const result = await portal(patch);
      expect({ patch, ok: result.ok, code: result.body.error?.code }).toEqual({ patch, ok: false, code: "forbidden" });
    }
    seed("TASK-1", { labels: ["kind:code"], stage: "merged" });
    for (const patch of [{ addLabels: ["uat:hold"] }, { verify: {} }, { cancel: { reason: "obsolete" } }]) {
      const result = await portal(patch, "TASK-1");
      expect({ patch, ok: result.ok, code: result.body.error?.code }).toEqual({ patch, ok: false, code: "forbidden" });
    }
    expect(data().labels).toEqual(["kind:code", "uat:cmfb7q2xk0001", "uat-attempt:1", "repo:petralabx/plx-customer-portal"]);
    expect(data().stage).toBe("merged");
    expect(data("TASK-1").stage).toBe("merged");
    expect(h.events).toEqual([]);
  });

  it("rejects verify combined with any other field", async () => {
    uat("TASK-UAT", { stage: "merged" });
    for (const patch of [{ verify: {}, title: "x" }, { verify: {}, cancel: { reason: "obsolete" } }, { verify: { extra: 1 } }]) {
      const result = await portal(patch);
      expect(result.ok).toBe(false);
      expect(result.body.error.code).toBe("invalid_request");
    }
    expect(data().stage).toBe("merged");
    expect(h.events).toEqual([]);
  });

  it("refuses to verify a cancelled task with 409 already_cancelled, which the portal does not retry", async () => {
    uat("TASK-UAT", { stage: "cancelled" });
    const result = await portal({ verify: {} });
    expect({ ok: result.ok, status: result.status, code: result.body.error?.code }).toEqual({ ok: false, status: 409, code: "already_cancelled" });
    expect(data().stage).toBe("cancelled");
    expect(h.events).toEqual([]);
  });

  // TASK-4200 (Vince, 2026-10-30): a re-test nobody answers in 9 Toronto
  // business days closes as STALE. The portal's closeStale adds uat:stale to
  // the merged task, which then counts as closed and unconfirmed. Mission
  // Control never verifies or cancels the task on a STALE close.
  describe("closeStale (TASK-4200)", () => {
    const LABELS = ["kind:code", "uat:cmfb7q2xk0001", "uat-attempt:1", "repo:petralabx/plx-customer-portal"];
    const refusal = (result: { ok: boolean; status: number | null; body: Body }) =>
      ({ ok: result.ok, code: result.body.error?.code });

    for (const transport of ["MCP", "REST"] as const) {
      it("lets the portal close a merged task as STALE: it stays merged, gains only uat:stale, and a replay changes nothing via " + transport, async () => {
        uat("TASK-UAT", { stage: "merged", labels: [...LABELS, "uat:hold"] });
        const before = structuredClone(data());
        const result = await portal(
          { closeStale: { note: "No re-test result in 9 business days", staleClosedAt: "2026-10-30T14:00:00.000Z" } }, "TASK-UAT", transport
        );
        expect(result.ok).toBe(true);
        // Decision 7: the verb only adds uat:stale. uat:hold and every other label stay.
        expect(result.body.data.diff).toEqual({ labels: { before: [...LABELS, "uat:hold"], after: [...LABELS, "uat:hold", "uat:stale"] } });
        // Stage, PRs and evidence never change on a STALE close.
        expect(data()).toMatchObject({ stage: "merged", labels: [...LABELS, "uat:hold", "uat:stale"], prs: before.prs, evidence: before.evidence });
        expect(data().activity?.at(-1)).toMatchObject({ kind: "move", what: expect.stringContaining("STALE") });
        // Labels are DB-only: nothing is queued for SharePoint.
        expect(h.rows.get("TASK-UAT")!.sync_state).toBe("synced");
        expect(h.events).toEqual([{
          kind: "task.uat_stale_closed", actor: "codex:vince@petrasoap.com", repo: "petralabx/PLX_MC", taskId: "TASK-UAT",
          payload: {
            servicePrincipalId: "sp_mcp_portal", workerId: "update-test", previousStage: "merged", closedBy: "sp_mcp_portal",
            note: "No re-test result in 9 business days", staleClosedAt: "2026-10-30T14:00:00.000Z",
            decision: "TASK-4200 (Vince, 2026-10-30)",
          },
        }]);
        // Closed and unconfirmed: never done, never open, never Needs a human.
        expect(countTaskProgress([data()])).toMatchObject({ done: 0, unconfirmed: 1, inProgress: 0, remaining: 0, closedTasks: 1, total: 1 });
        expect(needsHuman(data())).toBe(false);
        // An outbox retry of the same close succeeds and writes nothing.
        const replay = await portal({ closeStale: {} }, "TASK-UAT", transport);
        expect(replay.ok).toBe(true);
        expect(replay.body.data.diff).toEqual({});
        expect(h.events).toHaveLength(1);
      });
    }

    it("refuses a task whose fix has not merged with 409 not_merged, and verified or cancelled tasks with their own 409", async () => {
      for (const [stage, code] of [
        ["review", "not_merged"], ["backlog", "not_merged"], ["verified", "already_verified"], ["cancelled", "already_cancelled"],
      ] as const) {
        uat("TASK-UAT", { stage });
        const result = await portal({ closeStale: {} });
        expect({ stage, status: result.status, ...refusal(result) }).toEqual({ stage, status: 409, ok: false, code });
        expect(data()).toMatchObject({ stage, labels: LABELS });
      }
      expect(h.events).toEqual([]);
    });

    it("refuses a task that is not a UAT ticket task: 403 under the portal's scope, and 400 from the door itself", async () => {
      seed("TASK-1", { labels: ["kind:code"], stage: "merged" });
      const result = await portal({ closeStale: {} }, "TASK-1");
      expect({ status: result.status, ...refusal(result) }).toEqual({ status: 403, ok: false, code: "forbidden" });
      const portalIdentity: McpIdentity = {
        ...identity, servicePrincipalId: "sp_mcp_portal", actor: { kind: "service", id: "sp_mcp_portal", status: "active" },
      };
      const ctx = cancelContextFor(portalIdentity, "sp_mcp_portal");
      await expect(withTransaction((q) => staleCloseUatTicketTx(q, "TASK-1", data("TASK-1"), {}, ctx)))
        .rejects.toMatchObject({ code: "invalid_request", status: 400 });
      expect(data("TASK-1").labels).toEqual(["kind:code"]);
      expect(h.events).toEqual([]);
    });

    it("never lets an agent close a task as STALE, and audits the attempt", async () => {
      h.allowPool = true; // the denial is audited on its own connection, before the transaction
      uat("TASK-UAT", { stage: "merged" });
      const result = await agent({ closeStale: {} });
      expect(refusal(result)).toEqual({ ok: false, code: "forbidden" });
      expect(result.body.error.message).toContain("task.uat_sync");
      expect(data().labels).toEqual(LABELS);
      expect(h.events.map((e) => e.kind)).toEqual(["task.close_stale_denied"]);
    });

    it("records a null staleClosedAt when the portal sends none", async () => {
      uat("TASK-UAT", { stage: "merged" });
      expect((await portal({ closeStale: {} })).ok).toBe(true);
      expect(h.events).toEqual([expect.objectContaining({
        kind: "task.uat_stale_closed", payload: expect.objectContaining({ note: null, staleClosedAt: null }),
      })]);
    });

    it("rejects closeStale combined with any other field, or with a staleClosedAt that is not an ISO time", async () => {
      uat("TASK-UAT", { stage: "merged" });
      for (const patch of [
        { closeStale: {}, title: "x" }, { closeStale: {}, verify: {} }, { closeStale: {}, cancel: { reason: "obsolete" } },
        { closeStale: {}, addLabels: ["uat:hold"] }, { closeStale: { extra: 1 } }, { closeStale: { staleClosedAt: "yesterday" } },
      ]) {
        const result = await portal(patch);
        expect({ patch, ...refusal(result) }).toEqual({ patch, ok: false, code: "invalid_request" });
      }
      expect(data().labels).toEqual(LABELS);
      expect(h.events).toEqual([]);
    });

    it("never takes uat:stale from a label edit: adding or removing it is 403 for the portal and for agents", async () => {
      expect(CLOSURE_LABELS).not.toContain("uat:stale");
      uat("TASK-UAT", { stage: "merged" });
      for (const send of [
        () => portal({ addLabels: ["uat:stale"] }),
        () => agent({ addLabels: ["uat:stale"] }),
        () => agent({ labels: [...LABELS, "uat:stale"] }),
      ]) {
        expect(refusal(await send())).toEqual({ ok: false, code: "forbidden" });
      }
      // A laned task in progress is refused the label too, not only for its lane.
      uat("TASK-UAT", { stage: "progress", labels: [...LABELS, "lane:codex"] });
      expect(refusal(await agent({ addLabels: ["uat:stale"] }))).toEqual({ ok: false, code: "forbidden" });
      uat("TASK-UAT", { stage: "merged" });
      expect((await portal({ closeStale: {} })).ok).toBe(true);
      for (const send of [
        () => portal({ removeLabels: ["uat:stale"] }),
        () => agent({ removeLabels: ["uat:stale"] }),
        () => agent({ labels: LABELS }),
      ]) {
        expect(refusal(await send())).toEqual({ ok: false, code: "forbidden" });
      }
      // Other label edits on the closed task still work, and keep uat:stale.
      expect((await agent({ addLabels: ["needs-review-later"] })).ok).toBe(true);
      expect(data().labels).toEqual([...LABELS, "uat:stale", "needs-review-later"]);
      expect(h.events.map((e) => e.kind)).toEqual(["task.uat_stale_closed", "task.updated"]);
    });

    // A near-copy stored before S1 may stay: an edit that sends no label field
    // writes no labels, so trimming the stored list cannot read as an add.
    it("lets an agent edit the title or priority of a task that stores a padded near-copy of uat:stale", async () => {
      for (const nearCopy of [" uat:stale", "uat:stale ", " UAT:Stale "]) {
        uat("TASK-UAT", { stage: "merged", labels: [...LABELS, nearCopy] });
        expect((await agent({ title: "Renamed" })).ok).toBe(true);
        expect((await agent({ priority: "high" })).ok).toBe(true);
        expect(data()).toMatchObject({ title: "Renamed", priority: "high", labels: [...LABELS, nearCopy] });
        // Adding the real label is still refused.
        expect(refusal(await agent({ addLabels: ["uat:stale"] }))).toEqual({ ok: false, code: "forbidden" });
      }
    });

    // S1-05: a label edit could carry the close to another ticket, or drop
    // kind:code and make it count as done.
    it("refuses an agent label edit that moves a STALE close's ticket label or kind:code", async () => {
      uat("TASK-UAT", { stage: "merged" });
      expect((await portal({ closeStale: {} })).ok).toBe(true);
      for (const patch of [
        { removeLabels: ["uat:cmfb7q2xk0001"], addLabels: ["uat:cmfb7q2xk0002"] },
        { removeLabels: ["kind:code"], addLabels: ["kind:decision"] },
        { removeLabels: ["uat:cmfb7q2xk0001"] },
      ]) {
        const result = await agent(patch);
        expect({ patch, ...refusal(result) }).toEqual({ patch, ok: false, code: "forbidden" });
        expect(result.body.error.message).toContain("keeps kind:code and its uat:<feedbackId> label");
      }
      expect(data().labels).toEqual([...LABELS, "uat:stale"]);
      expect(countTaskProgress([data()])).toMatchObject({ unconfirmed: 1, done: 0 });
      expect(h.events.map((e) => e.kind)).toEqual(["task.uat_stale_closed"]);
    });

    it("a late PASS: verify moves the task to verified, keeps uat:stale as history and records previousClosure stale", async () => {
      uat("TASK-UAT", { stage: "merged" });
      expect((await portal({ closeStale: {} })).ok).toBe(true);
      const result = await portal({ verify: { note: "Late PASS on R5JD2K" } });
      expect(result.ok).toBe(true);
      expect(data()).toMatchObject({ stage: "verified", labels: [...LABELS, "uat:stale"] });
      expect(h.events.at(-1)).toMatchObject({
        kind: "task.verified",
        payload: { previousStage: "merged", previousClosure: "stale", verifiedBy: "sp_mcp_portal", note: "Late PASS on R5JD2K" },
      });
      expect(countTaskProgress([data()])).toMatchObject({ done: 1, unconfirmed: 0, remaining: 0 });
      // A close that arrives after the late PASS is refused, not applied.
      const late = await portal({ closeStale: {} });
      expect({ status: late.status, ...refusal(late) }).toEqual({ status: 409, ok: false, code: "already_verified" });
      expect(h.events.map((e) => e.kind)).toEqual(["task.uat_stale_closed", "task.verified"]);
    });

    it("a later cancel keeps uat:stale, and the task then counts as cancelled", async () => {
      uat("TASK-UAT", { stage: "merged" });
      expect((await portal({ closeStale: {} })).ok).toBe(true);
      const result = await portal({ cancel: { reason: "obsolete", note: "Late FAIL: the next attempt has its own task" } });
      expect(result.ok).toBe(true);
      expect(data()).toMatchObject({ stage: "cancelled", labels: [...LABELS, "uat:stale"] });
      expect(countTaskProgress([data()])).toMatchObject({ cancelled: 1, unconfirmed: 0, done: 0 });
      // The replay no-op is for a merged task only: a retried close on the cancelled task gets its 409.
      const retry = await portal({ closeStale: {} });
      expect({ status: retry.status, ...refusal(retry) }).toEqual({ status: 409, ok: false, code: "already_cancelled" });
      expect(h.events.map((e) => e.kind)).toEqual(["task.uat_stale_closed", "task.cancelled"]);
    });
  });
});
