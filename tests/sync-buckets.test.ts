// Server invariants for flexible buckets (EN-005): createBucket id-generation,
// defaults, allow-list enforcement against the PERSISTED registry, collision
// suffixing, and patchBucket merge / unknown-id. engine + db repo are mocked.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bucket } from "@/lib/mc-data";

const store = vi.hoisted(() => ({
  repos: [] as { id: string; name: string; lang: string; def: string; owner: string; visibility: string; scope: string }[],
  buckets: [] as Bucket[],
  upserts: [] as Bucket[],
}));

vi.mock("@/lib/sync/engine", () => ({
  ensureSeeded: vi.fn(async () => true),
  ensureReposSeeded: vi.fn(async () => {}),
  ensureProjectsSeeded: vi.fn(async () => {}),
  ensureBucketsSeeded: vi.fn(async () => {}),
}));

vi.mock("@/lib/sync/repo", () => ({
  stamp: () => "2026.06.18 · 12:00",
  async getRepos() {
    return store.repos;
  },
  async getBuckets() {
    return store.buckets;
  },
  async upsertBucket(b: Bucket) {
    store.upserts.push(b);
  },
  async appendAudit() {
    /* no-op */
  },
}));

import { createBucket, patchBucket } from "@/lib/sync/state";

beforeEach(() => {
  store.repos = [
    { id: "plx-mc", name: "PLX_MC", lang: "TypeScript", def: "main", owner: "taylorvalton", visibility: "public", scope: "MC" },
  ];
  store.buckets = [];
  store.upserts.length = 0;
});

describe("createBucket (EN-005)", () => {
  it("generates a BKT-<slug> id, applies defaults, and upserts the bucket", async () => {
    const b = await createBucket({ name: "Mission Control Ops" });
    expect(b.id).toBe("BKT-MISSION-CONTROL-OPS");
    expect(b.owner).toBe("vince"); // CURRENT_USER default
    expect(b.health).toBe("track");
    expect(b.sync.state).toBe("pending");
    expect(store.upserts).toHaveLength(1);
    expect(store.upserts[0].id).toBe(b.id);
  });

  it("rejects repos not in the persisted registry", async () => {
    await expect(createBucket({ name: "Bad", repos: ["ghost-repo"] })).rejects.toMatchObject({
      code: "repo_not_allowed",
    });
    expect(store.upserts).toHaveLength(0);
  });

  it("accepts a repo that IS in the persisted registry", async () => {
    const b = await createBucket({ name: "MC Work", repos: ["plx-mc"] });
    expect(b.repos).toEqual(["plx-mc"]);
  });

  it("suffixes the id on collision with an existing bucket", async () => {
    store.buckets = [{ id: "BKT-OPS" } as Bucket];
    const b = await createBucket({ name: "Ops" });
    expect(b.id).toBe("BKT-OPS-2");
  });
});

describe("patchBucket (EN-005)", () => {
  it("merges defined fields and upserts; ignores unknown id", async () => {
    store.buckets = [
      { id: "BKT-FIN", name: "Finance", owner: "vince", health: "track", target: "Jul 20", started: "2026.06.11", desc: "x", repos: [], sync: { state: "pending", ts: "—", sp: "Roadmap · unprovisioned" }, prd: null },
    ];
    const updated = await patchBucket("BKT-FIN", { health: "risk", target: "Aug 01" }, "vince");
    expect(updated?.health).toBe("risk");
    expect(updated?.target).toBe("Aug 01");
    expect(updated?.name).toBe("Finance"); // unchanged
    expect(store.upserts[0].health).toBe("risk");

    expect(await patchBucket("BKT-NOPE", { health: "off" }, "vince")).toBeNull();
  });

  it("seeds the registry then validates edited repos against the PERSISTED allow-list", async () => {
    const engine = await import("@/lib/sync/engine");
    store.buckets = [
      { id: "BKT-FIN", name: "Finance", owner: "vince", health: "track", target: "—", started: "2026.06.11", desc: "", repos: [], sync: { state: "pending", ts: "—", sp: "Roadmap · unprovisioned" }, prd: null },
    ];
    await expect(patchBucket("BKT-FIN", { repos: ["ghost-repo"] }, "vince")).rejects.toMatchObject({
      code: "repo_not_allowed",
    });
    const ok = await patchBucket("BKT-FIN", { repos: ["plx-mc"] }, "vince");
    expect(ok?.repos).toEqual(["plx-mc"]);
    // The registry is seeded before the allow-list check (else fresh-DB edits would wrongly reject).
    expect(engine.ensureReposSeeded).toHaveBeenCalled();
  });
});
