import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { McpIdentity } from "@/lib/mcp/auth";

const mocks = vi.hoisted(() => ({ q: vi.fn(), transaction: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: mocks.query, withTransaction: mocks.transaction }));
vi.mock("@/lib/permissions/decision-log", () => ({ recordPermissionDecision: vi.fn(async () => true) }));
import { dismissConflict } from "@/lib/sync/repo";
import {
  actionDismissConflict, actionDismissConflicts, dismissConflictSchema, dismissConflictsSchema,
} from "@/lib/mcp/sync-actions";

const identity: McpIdentity = {
  operatorEmail: "vince@petrasoap.com", runtime: "codex", workerId: "test",
  repo: "petralabx/PLX_MC", servicePrincipalId: "sp_mcp_codex",
  actor: { kind: "service", id: "sp_mcp_codex", status: "active" },
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.transaction.mockImplementation(async (fn) => fn(mocks.q));
  mocks.q.mockImplementation(async (sql: string) => sql.includes("RETURNING")
    ? [{ entity_id: "TASK-1134", field: "stage" }] : []);
});

describe("dismiss persistence", () => {
  it("closes only the open conflict and audits the actor and reason without task or SharePoint writes", async () => {
    await expect(actionDismissConflict(identity, {
      conflictId: "cf-task-1134-stage-1787262945200", reason: "Live stage already merged",
    })).resolves.toEqual({ conflictId: "cf-task-1134-stage-1787262945200", dismissed: true });
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.q).toHaveBeenCalledTimes(2);
    const [sql, params] = mocks.q.mock.calls[0];
    expect(sql).toContain("UPDATE sync_conflicts");
    expect(sql).toContain("WHERE id = $1 AND resolved_at IS NULL");
    for (const column of ["resolved_at", "dismissed_at", "dismissed_by", "dismissal_reason"]) {
      expect(sql).toContain(column);
    }
    for (const column of ["mc_val", "sp_val", "winner", "entities", "dirty_fields"]) {
      expect(sql).not.toContain(column);
    }
    expect(params).toEqual(["cf-task-1134-stage-1787262945200", "sp_mcp_codex", "Live stage already merged"]);
    expect(mocks.q.mock.calls[1]).toEqual([
      "INSERT INTO sync_audit_log (actor, body, state) VALUES ($1, $2, $3)",
      ["sp_mcp_codex", expect.stringContaining("Reason: Live stage already merged"), "synced"],
    ]);
  });

  it("rejects a missing or closed row without an audit", async () => {
    mocks.q.mockResolvedValue([]);
    await expect(actionDismissConflict(identity, { conflictId: "cf-closed" }))
      .rejects.toMatchObject({ code: "not_found", status: 404, message: "unknown or not-open conflict cf-closed" });
    expect(mocks.q).toHaveBeenCalledTimes(1);
  });

  it("propagates audit failure through the transaction so the closure rolls back", async () => {
    mocks.q.mockResolvedValueOnce([{ entity_id: "TASK-1134", field: "stage" }])
      .mockRejectedValueOnce(new Error("audit unavailable"));
    await expect(dismissConflict("cf-1", "sp_mcp_codex")).rejects.toThrow("audit unavailable");
    expect(mocks.q.mock.calls[0][1]).toEqual(["cf-1", "sp_mcp_codex", null]);
  });

  it("reports mixed and duplicate batch IDs without dismissing twice", async () => {
    const open = new Set(["cf-a", "cf-b"]);
    mocks.q.mockImplementation(async (sql: string, params: string[]) =>
      sql.includes("RETURNING") && open.delete(params[0]) ? [{ entity_id: "TASK-1134", field: "stage" }] : []);
    const result = await actionDismissConflicts(identity, { conflictIds: ["cf-a", "cf-missing", "cf-a", "cf-b"], reason: "obsolete" });
    expect(result.dismissedCount).toBe(2);
    expect(result.results.map((r) => r.dismissed)).toEqual([true, false, false, true]);
  });

  it.each(["sp_mcp_portal", "sp_sync_inbound"])("denies %s before touching persistence", async (id) => {
    const denied = { ...identity, actor: { kind: "service" as const, id, status: "active" as const } };
    await expect(actionDismissConflict(denied, { conflictId: "cf-1" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(actionDismissConflicts(denied, { conflictIds: ["cf-1"] })).rejects.toMatchObject({ code: "forbidden" });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});

describe("dismiss validation and wiring", () => {
  it("accepts optional reasons and rejects malformed, ambiguous and oversized requests", () => {
    expect(dismissConflictSchema.parse({ conflictId: "cf-1" })).toEqual({ conflictId: "cf-1" });
    for (const input of [{ conflictId: " " }, { conflictId: "cf-1", reason: " " },
      { conflictId: "cf-1", reason: "x".repeat(2001) }, { conflictId: "cf-1", conflictIds: ["cf-2"] }]) {
      expect(dismissConflictSchema.safeParse(input).success).toBe(false);
    }
    for (const conflictIds of [[], [""], Array(501).fill("cf-1")]) {
      expect(dismissConflictsSchema.safeParse({ conflictIds }).success).toBe(false);
    }
  });
  it("registers both transports and routes stdio through MCP authentication", () => {
    for (const file of ["src/lib/mcp/sync-actions.ts", "tools/plx-mc-mcp/index.ts"]) {
      const source = readFileSync(file, "utf8");
      for (const tool of ["mc_dismiss_conflict", "mc_dismiss_conflicts"]) expect(source).toContain(`"${tool}"`);
    }
    expect(readFileSync("tools/plx-mc-mcp/index.ts", "utf8")).toContain('mcFetch("/conflicts/dismiss"');
  });
});
