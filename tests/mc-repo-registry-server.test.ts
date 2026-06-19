// EN-005 / WS-5 — the server-side repo-registry fix proven without a live
// database. The PRIMARY regression (Goal: kill the allow-list drift) is that
// `createTask` validates against the PERSISTED RUNTIME registry, not the static
// REPOS fixture — so a repo approved at runtime (absent from the fixture) is
// accepted server-side, exactly the case that used to fail (EN-005 obs. #7). The
// registry + GitHub seams are mocked in-memory (same technique as
// tests/mc-patch.test.ts / tests/compliance-server.test.ts), so this exercises the
// real orchestration: allow-list check, approver gate, and the re-validation gate
// that keeps an unverified repo off the allow-list.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Repo, RepoRequest } from "@/lib/mc-data";
import type { RepoValidation } from "@/lib/sync/github";

const db = vi.hoisted(() => ({
  repos: new Map<string, Repo>(),
  requests: new Map<string, RepoRequest>(),
  github: { ok: true } as RepoValidation,
}));

vi.mock("@/lib/sync/engine", () => ({
  ensureSeeded: vi.fn(async () => true),
}));

vi.mock("@/lib/sync/github", () => ({
  validateRepoInOrg: vi.fn(async () => db.github),
}));

vi.mock("@/lib/sync/registry", () => ({
  async ensureRegistrySeeded() {
    return false;
  },
  async getRegistry() {
    return Object.fromEntries(db.repos);
  },
  async getRequests() {
    return [...db.requests.values()];
  },
  async getRequest(id: string) {
    return db.requests.get(id) ?? null;
  },
  async insertRepo(repo: Repo) {
    if (!db.repos.has(repo.id)) db.repos.set(repo.id, repo);
  },
  async upsertRequest(req: { id: string; name: string; owner: string; scope?: string | null; requestedBy: string }) {
    const existing = db.requests.get(req.id);
    if (!existing || existing.status === "rejected") {
      db.requests.set(req.id, {
        id: req.id,
        name: req.name,
        owner: req.owner,
        scope: req.scope ?? undefined,
        requestedBy: req.requestedBy,
        requestedTs: "t",
        status: "pending",
        verified: false,
      });
    }
  },
  async setRequestVerification(
    id: string,
    v: { verified: boolean; visibility?: Repo["visibility"]; def?: string; lang?: string; note?: string }
  ) {
    const r = db.requests.get(id);
    if (!r) return;
    r.verified = v.verified;
    if (v.visibility) r.visibility = v.visibility;
    if (v.def) r.def = v.def;
    if (v.lang) r.lang = v.lang;
    r.note = v.note;
  },
  async markRequestDecided(id: string, status: "approved" | "rejected", decidedBy: string) {
    const r = db.requests.get(id);
    if (r && r.status === "pending") {
      r.status = status;
      r.decidedBy = decidedBy;
      r.decidedTs = "t";
    }
  },
}));

vi.mock("@/lib/sync/repo", () => ({
  stamp: () => "2026.06.19 · 00:00",
  async getEntities() {
    return [];
  },
  async insertEntity() {},
  async appendAudit() {},
}));

// Imported AFTER the mocks so state.ts's `import * as registry/repo` + github
// resolve to the mocked modules.
import { approveRepoRequest, createRepoRequest, createTask, rejectRepoRequest } from "@/lib/sync/state";

const pendingRequest = (over: Partial<RepoRequest> & { id: string; name: string }): RepoRequest => ({
  owner: "taylorvalton",
  requestedBy: "greg",
  requestedTs: "t",
  status: "pending",
  verified: true,
  ...over,
});

beforeEach(() => {
  db.repos.clear();
  db.requests.clear();
  db.github = { ok: true, visibility: "private", def: "main", lang: "TypeScript" };
});

describe("createTask allow-list reads the RUNTIME registry (EN-005 drift fix)", () => {
  it("accepts a repo present in the runtime registry but absent from the static REPOS fixture", async () => {
    // A self-service repo approved at runtime — NOT one of the three canonical
    // fixture repos. Before the fix the server validated against static REPOS and
    // rejected this; now it reads the persisted registry and accepts it.
    db.repos.set("runtime-tool", {
      id: "runtime-tool",
      name: "runtime-tool",
      lang: "TypeScript",
      def: "main",
      owner: "taylorvalton",
      visibility: "private",
      scope: "approved at runtime",
    });
    const task = await createTask({ title: "t", bucket: "BKT-WMS", reporter: "vince", repos: ["runtime-tool"] });
    expect(task.repos).toEqual(["runtime-tool"]);
  });

  it("rejects a repo that is not in the runtime registry", async () => {
    await expect(
      createTask({ title: "t", bucket: "BKT-WMS", reporter: "vince", repos: ["ghost"] })
    ).rejects.toMatchObject({ code: "repo_not_allowed" });
  });
});

describe("createRepoRequest", () => {
  it("persists a deterministic-id request and records the GitHub validation outcome", async () => {
    db.github = { ok: true, visibility: "public", def: "main", lang: "Go" };
    const req = await createRepoRequest({ name: "My Tool", requestedBy: "greg" });
    expect(req.id).toBe("RR-my-tool");
    expect(req.verified).toBe(true);
    expect(req.visibility).toBe("public");
  });

  it("records an unverified outcome rather than fabricating membership", async () => {
    db.github = { ok: false, note: "not found in the org" };
    const req = await createRepoRequest({ name: "ghost-repo", requestedBy: "greg" });
    expect(req.verified).toBe(false);
    expect(req.note).toContain("not found");
  });
});

describe("approveRepoRequest — approver gate + re-validation boundary", () => {
  it("promotes a request to the persisted registry for an approver", async () => {
    db.requests.set("RR-new-tool", pendingRequest({ id: "RR-new-tool", name: "new-tool" }));
    db.github = { ok: true, visibility: "public", def: "main", lang: "TypeScript" };
    const res = await approveRepoRequest("RR-new-tool", "vince"); // vince = Owner
    expect(res.repos["new-tool"]?.name).toBe("new-tool");
    expect(db.requests.get("RR-new-tool")?.status).toBe("approved");
  });

  it("blocks a non-approver (Contributor or agent) and never mutates the registry", async () => {
    db.requests.set("RR-x", pendingRequest({ id: "RR-x", name: "x" }));
    await expect(approveRepoRequest("RR-x", "greg")).rejects.toMatchObject({ code: "not_approver" });
    await expect(approveRepoRequest("RR-x", "vibes")).rejects.toMatchObject({ code: "not_approver" });
    expect(db.repos.size).toBe(0);
    expect(db.requests.get("RR-x")?.status).toBe("pending");
  });

  it("refuses an unverified/vanished repo at the re-validation boundary (never reaches the allow-list)", async () => {
    db.requests.set("RR-ghost", pendingRequest({ id: "RR-ghost", name: "ghost", verified: true }));
    db.github = { ok: false, note: "not found in the org" };
    await expect(approveRepoRequest("RR-ghost", "vince")).rejects.toMatchObject({ code: "repo_unverified" });
    expect(db.repos.get("ghost")).toBeUndefined();
    expect(db.requests.get("RR-ghost")?.status).toBe("pending");
  });
});

describe("rejectRepoRequest", () => {
  it("marks a request rejected for an approver without touching the registry", async () => {
    db.requests.set("RR-wontfix", pendingRequest({ id: "RR-wontfix", name: "wontfix" }));
    await rejectRepoRequest("RR-wontfix", "vince");
    expect(db.requests.get("RR-wontfix")?.status).toBe("rejected");
    expect(db.repos.size).toBe(0);
  });

  it("blocks a non-approver", async () => {
    db.requests.set("RR-keep", pendingRequest({ id: "RR-keep", name: "keep" }));
    await expect(rejectRepoRequest("RR-keep", "greg")).rejects.toMatchObject({ code: "not_approver" });
    expect(db.requests.get("RR-keep")?.status).toBe("pending");
  });
});
