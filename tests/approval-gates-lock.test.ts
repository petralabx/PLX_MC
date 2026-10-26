// Raising and deciding approval gates under the task row lock (TASK-3796).
// The real requestApprovalGate, decideApprovalGate and patchTask run over an
// in-memory row store that models Postgres row locks, as in
// tests/mcp-report-progress-comment-lock.test.ts: a read made without the lock
// (outside a transaction, or in one that has not locked the row) can be
// followed at once by another writer's commit, so another gate write lands
// right after every such read. A gate list built from a stale read replaces
// the fresh one: it drops a new gate, undoes a decision, or decides twice.
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ApprovalGate } from "@/lib/mc-data";

const h = vi.hoisted(() => ({
  rows: new Map<string, { entity_type: string; id: string; data: Record<string, unknown>; sync_state: string; sp_item_id: string | null; dirty_fields: string[] }>(),
  locked: new Set<unknown>(), // transactions holding the task row lock
  racing: false,
  raced: [] as string[], // what the other writer did mid-call
  race: null as null | (() => Promise<void>),
  events: [] as { kind: string; payload?: Record<string, unknown> }[],
}));

vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  withTransaction: async <T,>(fn: (q: never) => Promise<T>) => {
    const q = async () => [];
    try {
      return await fn(q as never);
    } finally {
      h.locked.delete(q);
    }
  },
}));
vi.mock("@/lib/sync/engine", () => ({
  ensureSeeded: vi.fn(async () => true),
  ensureReposSeeded: vi.fn(async () => true),
}));
vi.mock("@/lib/sync/repo", () => ({
  stamp: () => "2026.10.23 · 15:00",
  async getEntity(_type: string, id: string, q?: unknown, forUpdate = false) {
    const row = h.rows.get(id);
    if (!row) return null;
    if (forUpdate) h.locked.add(q);
    const snapshot = structuredClone(row);
    if (!h.locked.has(q) && h.race && !h.racing) {
      h.racing = true;
      try {
        await h.race();
      } finally {
        h.racing = false;
      }
    }
    return snapshot;
  },
  async updateEntity(_type: string, id: string, opts: { patch?: Record<string, unknown> }) {
    const row = h.rows.get(id);
    if (row) row.data = { ...row.data, ...(opts.patch ?? {}) }; // the real shallow merge
  },
  async appendAudit() {},
}));
vi.mock("@/lib/compliance/repo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/compliance/repo")>()),
  appendEvent: vi.fn(async (e: { kind: string; payload?: Record<string, unknown> }) => {
    h.events.push(e);
    return "1";
  }),
  appendEventTx: vi.fn(async (_q: unknown, e: { kind: string; payload?: Record<string, unknown> }) => {
    h.events.push(e);
    return "1";
  }),
}));

import { decideApprovalGate, requestApprovalGate } from "@/lib/compliance/approvals";

const gateA: ApprovalGate = {
  id: "apg_a",
  reason: "Launch claude-uat for TASK-1",
  requestedBy: "claude-code",
  requestedByPrincipal: "sp_mcp_claude_code",
  requestedAt: "2026-10-23T14:00:00.000Z",
  status: "pending",
};

function gates(): ApprovalGate[] {
  return (h.rows.get("TASK-1")!.data.approvalGates ?? []) as ApprovalGate[];
}

const raise = (reason: string) =>
  requestApprovalGate({ taskId: "TASK-1", reason, requestedBy: "codex", requestedByPrincipal: "sp_mcp_codex" });

const decide = (decision: "approved" | "rejected", decidedBy: string, note?: string) =>
  decideApprovalGate({ taskId: "TASK-1", gateId: "apg_a", decision, decidedBy, note });

beforeEach(() => {
  h.rows.clear();
  h.locked.clear();
  h.raced.length = 0;
  h.race = null;
  h.events.length = 0;
  h.rows.set("TASK-1", {
    entity_type: "task",
    id: "TASK-1",
    data: { id: "TASK-1", stage: "progress", accountableOwner: "vince", approvalGates: [gateA] },
    sync_state: "synced",
    sp_item_id: "1",
    dirty_fields: [],
  });
});

describe("approval gate writes keep a concurrent gate write", () => {
  it("keeps a gate an agent raises while a decision is in flight", async () => {
    h.race = async () => {
      const { gate } = await raise("Merge PR 412");
      h.raced.push(gate.id);
    };
    await decide("approved", "vince@petrasoap.com");
    expect(h.raced).toHaveLength(1);
    expect(gates().map((g) => [g.id, g.status])).toEqual([
      ["apg_a", "approved"],
      [h.raced[0], "pending"],
    ]);
  });

  it("keeps a decision made while a new gate is being raised", async () => {
    h.race = async () => {
      await decide("approved", "vince@petrasoap.com");
      h.raced.push("decided apg_a");
    };
    const { gate } = await raise("Merge PR 412");
    expect(h.raced).toEqual(["decided apg_a"]);
    expect(gates().map((g) => [g.id, g.status])).toEqual([
      ["apg_a", "approved"],
      [gate.id, "pending"],
    ]);
    expect(gates()[0].decidedBy).toBe("vince@petrasoap.com");
  });

  it("refuses a second decision on a gate someone decided while it was in flight", async () => {
    h.race = async () => {
      await decide("approved", "vince@petrasoap.com");
      h.raced.push("decided apg_a");
    };
    await expect(decide("rejected", "ricardo@petrasoap.com", "Not this head")).rejects.toMatchObject({
      code: "gate_already_decided",
      status: 409,
    });
    expect(h.raced).toEqual(["decided apg_a"]);
    expect(gates()).toHaveLength(1);
    expect(gates()[0]).toMatchObject({ status: "approved", decidedBy: "vince@petrasoap.com" });
    expect(h.events.filter((e) => e.kind === "approval.decided")).toHaveLength(1);
  });
});
