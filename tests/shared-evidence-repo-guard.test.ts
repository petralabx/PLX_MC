// TASK-3166 r3: the shared-evidence guard lives on the repo write path, so no
// caller (REST, MCP, SharePoint pull, conflict resolution) can skip it. A bucket
// re-parent, a project restrict and a task move each take the shared-evidence
// lock (exclusive) in the write's own transaction, then refuse (409
// shared_evidence) to put a task with uploaded evidence under a restricted
// project. Real repo.ts over an in-memory `query` stub.
import { beforeEach, describe, expect, it, vi } from "vitest";

type Json = Record<string, unknown>;

const db = vi.hoisted(() => ({
  buckets: new Map<string, Json>(),
  projects: new Map<string, Json>(),
  tasks: new Map<string, Json>(),
  log: [] as string[],
  inTx: false,
}));

vi.mock("@/lib/db", () => {
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    // An xact lock outside a transaction would release at once: the log says so.
    if (/pg_advisory_xact_lock/.test(sql)) {
      db.log.push(`lock:${/_shared/.test(sql) ? "share" : "exclusive"}${db.inTx ? "" : ":no-tx"}`);
      return [];
    }
    if (/^\s*(UPDATE|INSERT INTO) (buckets|projects|entities)/.test(sql)) {
      db.log.push(`write:${/(buckets|projects|entities)/.exec(sql)![1]}:${params[0]}`);
      return [];
    }
    if (/FROM entities\s+WHERE entity_type = 'task' AND data->>'bucket' = ANY/.test(sql)) {
      const ids = params[0] as string[];
      return [...db.tasks.values()]
        .filter((t) => ids.includes(t.bucket as string) && ((t.evidence as Json | undefined)?.artifacts as unknown[] | undefined)?.length)
        .map((t) => ({ id: t.id, evidence: t.evidence }));
    }
    if (/FROM entities WHERE entity_type = \$1 AND id = \$2/.test(sql)) {
      const t = db.tasks.get(params[1] as string);
      return t ? [{ entity_type: "task", id: t.id, data: structuredClone(t), sync_state: "synced", sp_item_id: null, dirty_fields: [], field_attribution: {}, completed_at: null, cancellation: null }] : [];
    }
    if (/FROM buckets b\s+JOIN projects p/.test(sql)) {
      const bucket = db.buckets.get(params[0] as string);
      const project = bucket && db.projects.get(bucket.project as string);
      return project ? [{ data: project }] : [];
    }
    if (/SELECT id FROM buckets b WHERE/.test(sql)) {
      return [...db.buckets.values()].filter((b) => b.project === params[0]).map((b) => ({ id: b.id }));
    }
    if (/AS project FROM buckets b WHERE id = \$1/.test(sql)) {
      const bucket = db.buckets.get(params[0] as string);
      return bucket ? [{ project: bucket.project ?? null }] : [];
    }
    if (/SELECT data FROM projects WHERE id = \$1/.test(sql)) {
      const project = db.projects.get(params[0] as string);
      return project ? [{ data: project }] : [];
    }
    return [];
  });
  const withTransaction = vi.fn(async (fn: (q: typeof query) => Promise<unknown>) => {
    db.inTx = true;
    try {
      return await fn(((sql: string, params?: unknown[]) => query(sql, params)) as typeof query);
    } finally {
      db.inTx = false;
    }
  });
  return { query, withTransaction };
});

import { updateBucket, updateEntity, updateProject, upsertBucket, upsertProject } from "@/lib/sync/repo";
import type { Bucket, Project } from "@/lib/mc-data/types";

const artifact = { kind: "screenshot", name: "a.png", url: "https://sp/a.png", sha256: "ab" };
const refused = {
  code: "shared_evidence",
  status: 409,
  message: expect.stringMatching(/TASK-1 has evidence files in the shared SharePoint evidence library.*A person must relocate the files first\.$/),
};

beforeEach(() => {
  db.log.length = 0;
  db.projects = new Map([
    ["PRJ-SHARED", { id: "PRJ-SHARED", visibility: "shared", members: [] }],
    ["PRJ-SHARED-2", { id: "PRJ-SHARED-2", visibility: "shared", members: [] }],
    ["PRJ-PRIVATE", { id: "PRJ-PRIVATE", visibility: "restricted", members: ["vince"] }],
  ]);
  db.buckets = new Map([
    ["BKT-SHARED", { id: "BKT-SHARED", project: "PRJ-SHARED" }],
    ["BKT-PRIVATE", { id: "BKT-PRIVATE", project: "PRJ-PRIVATE" }],
  ]);
  db.tasks = new Map([
    ["TASK-1", { id: "TASK-1", bucket: "BKT-SHARED", stage: "progress", evidence: { summary: "", items: [], artifacts: [artifact] } }],
    ["TASK-2", { id: "TASK-2", bucket: "BKT-PRIVATE", stage: "progress", evidence: { summary: "", items: [] } }],
  ]);
});

describe("bucket re-parent under a restricted project", () => {
  it("updateBucket (the SharePoint Roadmap pull and conflict paths) refuses under the exclusive lock and writes nothing", async () => {
    await expect(updateBucket("BKT-SHARED", { patch: { project: "PRJ-PRIVATE" } })).rejects.toMatchObject(refused);
    expect(db.log).toEqual(["lock:exclusive"]);
  });

  it("upsertBucket (patchBucket) refuses the same way", async () => {
    await expect(upsertBucket({ id: "BKT-SHARED", project: "PRJ-PRIVATE" } as unknown as Bucket, [])).rejects.toMatchObject(refused);
    expect(db.log).toEqual(["lock:exclusive"]);
  });

  it("still writes a re-parent to a shared project, a no-op parent, and a non-parent edit", async () => {
    await updateBucket("BKT-SHARED", { patch: { project: "PRJ-SHARED-2" } });
    await upsertBucket({ id: "BKT-SHARED", project: "PRJ-SHARED" } as unknown as Bucket);
    await updateBucket("BKT-SHARED", { patch: { name: "x" } as Partial<Bucket> });
    expect(db.log).toEqual(["lock:exclusive", "write:buckets:BKT-SHARED", "lock:exclusive", "write:buckets:BKT-SHARED", "write:buckets:BKT-SHARED"]);
  });

  it("still re-parents a bucket whose tasks have no evidence", async () => {
    (db.tasks.get("TASK-1")!.evidence as Json).artifacts = [];
    await updateBucket("BKT-SHARED", { patch: { project: "PRJ-PRIVATE" } });
    expect(db.log).toEqual(["lock:exclusive", "write:buckets:BKT-SHARED"]);
  });
});

describe("project restrict", () => {
  it("upsertProject (patchProject) refuses to restrict a project holding evidence", async () => {
    await expect(upsertProject({ id: "PRJ-SHARED", visibility: "restricted", members: ["vince"] } as unknown as Project)).rejects.toMatchObject(refused);
    expect(db.log).toEqual(["lock:exclusive"]);
  });

  it("updateProject refuses a visibility patch to restricted", async () => {
    await expect(updateProject("PRJ-SHARED", { patch: { visibility: "restricted", members: ["vince"] } as Partial<Project> })).rejects.toMatchObject(refused);
    expect(db.log).toEqual(["lock:exclusive"]);
  });

  it("still edits an already restricted project, and restricts one without evidence", async () => {
    await upsertProject({ id: "PRJ-PRIVATE", visibility: "restricted", members: ["vince"] } as unknown as Project);
    await upsertProject({ id: "PRJ-SHARED-2", visibility: "restricted", members: ["vince"] } as unknown as Project);
    expect(db.log).toEqual(["lock:exclusive", "write:projects:PRJ-PRIVATE", "lock:exclusive", "write:projects:PRJ-SHARED-2"]);
  });
});

describe("task move", () => {
  it("updateEntity refuses to move a task with evidence into a restricted project's bucket", async () => {
    await expect(updateEntity("task", "TASK-1", { patch: { bucket: "BKT-PRIVATE" } })).rejects.toMatchObject(refused);
    expect(db.log).toEqual(["lock:exclusive"]);
  });

  it("still moves a task without evidence", async () => {
    await updateEntity("task", "TASK-2", { patch: { bucket: "BKT-SHARED" } });
    expect(db.log).toEqual(["write:entities:task"]);
  });
});
