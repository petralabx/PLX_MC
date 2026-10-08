// TASK-2529: the cancelled end stage. Real actions, repo and sync state against
// an in-memory stand-in for the database (entities incl. completed_at /
// cancellation, mc_events). No live database, Graph or SharePoint calls.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TxQuery } from "@/lib/db";
import type { McpIdentity } from "@/lib/mcp/auth";

type Row = {
  entity_type: string;
  id: string;
  data: Record<string, unknown>;
  sync_state: string;
  sp_item_id: string | null;
  dirty_fields: string[];
  field_attribution: Record<string, unknown>;
  completed_at: Date | null;
  cancellation: Record<string, unknown> | null;
};
type Ev = { kind: string; actor: string; taskId: string; payload: Record<string, unknown> };

const h = vi.hoisted(() => ({
  rows: new Map<string, unknown>(),
  events: [] as unknown[],
  updates: [] as { sql: string; params: unknown[] }[],
}));
const rows = () => h.rows as Map<string, Row>;
const events = () => h.events as Ev[];

// sp_mcp_codex stands in for the principal an operator grants task.cancel /
// task.reopen (none holds them in the reviewed registry today); every other
// principal keeps its real grants.
vi.mock("@/lib/permissions/grants", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/permissions/grants")>();
  return {
    ...real,
    capabilitiesForServicePrincipal: (id: string) =>
      id === "sp_mcp_codex" ? [...real.capabilitiesForServicePrincipal(id), "task.cancel", "task.reopen"] : real.capabilitiesForServicePrincipal(id),
  };
});
vi.mock("@/lib/permissions/decision-log", () => ({ recordPermissionDecision: vi.fn(async () => true) }));
vi.mock("@/lib/compliance/go-live-announcer", () => ({ announceGoLiveEventSafe: vi.fn(async () => undefined) }));
vi.mock("@/lib/db", () => {
  async function execute(sql: string, params: unknown[] = []) {
    if (sql.includes("FROM buckets ORDER BY")) return [{ id: "BKT-OPEN", data: { id: "BKT-OPEN", project: null } }];
    if (sql.includes("FROM projects ORDER BY")) return [];
    if (sql.includes("FROM entities WHERE")) {
      const row = rows().get(String(params[1]));
      return row ? [structuredClone(row)] : [];
    }
    if (sql.startsWith("UPDATE entities")) {
      h.updates.push({ sql, params });
      const row = rows().get(String(params[1]))!;
      row.data = JSON.parse(String(params[2]));
      row.sync_state = params[3] as string;
      row.dirty_fields = JSON.parse(String(params[5]));
      if (row.entity_type === "task" && row.completed_at == null && params[8]) row.completed_at = new Date(String(params[8]));
      if (row.entity_type === "task" && params[9]) row.cancellation = params[10] ? JSON.parse(String(params[10])) : null;
      return [];
    }
    if (sql.startsWith("INSERT INTO sync_audit_log")) return [];
    if (sql.startsWith("INSERT INTO mc_events")) {
      events().push({
        kind: String(params[0]), actor: String(params[1]), taskId: String(params[3]),
        payload: JSON.parse(String(params[5])),
      });
      return [{ seq: String(events().length) }];
    }
    if (sql.includes("payload->>'previousStage'")) {
      const last = events().filter((e) => e.kind === "task.cancelled" && e.taskId === params[0]).at(-1);
      return last ? [{ prev: last.payload.previousStage }] : [];
    }
    throw new Error("Unexpected SQL: " + sql);
  }
  return {
    query: (sql: string, params?: unknown[]) => execute(sql, params),
    withTransaction: async <T,>(fn: (q: TxQuery) => Promise<T>): Promise<T> => {
      const snapshot = { rows: structuredClone(rows()), events: structuredClone(events()) };
      try {
        return await fn(((sql: string, params?: unknown[]) => execute(sql, params)) as TxQuery);
      } catch (err) {
        h.rows = snapshot.rows;
        h.events = snapshot.events;
        throw err;
      }
    },
  };
});

import { ApiError } from "@/lib/api/route";
import { actionProgress } from "@/lib/mcp/actions";
import { actionUpdateTask, actionUpdateTasks, updateTaskSchema } from "@/lib/mcp/task-update-actions";
import { cancelInputViolation } from "@/lib/mc-data/cancellation";
import { withTransaction } from "@/lib/db";
import { patchTask } from "@/lib/sync";
import { getEntity, updateEntity } from "@/lib/sync/repo";
import { outboundFields, parseFieldValue } from "@/lib/sync/mapping";
import { inboundCancellation } from "@/lib/sync/cancel-validate";

const identityFor = (operatorEmail: string, principal: "sp_mcp_codex" | "sp_mcp_grok" = "sp_mcp_codex"): McpIdentity => ({
  operatorEmail, runtime: "codex", workerId: "cancel-test", repo: "petralabx/PLX_MC",
  servicePrincipalId: principal,
  actor: { kind: "service", id: principal, status: "active" },
});
const steward = identityFor("cos@petrasoap.com");
const owner = identityFor("vince@petrasoap.com");
// Holds only the shared agent bundle (task.progress, no task.cancel / task.reopen)
// and forges the header of an allowlisted admin: the header must grant nothing.
const outsider = identityFor("vince@petrasoap.com", "sp_mcp_grok");
// Console / Entra session path: a human admin actor.
const consoleAdmin: McpIdentity = {
  ...identityFor("vince@petrasoap.com"),
  servicePrincipalId: "sp_mcp_codex",
  actor: { kind: "human", id: "oid-admin", role: "admin", status: "active" },
};
const consoleMember: McpIdentity = { ...consoleAdmin, actor: { kind: "human", id: "oid-member", role: "member", status: "active" } };

function seed(id: string, stage = "progress", extra: Record<string, unknown> = {}, completedAt: Date | null = null) {
  rows().set(id, {
    entity_type: "task", id, sp_item_id: "1", sync_state: "synced", dirty_fields: [], field_attribution: {},
    completed_at: completedAt, cancellation: null,
    // No lane label on purpose: cancelling an old unlabeled task must work.
    data: { id, bucket: "BKT-OPEN", stage, labels: [], title: id, priority: "medium", accountableOwner: "greg", ...extra },
  });
}
const row = (id: string) => rows().get(id)!;
const cancelled = (id: string, patch: Record<string, unknown>) => actionUpdateTask(steward, { taskId: id, patch: { cancel: patch } });

beforeEach(() => {
  vi.stubEnv("PLX_MC_PERMISSIONS_ENFORCEMENT", "off");
  rows().clear(); events().length = 0; h.updates.length = 0;
  seed("TASK-2360"); seed("TASK-2341"); seed("TASK-1544", "qa");
});
afterEach(() => vi.unstubAllEnvs());

describe("cancel validation (acceptance 1, 2)", () => {
  it("duplicate without replacedBy is a validation error and writes nothing", async () => {
    await expect(cancelled("TASK-2360", { reason: "duplicate" })).rejects.toMatchObject({ code: "invalid_request" });
    expect(row("TASK-2360").cancellation).toBeNull();
    expect(row("TASK-2360").data.stage).toBe("progress");
    expect(events()).toEqual([]);
  });

  it("duplicate with an existing replacedBy cancels: stage, cancellation, completed_at, event", async () => {
    const result = await cancelled("TASK-2360", { reason: "duplicate", replacedBy: "TASK-2341" });
    expect(result.diff).toEqual({ stage: { before: "progress", after: "cancelled" } });
    expect(row("TASK-2360").data.stage).toBe("cancelled");
    expect(row("TASK-2360").data).not.toHaveProperty("cancellation"); // column only, never jsonb
    expect(row("TASK-2360").cancellation).toEqual({
      reason: "duplicate", replacedBy: "TASK-2341",
      cancelledAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT/), cancelledBy: "sp_mcp_codex",
    });
    expect(row("TASK-2360").completed_at).toBeInstanceOf(Date);
    expect(events().map((e) => e.kind)).toEqual(["task.cancelled"]);
    expect(events()[0]).toMatchObject({
      actor: "codex:cos@petrasoap.com", taskId: "TASK-2360",
      payload: { reason: "duplicate", replacedBy: "TASK-2341", previousStage: "progress", cancelledBy: "sp_mcp_codex" },
    });
  });

  it("obsolete needs no replacedBy (stored as null); the note is kept", async () => {
    await cancelled("TASK-1544", { reason: "obsolete", note: "  superseded by the sweep  " });
    expect(row("TASK-1544").cancellation).toMatchObject({ reason: "obsolete", replacedBy: null, note: "superseded by the sweep" });
  });

  it.each([
    ["an unknown reason", { reason: "boring" }],
    ["a missing reason", {}],
    ["a nonexistent replacedBy", { reason: "superseded", replacedBy: "TASK-99999" }],
    ["a self reference", { reason: "duplicate", replacedBy: "TASK-2360" }],
    ["a malformed replacedBy", { reason: "obsolete", replacedBy: "2341" }],
  ])("rejects %s", async (_n, patch) => {
    await expect(cancelled("TASK-2360", patch)).rejects.toBeInstanceOf(ApiError);
    expect(row("TASK-2360").cancellation).toBeNull();
    expect(row("TASK-2360").data.stage).toBe("progress");
  });

  it("the pure rules agree (reason enum, replacedBy requirement, self reference)", () => {
    expect(cancelInputViolation("TASK-1", { reason: "delivered_without_pr" })).toBeNull();
    expect(cancelInputViolation("TASK-1", { reason: "superseded" })).toMatch(/replacedBy is required/);
    expect(cancelInputViolation("TASK-1", { reason: "duplicate", replacedBy: "TASK-1" })).toMatch(/itself/);
  });

  it("cancelling an already-cancelled task is a conflict", async () => {
    await cancelled("TASK-1544", { reason: "obsolete" });
    await expect(cancelled("TASK-1544", { reason: "obsolete" })).rejects.toMatchObject({ code: "already_cancelled" });
  });

  it("cancel cannot be combined with other patch fields or with reopen", () => {
    expect(updateTaskSchema.safeParse({ taskId: "TASK-1", patch: { cancel: { reason: "obsolete" }, title: "x" } }).success).toBe(false);
    expect(updateTaskSchema.safeParse({ taskId: "TASK-1", patch: { cancel: { reason: "obsolete" }, reopen: {} } }).success).toBe(false);
  });
});

describe("reopen (acceptance 4)", () => {
  it("returns to the prior stage, nulls cancellation, keeps completed_at, audits both events", async () => {
    await cancelled("TASK-1544", { reason: "obsolete" });
    const stamped = row("TASK-1544").completed_at;
    expect(stamped).toBeInstanceOf(Date);

    await actionUpdateTask(steward, { taskId: "TASK-1544", patch: { reopen: { note: "wrongly cancelled" } } });
    expect(row("TASK-1544").data.stage).toBe("qa");
    expect(row("TASK-1544").cancellation).toBeNull();
    expect(row("TASK-1544").completed_at).toBe(stamped);
    expect(events().map((e) => e.kind)).toEqual(["task.cancelled", "task.reopened"]);
    expect(events()[1].payload).toMatchObject({
      previousStage: "cancelled", stage: "qa", note: "wrongly cancelled",
      priorCancellation: { reason: "obsolete" },
    });
    // Re-pushed so ToDos Cancel Reason / Replaced By are cleared.
    expect(row("TASK-1544").dirty_fields).toContain("cancellation");
  });

  it("reopens into a chosen non-terminal stage and refuses terminal ones", async () => {
    await cancelled("TASK-1544", { reason: "obsolete" });
    await expect(actionUpdateTask(steward, { taskId: "TASK-1544", patch: { reopen: { stage: "merged" } } })).rejects.toBeInstanceOf(ApiError);
    expect(row("TASK-1544").data.stage).toBe("cancelled");
    await actionUpdateTask(steward, { taskId: "TASK-1544", patch: { reopen: { stage: "backlog" } } });
    expect(row("TASK-1544").data.stage).toBe("backlog");
  });

  it("a generic stage patch cannot leave cancelled: only the reopen service can", async () => {
    await cancelled("TASK-1544", { reason: "obsolete" });
    await expect(withTransaction((q) => patchTask("TASK-1544", { stage: "backlog" }, "member@petrasoap.com", { query: q }))).rejects.toMatchObject({ code: "reopen_required", status: 409 });
    expect(row("TASK-1544").data.stage).toBe("cancelled");
    expect(row("TASK-1544").cancellation).toMatchObject({ reason: "obsolete" });
    expect(events().map((e) => e.kind)).toEqual(["task.cancelled"]);
  });

  it("cancelling again after a reopen writes a new cancellation object", async () => {
    await cancelled("TASK-1544", { reason: "obsolete" });
    await actionUpdateTask(steward, { taskId: "TASK-1544", patch: { reopen: {} } });
    await cancelled("TASK-1544", { reason: "duplicate", replacedBy: "TASK-2341" });
    expect(row("TASK-1544").cancellation).toMatchObject({ reason: "duplicate", replacedBy: "TASK-2341" });
  });

  it("refuses to reopen a task that is not cancelled", async () => {
    await expect(actionUpdateTask(steward, { taskId: "TASK-1544", patch: { reopen: {} } })).rejects.toMatchObject({ code: "not_cancelled" });
  });
});

describe("who may cancel", () => {
  it("authorizes from the authenticated principal's capabilities, never the operator email; denial leaves an audit event", async () => {
    // Forged allowlisted admin email on a principal without task.cancel: refused.
    await expect(
      actionUpdateTask(outsider, { taskId: "TASK-1544", patch: { cancel: { reason: "obsolete" } } })
    ).rejects.toMatchObject({ code: "forbidden", status: 403 });
    expect(row("TASK-1544").data.stage).toBe("qa");
    expect(events().map((e) => e.kind)).toEqual(["task.cancel_denied"]);
    // An unrelated email on a principal granted task.cancel is allowed.
    await actionUpdateTask(identityFor("nobody@example.com"), { taskId: "TASK-1544", patch: { cancel: { reason: "obsolete" } } });
    expect(row("TASK-1544").data.stage).toBe("cancelled");
  });

  it("refuses reopen without task.reopen even with a forged admin email; task.reopen reopens", async () => {
    await cancelled("TASK-1544", { reason: "obsolete" });
    events().length = 0;
    await expect(
      actionUpdateTask(outsider, { taskId: "TASK-1544", patch: { reopen: {} } })
    ).rejects.toMatchObject({ code: "forbidden", status: 403 });
    expect(row("TASK-1544").data.stage).toBe("cancelled");
    expect(events().map((e) => e.kind)).toEqual(["task.reopen_denied"]);
    await actionUpdateTask(identityFor("nobody@example.com"), { taskId: "TASK-1544", patch: { reopen: {} } });
    expect(row("TASK-1544").data.stage).not.toBe("cancelled");
  });

  it("a human admin session (Console path) may cancel and reopen; a member may not", async () => {
    await actionUpdateTask(consoleAdmin, { taskId: "TASK-1544", patch: { cancel: { reason: "obsolete" } } });
    expect(row("TASK-1544").data.stage).toBe("cancelled");
    await expect(actionUpdateTask(consoleMember, { taskId: "TASK-1544", patch: { reopen: {} } })).rejects.toMatchObject({ code: "forbidden" });
    await actionUpdateTask(consoleAdmin, { taskId: "TASK-1544", patch: { reopen: {} } });
    expect(row("TASK-1544").data.stage).not.toBe("cancelled");
    await expect(actionUpdateTask(consoleMember, { taskId: "TASK-1544", patch: { cancel: { reason: "obsolete" } } })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("the batch tool cancels per item and reports a bad item without aborting siblings (acceptance 9)", async () => {
    const out = await actionUpdateTasks(owner, {
      items: [
        { taskId: "TASK-1544", patch: { cancel: { reason: "obsolete" } } },
        { taskId: "TASK-2360", patch: { cancel: { reason: "duplicate" } } },
      ],
    });
    expect(out).toMatchObject({ updated: 1, failed: 1 });
    expect(row("TASK-1544").data.stage).toBe("cancelled");
    expect(row("TASK-2360").data.stage).toBe("progress");
  });
});

describe("mc_report_progress (acceptance 9)", () => {
  it("stage=cancelled with cancelReason/replacedBy/note writes the same state and event", async () => {
    const res = await actionProgress(steward, {
      taskId: "TASK-2360", stage: "cancelled", cancelReason: "duplicate", replacedBy: "TASK-2341", note: "dupe",
    });
    expect(res).toMatchObject({ ok: true, stage: "cancelled" });
    expect(row("TASK-2360").cancellation).toMatchObject({ reason: "duplicate", replacedBy: "TASK-2341", note: "dupe" });
    expect(events().map((e) => e.kind)).toEqual(["task.cancelled", "task.progress"]);
  });

  it("without a reason it is a validation error", async () => {
    await expect(actionProgress(steward, { taskId: "TASK-2360", stage: "cancelled" })).rejects.toMatchObject({ code: "invalid_request" });
    expect(row("TASK-2360").data.stage).toBe("progress");
  });

  it("cancel details without stage=cancelled are rejected; a cancelled task cannot be silently moved", async () => {
    await expect(actionProgress(steward, { taskId: "TASK-2360", cancelReason: "obsolete" })).rejects.toMatchObject({ code: "invalid_request" });
    await actionProgress(steward, { taskId: "TASK-2360", stage: "cancelled", cancelReason: "obsolete" });
    await expect(actionProgress(steward, { taskId: "TASK-2360", stage: "progress" })).rejects.toMatchObject({ code: "task_cancelled" });
    await expect(actionProgress(steward, { taskId: "TASK-2360" })).rejects.toMatchObject({ code: "task_cancelled" });
    expect(row("TASK-2360").data.stage).toBe("cancelled");
  });

  it("a forged admin email without task.cancel cannot cancel through progress either", async () => {
    await expect(actionProgress(outsider, { taskId: "TASK-2360", stage: "cancelled", cancelReason: "obsolete" })).rejects.toMatchObject({ code: "forbidden" });
    expect(row("TASK-2360").data.stage).toBe("progress");
  });
});

describe("entities write rules (acceptance 5, 6)", () => {
  it("the cancel write is task-only in SQL and every other write leaves the column alone", async () => {
    seed("TASK-1", "progress");
    await updateEntity("task", "TASK-1", { patch: { title: "renamed" } });
    const { sql, params } = h.updates.at(-1)!;
    expect(sql).toMatch(/cancellation = CASE WHEN entity_type = 'task' AND \$10::boolean\s+THEN \$11::jsonb\s+ELSE cancellation END/);
    expect(params[9]).toBe(false);
  });

  it("a generic payload rewrite / SharePoint re-sync of a cancelled task keeps cancellation", async () => {
    await cancelled("TASK-1544", { reason: "obsolete" });
    const before = structuredClone(row("TASK-1544").cancellation);
    // What a re-sync does: write the merged row data (cancellation + completedAt riding along) back.
    const read = (await getEntity("task", "TASK-1544"))!;
    expect(read.data.cancellation).toEqual(before);
    await updateEntity("task", "TASK-1544", { patch: { ...read.data, title: "edited in SharePoint" } });
    expect(row("TASK-1544").cancellation).toEqual(before);
    expect(row("TASK-1544").data).not.toHaveProperty("cancellation");
    expect(h.updates.at(-1)!.params[9]).toBe(false);
  });

  it("a payload that claims a cancellation cannot write one", async () => {
    await updateEntity("task", "TASK-1544", { patch: { cancellation: { reason: "obsolete" } } });
    expect(row("TASK-1544").cancellation).toBeNull();
    expect(row("TASK-1544").data).not.toHaveProperty("cancellation");
  });

  it("entering cancelled without a cancellation object is refused, and a cancellation outside that move too", async () => {
    await expect(updateEntity("task", "TASK-1544", { patch: { stage: "cancelled" } })).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      updateEntity("task", "TASK-1544", { patch: { title: "x" }, cancellation: { reason: "obsolete", replacedBy: null, cancelledAt: "2026-10-07T00:00:00Z", cancelledBy: "x" } })
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(row("TASK-1544").data.stage).toBe("qa");
  });

  it("non-task rows never get a cancellation, even when asked", async () => {
    rows().set("R-1", {
      entity_type: "risk", id: "R-1", sp_item_id: null, sync_state: "synced", dirty_fields: [], field_attribution: {},
      completed_at: null, cancellation: null, data: { id: "R-1", stage: "open" },
    });
    await updateEntity("risk", "R-1", { patch: { stage: "cancelled" } });
    expect(h.updates.at(-1)!.params[9]).toBe(false);
    expect(row("R-1").cancellation).toBeNull();
  });

  it("leaving cancelled by any path (e.g. SharePoint) clears the column", async () => {
    await cancelled("TASK-1544", { reason: "obsolete" });
    await updateEntity("task", "TASK-1544", { patch: { stage: "progress" } });
    expect(row("TASK-1544").cancellation).toBeNull();
  });
});

describe("SharePoint mapping and inbound validation (acceptance 7)", () => {
  it("pushes Status=Cancelled with Cancel Reason and Replaced By", async () => {
    await cancelled("TASK-2360", { reason: "delivered_without_pr" });
    const task = (await getEntity("task", "TASK-2360"))!.data;
    expect(outboundFields("task", task, { only: ["stage"] })).toMatchObject({
      Status: "Cancelled", CancelReason: "Delivered without PR", ReplacedBy: null,
    });
    await cancelled("TASK-1544", { reason: "duplicate", replacedBy: "TASK-2341" });
    const dup = (await getEntity("task", "TASK-1544"))!.data;
    expect(outboundFields("task", dup)).toMatchObject({ Status: "Cancelled", CancelReason: "Duplicate", ReplacedBy: "TASK-2341" });
  });

  it("emits the columns only for cancelled tasks, plus an explicit clear after a reopen", () => {
    const open = { id: "TASK-1", stage: "progress", title: "t", priority: "medium", due: "Jun 06" };
    expect(outboundFields("task", open, {})).not.toHaveProperty("CancelReason");
    expect(outboundFields("task", open, { only: ["stage"] })).not.toHaveProperty("CancelReason");
    expect(outboundFields("task", open, { only: ["stage", "cancellation"] })).toMatchObject({ CancelReason: null, ReplacedBy: null });
  });

  it("an inbound edit to Cancelled with a valid reason applies", async () => {
    const ok = await inboundCancellation("TASK-2360", { CancelReason: "Duplicate", ReplacedBy: "TASK-2341" }, "sync");
    expect(ok).toMatchObject({ ok: true, cancellation: { reason: "duplicate", replacedBy: "TASK-2341", cancelledBy: "sync" } });
    const obsolete = await inboundCancellation("TASK-2360", { CancelReason: "Obsolete" }, "sync");
    expect(obsolete).toMatchObject({ ok: true, cancellation: { reason: "obsolete", replacedBy: null } });
  });

  it.each([
    ["a missing reason", {}],
    ["an unknown reason", { CancelReason: "Whatever" }],
    ["duplicate without ReplacedBy", { CancelReason: "Duplicate" }],
    ["a ReplacedBy that does not exist", { CancelReason: "Superseded", ReplacedBy: "TASK-99999" }],
  ])("an inbound edit to Cancelled with %s is invalid (the engine raises a Sync conflict)", async (_n, fields) => {
    expect(await inboundCancellation("TASK-2360", fields, "sync")).toMatchObject({ ok: false });
  });

  it("keep-SharePoint on such a conflict cannot apply a cancel without a reason", () => {
    expect(parseFieldValue("task", "stage", "Cancelled")).toBeUndefined();
    expect(parseFieldValue("task", "stage", "cancelled")).toBeUndefined();
    expect(parseFieldValue("task", "stage", "In QA")).toBe("qa");
  });
});
