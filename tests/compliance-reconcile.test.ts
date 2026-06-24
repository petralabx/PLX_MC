// EN-007 P2 — fail-closed reconciliation. A degraded MC must HOLD (never pass)
// and enqueue; recovery must replay + resolve. Proven against a mocked repo seam
// (no DB): a `fail` toggle makes the DB writes throw to simulate an outage.
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  fail: { on: false },
  seq: 0,
  queue: [] as { id: string; kind: string; payload: Record<string, unknown>; attempts: number; resolved: boolean }[],
  events: [] as { kind: string }[],
}));

vi.mock("@/lib/compliance/repo", () => ({
  async getDispatch() {
    return null;
  },
  async recordCheck() {
    if (db.fail.on) throw new Error("db down");
  },
  async appendEvent(e: { kind: string }) {
    if (db.fail.on) throw new Error("db down");
    db.events.push(e);
  },
  async enqueueReconcile(kind: string, payload: Record<string, unknown>) {
    db.queue.push({ id: String(++db.seq), kind, payload, attempts: 0, resolved: false });
  },
  async pendingReconcile() {
    return db.queue.filter((r) => !r.resolved);
  },
  async resolveReconcile(id: string) {
    const r = db.queue.find((x) => x.id === id);
    if (r) r.resolved = true;
  },
  async bumpReconcileAttempt(id: string) {
    const r = db.queue.find((x) => x.id === id);
    if (r) r.attempts += 1;
  },
}));

vi.mock("@/lib/sync/repo", () => ({
  async getEntity(type: string, id: string) {
    return {
      entity_type: type,
      id,
      data: {
        id,
        bucket: "BKT-WMS",
        accountableOwner: "greg",
        evidence: { summary: "ok", items: [{ key: "a", label: "a", done: true }], rollback: "revert" },
      },
      sync_state: "synced",
      sp_item_id: null,
      dirty_fields: [],
    };
  },
}));

import { ingestOrQueue, reconcileSweep, verifyPrOrQueue } from "@/lib/compliance/service";

const pending = () => db.queue.filter((r) => !r.resolved);

beforeEach(() => {
  db.fail.on = false;
  db.seq = 0;
  db.queue.length = 0;
  db.events.length = 0;
});

describe("fail-closed verify", () => {
  it("holds (pending) and enqueues when MC is degraded — never passes", async () => {
    db.fail.on = true;
    const r = await verifyPrOrQueue({ repo: "PLX_MC", prNumber: 1, headSha: "a", changedPaths: ["src/x.ts"] });
    expect(r.verdict).toBe("pending");
    expect("queued" in r && r.queued).toBe(true);
    expect(pending()).toHaveLength(1);
    expect(pending()[0].kind).toBe("verify");
  });

  it("ingest queues on failure too", async () => {
    db.fail.on = true;
    const evt = { action: "opened", merged: false, repo: "PLX_MC", prNumber: 9, headSha: "z", branch: "f", title: "t", author: "greg", labels: [], checkoutId: null, checkoutIds: [] };
    const r = await ingestOrQueue(evt);
    expect(r).toMatchObject({ ingested: false, queued: true });
    expect(pending().some((q) => q.kind === "ingest")).toBe(true);
  });
});

describe("reconcileSweep — replay on recovery", () => {
  it("resolves queued work once MC is back", async () => {
    db.fail.on = true;
    await verifyPrOrQueue({ repo: "PLX_MC", prNumber: 1, headSha: "a", changedPaths: ["src/x.ts"] });
    expect(pending()).toHaveLength(1);

    db.fail.on = false; // MC recovers
    const res = await reconcileSweep();
    expect(res).toMatchObject({ processed: 1, resolved: 1, failed: 0 });
    expect(pending()).toHaveLength(0);
  });

  it("keeps the row + bumps attempts when replay still fails", async () => {
    db.fail.on = true;
    await verifyPrOrQueue({ repo: "PLX_MC", prNumber: 2, headSha: "b", changedPaths: ["src/y.ts"] });

    const res = await reconcileSweep(); // still degraded
    expect(res).toMatchObject({ processed: 1, resolved: 0, failed: 1 });
    expect(pending()).toHaveLength(1);
    expect(pending()[0].attempts).toBe(1);
  });
});
