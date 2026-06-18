// Store invariants for flexible buckets (EN-005): create + optimistic edit
// (reconcile-on-success / rollback+notice-on-failure), the allBuckets/bucketById
// getters as the single source of truth, and allow-list clamping. serverCall is
// a no-op under the Node test env; the injected mirror exercises reconcile/rollback.

import { beforeEach, describe, expect, it } from "vitest";

import {
  __bucketCreateSettled,
  __bucketUpdateSettled,
  __setBucketCreateMirrorForTests,
  __setBucketUpdateMirrorForTests,
  activeNotices,
  addBucket,
  allBuckets,
  bucketById,
  resetStore,
  updateBucket,
} from "@/lib/mc-data/store";
import type { Bucket } from "@/lib/mc-data";

const serverBucket = (over: Partial<Bucket>): Bucket => ({
  id: "BKT-SERVER",
  name: "Server",
  owner: "vince",
  health: "track",
  target: "—",
  started: "2026.06.18",
  desc: "",
  repos: [],
  sync: { state: "pending", ts: "—", sp: "Roadmap · unprovisioned" },
  prd: null,
  ...over,
});

beforeEach(() => resetStore());

describe("addBucket (EN-005)", () => {
  it("creates a bucket with a BKT-<slug> id + defaults, visible via allBuckets/bucketById", () => {
    const before = allBuckets().length;
    const b = addBucket({ name: "Mission Control Ops" });
    expect(b.id).toBe("BKT-MISSION-CONTROL-OPS");
    expect(b.health).toBe("track");
    expect(b.owner).toBe("vince"); // CURRENT_USER default
    expect(allBuckets().length).toBe(before + 1);
    expect(bucketById(b.id)?.name).toBe("Mission Control Ops");
  });

  it("suffixes the id on a name collision", () => {
    addBucket({ name: "Ops" });
    expect(addBucket({ name: "Ops" }).id).toBe("BKT-OPS-2");
  });

  it("clamps off-allow-list repos with a non-silent notice", () => {
    const b = addBucket({ name: "Infra X", repos: ["plx-mc", "ghost-repo"] });
    expect(b.repos).toEqual(["plx-mc"]); // ghost-repo dropped
    expect(activeNotices().some((n) => /not in the registry/.test(n.body))).toBe(true);
  });

  it("adopts the server's bucket on a resolved create mirror", async () => {
    __setBucketCreateMirrorForTests(async (input) => serverBucket({ id: "BKT-SERVER", name: input.name }));
    const optimistic = addBucket({ name: "Server Owned" });
    await __bucketCreateSettled();
    expect(bucketById(optimistic.id)).toBeUndefined(); // optimistic id replaced by server id
    expect(bucketById("BKT-SERVER")?.name).toBe("Server Owned");
  });

  it("rolls back the optimistic bucket + notices when the create mirror rejects (never a silent drop)", async () => {
    __setBucketCreateMirrorForTests(async () => {
      throw new Error("POST 500");
    });
    const b = addBucket({ name: "Doomed Initiative" });
    expect(bucketById(b.id)).toBeDefined(); // present optimistically
    await __bucketCreateSettled();
    expect(bucketById(b.id)).toBeUndefined(); // rolled back, not silently kept
    expect(activeNotices().some((n) => /rolled back/i.test(n.body))).toBe(true);
  });
});

describe("updateBucket (EN-005) — optimistic + reconcile/rollback", () => {
  it("applies an edit optimistically", () => {
    const b = addBucket({ name: "Finance Ops" });
    updateBucket(b.id, { health: "risk", target: "Aug 01" });
    expect(bucketById(b.id)?.health).toBe("risk");
    expect(bucketById(b.id)?.target).toBe("Aug 01");
  });

  it("adopts the server's bucket on a resolved mirror", async () => {
    const b = addBucket({ name: "QMS Ops" });
    __setBucketUpdateMirrorForTests(async (id, patch) => ({ ...bucketById(id)!, ...patch, desc: "server-canonical" }));
    await updateBucket(b.id, { health: "off" });
    await __bucketUpdateSettled();
    expect(bucketById(b.id)?.health).toBe("off");
    expect(bucketById(b.id)?.desc).toBe("server-canonical"); // reconciled to DB truth
    expect(activeNotices()).toHaveLength(0); // success path surfaces no notice
  });

  it("rolls back + surfaces a notice when the mirror rejects", async () => {
    const b = addBucket({ name: "WMS Ops" });
    const before = bucketById(b.id)!.health;
    __setBucketUpdateMirrorForTests(async () => {
      throw new Error("PATCH 500");
    });
    await updateBucket(b.id, { health: "off" });
    await __bucketUpdateSettled();
    expect(bucketById(b.id)?.health).toBe(before); // rolled back
    expect(activeNotices().some((n) => /rolled back/i.test(n.body))).toBe(true);
  });
});
