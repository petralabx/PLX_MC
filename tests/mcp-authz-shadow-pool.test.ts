// TASK-3026: a shadow-mode ACL mismatch inside mc_update_task's transaction
// must not wait on a second pooled connection. The fake pool below has the
// production shape (src/lib/db: max 5, 10s acquire timeout); only database
// I/O is faked, the real action, ACL guard, shadow log and event writer run.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EntityRow } from "@/lib/sync/repo";
import type { TxQuery } from "@/lib/db";
import type { McpIdentity } from "@/lib/mcp/auth";

const h = vi.hoisted(() => ({
  rows: new Map<string, EntityRow>(),
  events: [] as { kind: string; payload: Record<string, unknown> }[],
  free: 5,
  waiters: [] as (() => void)[],
}));

vi.mock("@/lib/permissions/decision-log", () => ({ recordPermissionDecision: vi.fn(async () => true) }));
vi.mock("@/lib/db", () => {
  const ACQUIRE_TIMEOUT_MS = 10_000;
  async function acquire(): Promise<void> {
    if (h.free > 0) {
      h.free -= 1;
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        h.waiters.splice(h.waiters.indexOf(grant), 1);
        reject(new Error("timeout exceeded when trying to connect"));
      }, ACQUIRE_TIMEOUT_MS);
      const grant = () => {
        clearTimeout(timer);
        resolve();
      };
      h.waiters.push(grant);
    });
  }
  function release(): void {
    const next = h.waiters.shift();
    if (next) next();
    else h.free += 1;
  }
  async function execute(sql: string, params: unknown[] = []) {
    // Hold each connection briefly so all transactions overlap.
    await new Promise((resolve) => setTimeout(resolve, 20));
    if (sql.includes("FROM buckets ORDER BY")) return [
      { id: "BKT-SECRET", data: { id: "BKT-SECRET", project: "PRJ-SECRET" } },
    ];
    if (sql.includes("FROM projects ORDER BY")) return [
      { id: "PRJ-SECRET", data: { id: "PRJ-SECRET", visibility: "restricted", members: ["vince@petrasoap.com"] } },
    ];
    if (sql.includes("FROM entities WHERE")) {
      const row = h.rows.get(String(params[1]));
      return row ? [structuredClone(row)] : [];
    }
    if (sql.startsWith("UPDATE entities")) {
      const id = String(params[1]);
      h.rows.set(id, { ...h.rows.get(id)!, data: JSON.parse(String(params[2])) });
      return [];
    }
    if (sql.startsWith("INSERT INTO sync_audit_log")) return [];
    if (sql.startsWith("INSERT INTO mc_events")) {
      h.events.push({ kind: String(params[0]), payload: JSON.parse(String(params[5])) });
      return [{ seq: String(h.events.length) }];
    }
    throw new Error("Unexpected SQL: " + sql);
  }
  return {
    query: async (sql: string, params?: unknown[]) => {
      await acquire();
      try {
        return await execute(sql, params);
      } finally {
        release();
      }
    },
    withTransaction: async <T,>(fn: (q: TxQuery) => Promise<T>): Promise<T> => {
      await acquire();
      try {
        return await fn(((sql: string, params?: unknown[]) => execute(sql, params)) as TxQuery);
      } finally {
        release();
      }
    },
  };
});

import { actionUpdateTask } from "@/lib/mcp/task-update-actions";

// The operator email is a PRJ-SECRET member; the principal alone is not, so
// every update in shadow mode is allowed and logs a mismatch.
const identity: McpIdentity = {
  operatorEmail: "vince@petrasoap.com", runtime: "codex", workerId: "pool-test",
  repo: "petralabx/PLX_MC", servicePrincipalId: "sp_mcp_codex",
  actor: { kind: "service", id: "sp_mcp_codex", status: "active" },
};

beforeEach(() => {
  vi.stubEnv("PLX_MC_MCP_PRINCIPAL_AUTHZ", "");
  h.rows.clear();
  h.events = [];
  h.free = 5;
  h.waiters = [];
  for (let i = 1; i <= 6; i += 1) {
    const id = `TASK-${i}`;
    h.rows.set(id, {
      entity_type: "task", id, sp_item_id: String(i), sync_state: "synced", dirty_fields: [], field_attribution: {},
      data: { id, bucket: "BKT-SECRET", stage: "planned", labels: ["lane:codex"], title: "Original", priority: "medium" },
    } as unknown as EntityRow);
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("shadow mismatch writes vs the DB pool", () => {
  it("6 concurrent mismatching updates finish under 2s with the pool at 5, and every mismatch is recorded", async () => {
    const started = Date.now();
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) => actionUpdateTask(identity, { taskId: `TASK-${i + 1}`, patch: { title: `Renamed ${i + 1}` } }))
    );
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(results.map((r) => r.fields.title)).toEqual([1, 2, 3, 4, 5, 6].map((i) => `Renamed ${i}`));

    // Fire-and-forget: the mismatch rows land once connections free up.
    await vi.waitFor(() => {
      expect(h.events.filter((e) => e.kind === "authz.shadow_mismatch")).toHaveLength(6);
    });
    expect(h.events.find((e) => e.kind === "authz.shadow_mismatch")?.payload).toMatchObject({
      site: "permissions.project-acl",
      projectId: "PRJ-SECRET",
      operatorAllowed: true,
      principalAllowed: false,
    });
  }, 15_000);
});
