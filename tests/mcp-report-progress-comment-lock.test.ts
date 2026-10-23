// mc_report_progress notes append under the task row lock (TASK-3632). The
// real patchTask and applyTaskCommentOp run over an in-memory row store that
// models Postgres row locks: a read made without the lock (outside a
// transaction, or in one that has not locked the row) can be followed at once
// by another writer's commit, so a person's comment lands right after every
// such read. A note built from a stale thread replaces it and drops the comment.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { McpIdentity } from "@/lib/mcp/auth";
import type { Comment } from "@/lib/mc-data";

const h = vi.hoisted(() => ({
  rows: new Map<string, { entity_type: string; id: string; data: Record<string, unknown>; sync_state: string; sp_item_id: string | null; dirty_fields: string[] }>(),
  locked: new Set<unknown>(), // transactions holding the task row lock
  racing: false,
  raced: [] as string[], // bodies of the comments that landed mid-call
  race: null as null | (() => Promise<void>),
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
  stamp: () => "2026.10.21 · 19:00",
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
vi.mock("@/lib/permissions/decision-log", () => ({ recordPermissionDecision: vi.fn(async () => true) }));
vi.mock("@/lib/permissions/project-acl-guard", () => ({
  assertTaskProjectAccess: vi.fn(async () => undefined),
  assertBucketProjectAccess: vi.fn(async () => undefined),
  assertProjectIdAccess: vi.fn(async () => undefined),
  loadProjectAclMaps: vi.fn(async () => ({})),
}));
vi.mock("@/lib/mcp/sync-meta", () => ({ syncMetaForTask: vi.fn(async () => ({})) }));
vi.mock("@/lib/compliance/repo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/compliance/repo")>()),
  hasActiveCheckoutForPrincipal: vi.fn(async () => true),
  appendEvent: vi.fn(async () => "1"),
}));

import { actionProgress } from "@/lib/mcp/actions";
import { applyTaskCommentOp } from "@/lib/sync/state";

const identity: McpIdentity = {
  operatorEmail: "cos@petrasoap.com",
  runtime: "cursor",
  workerId: "unknown-worker",
  repo: "petralabx/PLX_MC",
  servicePrincipalId: "sp_mcp_cursor",
  actor: { kind: "service", id: "sp_mcp_cursor", status: "active" },
} as McpIdentity;

function thread(): Comment[] {
  return (h.rows.get("TASK-1")!.data.comments ?? []) as Comment[];
}

beforeEach(() => {
  h.rows.clear();
  h.locked.clear();
  h.raced.length = 0;
  h.race = null;
  h.rows.set("TASK-1", {
    entity_type: "task",
    id: "TASK-1",
    data: { id: "TASK-1", stage: "progress", accountableOwner: "vince", comments: [{ id: "CMT-0", author: "vince", body: "old", ts: "2026.10.21 · 18:00", mentions: [] }] },
    sync_state: "synced",
    sp_item_id: "1",
    dirty_fields: [],
  });
});

describe("a progress note keeps a comment that lands while it is in flight", () => {
  it("keeps a person's comment committed between the progress read and its write", async () => {
    h.race = async () => {
      const body = `answer ${h.raced.length + 1}`;
      await applyTaskCommentOp("TASK-1", { op: "add", body, mentions: [] }, "ricardo");
      h.raced.push(body);
    };
    await actionProgress(identity, { taskId: "TASK-1", notes: "tests green" });
    expect(h.raced.length).toBeGreaterThan(0);
    expect(thread().map((c) => c.body)).toEqual(["old", ...h.raced, "tests green"]);
    expect(thread().at(-1)).toMatchObject({ author: "cos@petrasoap.com", mentions: [], id: expect.stringMatching(/^mcp-/) });
  });

  it("keeps the comment when the note also moves the stage", async () => {
    h.race = async () => {
      await applyTaskCommentOp("TASK-1", { op: "add", body: "answer", mentions: [] }, "ricardo");
      h.raced.push("answer");
    };
    await actionProgress(identity, { taskId: "TASK-1", stage: "qa", notes: "ready for QA" });
    expect(h.rows.get("TASK-1")!.data.stage).toBe("qa");
    expect(thread().map((c) => c.body)).toEqual(["old", "answer", "ready for QA"]);
  });
});

describe("progress note ids", () => {
  it("gives two notes posted in the same millisecond distinct mcp- ids", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-21T19:00:00Z"));
    try {
      await actionProgress(identity, { taskId: "TASK-1", notes: "first" });
      await actionProgress(identity, { taskId: "TASK-1", notes: "second" });
    } finally {
      now.mockRestore();
    }
    const notes = thread().filter((c) => c.id.startsWith("mcp-"));
    expect(notes.map((c) => c.body)).toEqual(["first", "second"]);
    expect(new Set(notes.map((c) => c.id)).size).toBe(2);
  });
});
