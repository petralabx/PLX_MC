// Bucket-comment persistence invariants (Item 4): the DB accessors' safety
// contract — one locked, parameterized, author-checked operation per write, and
// the grouped read maps rows back to the Comment shape. The db layer is mocked
// so the test is hermetic.

import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  calls: [] as { text: string; params: unknown[] }[],
  rows: [] as unknown[],
  respond: null as ((text: string) => unknown[]) | null,
}));

vi.mock("@/lib/db", () => ({
  async query(text: string, params: unknown[] = []) {
    db.calls.push({ text, params });
    return db.respond ? db.respond(text) : db.rows;
  },
  // Run the transaction body with a capturing query, like the real client.
  async withTransaction(fn: (q: (t: string, p?: unknown[]) => Promise<unknown[]>) => Promise<unknown>) {
    const q = async (text: string, params: unknown[] = []) => {
      db.calls.push({ text, params });
      return db.respond ? db.respond(text) : db.rows;
    };
    return fn(q);
  },
}));

import { applyBucketCommentOp, bucketCommentsByBucket } from "@/lib/sync/repo";

beforeEach(() => {
  db.calls.length = 0;
  db.rows = [];
  db.respond = null;
});

// TASK-3011: one comment operation per request, in one transaction under a
// per-bucket advisory lock. The author is the session (passed in by the route),
// the id is server-generated, and only the author can edit or delete.
describe("applyBucketCommentOp — per-operation, author-checked, locked", () => {
  const thread = [{ bucket_id: "BKT-WMS", id: "CMT-1", author: "vince", body: "a", mentions: [], ts: "t1", edited_ts: null }];
  const respond = (owner: string | null) => (text: string) => {
    if (text.includes("FOR UPDATE")) return owner ? [{ author: owner }] : [];
    if (text.startsWith("SELECT bucket_id")) return thread;
    return [];
  };

  it("adds under the given author with a server id, after taking the bucket lock", async () => {
    db.respond = respond(null);
    const out = await applyBucketCommentOp("BKT-WMS", { op: "add", body: "hi @greg", mentions: ["greg"] }, "greg");
    expect(db.calls[0].text).toContain("pg_advisory_xact_lock");
    expect(db.calls[0].params).toEqual(["bucket_comments:BKT-WMS"]);
    const insert = db.calls.find((c) => c.text.includes("INSERT INTO bucket_comments"))!;
    expect(insert.text).not.toContain("hi @greg"); // bound, never interpolated
    expect(insert.params[0]).toBe("BKT-WMS");
    expect(String(insert.params[1])).toMatch(/^CMT-[0-9a-f-]{36}$/);
    expect(insert.params[2]).toBe("greg");
    expect(insert.params[3]).toBe("hi @greg");
    expect(out).toEqual([{ id: "CMT-1", author: "vince", body: "a", mentions: [], ts: "t1" }]);
    const read = db.calls[db.calls.length - 1];
    expect(read.text).toContain("WHERE bucket_id = $1");
    expect(read.params).toEqual(["BKT-WMS"]);
  });

  it("edits only the author's own comment", async () => {
    db.respond = respond("greg");
    await applyBucketCommentOp("BKT-WMS", { op: "edit", id: "CMT-1", body: "edited", mentions: [] }, "greg");
    const update = db.calls.find((c) => c.text.startsWith("UPDATE bucket_comments"))!;
    expect(update.params.slice(0, 4)).toEqual(["BKT-WMS", "CMT-1", "edited", "[]"]);
  });

  it("refuses to edit or delete someone else's comment (403) and writes nothing", async () => {
    db.respond = respond("vince");
    for (const op of [
      { op: "edit" as const, id: "CMT-1", body: "hijack", mentions: [] },
      { op: "delete" as const, id: "CMT-1" },
    ]) {
      await expect(applyBucketCommentOp("BKT-WMS", op, "greg")).rejects.toMatchObject({ status: 403 });
    }
    expect(db.calls.some((c) => /^(UPDATE|DELETE)/.test(c.text))).toBe(false);
  });

  it("404s an unknown comment id", async () => {
    db.respond = respond(null);
    await expect(applyBucketCommentOp("BKT-WMS", { op: "delete", id: "CMT-404" }, "greg")).rejects.toMatchObject({
      status: 404,
    });
  });

  it("deletes the author's own comment by bucket and id", async () => {
    db.respond = respond("greg");
    await applyBucketCommentOp("BKT-WMS", { op: "delete", id: "CMT-1" }, "greg");
    const del = db.calls.find((c) => c.text.startsWith("DELETE FROM bucket_comments"))!;
    expect(del.text).toContain("WHERE bucket_id = $1 AND id = $2");
    expect(del.params).toEqual(["BKT-WMS", "CMT-1"]);
  });
});

describe("bucketCommentsByBucket — grouped read + row mapping", () => {
  it("groups rows by bucket id and maps mentions/editedTs", async () => {
    db.rows = [
      { bucket_id: "BKT-WMS", id: "CMT-1", author: "vince", body: "a", mentions: ["greg"], ts: "t1", edited_ts: null },
      { bucket_id: "BKT-WMS", id: "CMT-2", author: "vince", body: "b", mentions: [], ts: "t2", edited_ts: "t3" },
      { bucket_id: "BKT-FIN", id: "CMT-9", author: "ross", body: "c", mentions: [], ts: "t4", edited_ts: null },
    ];
    const grouped = await bucketCommentsByBucket();
    expect(grouped["BKT-WMS"]).toHaveLength(2);
    expect(grouped["BKT-WMS"][0].mentions).toEqual(["greg"]);
    expect(grouped["BKT-WMS"][0].editedTs).toBeUndefined();
    expect(grouped["BKT-WMS"][1].editedTs).toBe("t3");
    expect(grouped["BKT-FIN"]).toHaveLength(1);
    expect(grouped["BKT-FIN"][0].author).toBe("ross");
  });
});
