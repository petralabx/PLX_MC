// TASK-2528: entities.completed_at is written once, on first entry into a
// terminal stage, by updateEntity (the single stage-change write path), and is
// never copied into the jsonb payload. Real repo.ts, stubbed `query`.
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  row: null as null | Record<string, unknown>,
  updates: [] as { sql: string; params: unknown[] }[],
}));

vi.mock("@/lib/db", () => ({
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    if (/^\s*UPDATE entities/.test(sql)) {
      db.updates.push({ sql, params });
      return [];
    }
    if (/FROM entities WHERE entity_type = \$1 AND id = \$2/.test(sql)) return db.row ? [db.row] : [];
    return [];
  }),
  withTransaction: vi.fn(),
}));

import { getEntity, updateEntity } from "@/lib/sync/repo";

function seed(stage: string, completedAt: Date | null = null, entityType = "task") {
  db.row = {
    entity_type: entityType,
    id: "TASK-1",
    data: { id: "TASK-1", stage, title: "t" },
    sync_state: "synced",
    sp_item_id: "7",
    dirty_fields: [],
    field_attribution: {},
    completed_at: completedAt,
  };
}

// completed_at param ($9) and the persisted jsonb ($3) of the last UPDATE.
function lastUpdate() {
  const u = db.updates.at(-1)!;
  return { completedAtParam: u.params[8] as string | null, data: JSON.parse(u.params[2] as string) };
}

beforeEach(() => {
  db.row = null;
  db.updates.length = 0;
});

describe("getEntity", () => {
  it("merges completed_at into a task as an ISO completedAt", async () => {
    seed("merged", new Date("2026-07-23T15:04:05.000Z"));
    const row = await getEntity("task", "TASK-1");
    expect(row!.data.completedAt).toBe("2026-07-23T15:04:05.000Z");
  });

  it("leaves completedAt off tasks with a NULL column", async () => {
    seed("progress");
    expect((await getEntity("task", "TASK-1"))!.data).not.toHaveProperty("completedAt");
  });
});

describe("updateEntity completed_at write rules", () => {
  it("stamps on first entry into merged", async () => {
    seed("review");
    await updateEntity("task", "TASK-1", { patch: { stage: "merged" } });
    expect(lastUpdate().completedAtParam).toEqual(expect.stringMatching(/^\d{4}-\d\d-\d\dT/));
  });

  it("stamps on a straight move into verified", async () => {
    seed("progress");
    await updateEntity("task", "TASK-1", { patch: { stage: "verified" } });
    expect(lastUpdate().completedAtParam).not.toBeNull();
  });

  it("uses the supplied time (PR merge time), not now", async () => {
    seed("progress");
    await updateEntity("task", "TASK-1", {
      patch: { stage: "merged" },
      completedAt: "2026-07-23T10:00:00.000Z",
    });
    expect(lastUpdate().completedAtParam).toBe("2026-07-23T10:00:00.000Z");
  });

  it("the UPDATE only fills a NULL column and only on task rows (write-once)", async () => {
    seed("review");
    await updateEntity("task", "TASK-1", { patch: { stage: "merged" } });
    const { sql } = db.updates.at(-1)!;
    expect(sql).toMatch(/entity_type = 'task'\s+THEN COALESCE\(completed_at, \$9::timestamptz\)/);
  });

  it.each([
    ["merged -> verified", "merged", "verified"],
    ["verified -> merged", "verified", "merged"],
  ])("does not re-stamp %s", async (_n, from, to) => {
    seed(from, new Date("2026-07-23T00:00:00Z"));
    await updateEntity("task", "TASK-1", { patch: { stage: to }, completedAt: "2026-10-06T00:00:00.000Z" });
    expect(lastUpdate().completedAtParam).toBeNull();
  });

  it("offers a time again on merged -> review -> merged but COALESCE keeps the original", async () => {
    seed("review", new Date("2026-07-23T00:00:00Z"));
    await updateEntity("task", "TASK-1", { patch: { stage: "merged" } });
    // The param is only a candidate; the SQL guard (asserted above) keeps the stored value.
    expect(db.updates.at(-1)!.sql).toContain("COALESCE(completed_at, $9::timestamptz)");
  });

  it.each([
    ["a non-stage payload rewrite", { title: "renamed" }],
    ["a move to a non-terminal stage", { stage: "review" }],
  ])("passes no timestamp for %s", async (_n, patch) => {
    seed("merged", new Date("2026-07-23T00:00:00Z"));
    await updateEntity("task", "TASK-1", { patch });
    expect(lastUpdate().completedAtParam).toBeNull();
  });

  it("never persists completedAt into the jsonb payload, even if the row carries it", async () => {
    seed("merged", new Date("2026-07-23T00:00:00Z"));
    const row = await getEntity("task", "TASK-1");
    expect(row!.data.completedAt).toBeDefined();
    await updateEntity("task", "TASK-1", { patch: { title: "renamed" } });
    expect(lastUpdate().data).not.toHaveProperty("completedAt");
    await updateEntity("task", "TASK-1", { patch: { completedAt: "2030-01-01T00:00:00Z" } });
    expect(lastUpdate().data).not.toHaveProperty("completedAt");
  });

  it("passes no timestamp for non-task entities", async () => {
    seed("open", null, "risk");
    await updateEntity("risk", "TASK-1", { patch: { stage: "merged" } });
    expect(lastUpdate().completedAtParam).toBeNull();
  });
});

describe("migration 033", () => {
  const sql = readFileSync(
    path.join(process.cwd(), "db/migrations/033_entities_completed_at_cancellation.sql"),
    "utf8"
  );

  it("adds both nullable columns idempotently", () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS completed_at timestamptz,/);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS cancellation jsonb;/);
  });

  it("restricts both columns to task rows with a CHECK", () => {
    expect(sql).toContain(
      "CHECK (entity_type = 'task' OR (completed_at IS NULL AND cancellation IS NULL))"
    );
  });

  it("creates the partial reporting index and documents the rollback", () => {
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS entities_task_completed_at_idx\s+ON entities \(completed_at\)\s+WHERE entity_type = 'task' AND completed_at IS NOT NULL;/
    );
    for (const stmt of [
      "DROP INDEX IF EXISTS entities_task_completed_at_idx;",
      "DROP CONSTRAINT IF EXISTS entities_task_only_completion_chk;",
      "DROP COLUMN IF EXISTS cancellation;",
      "DROP COLUMN IF EXISTS completed_at;",
    ]) {
      expect(sql).toContain(stmt);
    }
  });
});
