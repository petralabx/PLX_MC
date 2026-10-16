// POST /api/repos approver gate: in OIDC mode the approver is the signed-in
// Entra session, never the request body's `actor` field (review 2026-09-25),
// and its mc_users row decides (TASK-3010); a session with no row falls back to
// the HUMANS directory role while the app roles are rolled out.

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  oidc: true,
  session: null as { user?: { email?: string | null; oid?: string | null } } | null,
  mcUsers: {} as Record<string, { accessRole: "owner" | "admin" | "member"; status: "active" | "revoked" }>,
  upserts: [] as unknown[],
  requests: [] as unknown[],
}));

vi.mock("@/lib/auth", () => ({
  auth: async () => state.session,
  oidcEnabled: () => state.oidc,
}));

vi.mock("@/lib/permissions/repository", () => ({
  findMcUserByEntraOid: async (oid: string) => {
    const row = state.mcUsers[oid];
    return row ? { id: `usr_${oid}`, entraOid: oid, email: `${oid}@petrasoap.com`, ...row } : null;
  },
}));

vi.mock("@/lib/sync/repo", () => ({
  getRepoRequests: async () => state.requests,
  upsertRepo: async (repo: unknown) => {
    state.upserts.push(repo);
  },
}));

import { POST } from "@/app/api/repos/route";

const repo = {
  id: "spoofed",
  name: "spoofed",
  lang: "TypeScript",
  def: "main",
  owner: "petralabx",
  visibility: "private",
  scope: "",
};

async function post(body: unknown) {
  const res = await POST(
    new Request("http://localhost/api/repos", { method: "POST", body: JSON.stringify(body) }),
    { params: Promise.resolve({}) }
  );
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  state.oidc = true;
  state.session = null;
  state.mcUsers = {};
  state.upserts = [];
  state.requests = [];
});

describe("POST /api/repos approver gate", () => {
  it("rejects a body-named approver when no session exists (OIDC)", async () => {
    const res = await post({ actor: "vince", repo });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("not_authenticated");
    expect(state.upserts).toHaveLength(0);
  });

  it("uses the session user, not the body actor, for the approver check (OIDC)", async () => {
    state.session = { user: { email: "greg.m@petrasoap.com", oid: "oid-greg" } };
    state.mcUsers = { "oid-greg": { accessRole: "member", status: "active" } };
    const res = await post({ actor: "vince", repo });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("not_approver");
    expect(state.upserts).toHaveLength(0);
  });

  it("allows an admin mc_users row (OIDC) even without a body actor or a directory entry", async () => {
    state.session = { user: { email: "new.admin@petrasoap.com", oid: "oid-new-admin" } };
    state.mcUsers = { "oid-new-admin": { accessRole: "admin", status: "active" } };
    const res = await post({ repo });
    expect(res.status).toBe(200);
    expect(state.upserts).toHaveLength(1);
  });

  it("transitional: an Owner in the HUMANS directory with no mc_users row falls back to the directory role, logged (OIDC)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    state.session = { user: { email: "Vince@PetraSoap.com", oid: "oid-vince" } };
    const res = await post({ repo });
    expect(res.status).toBe(200);
    expect(state.upserts).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("no mc_users row"), "vince@petrasoap.com");
    warn.mockRestore();
  });

  it("refuses a session with no mc_users row whose directory role is not an approver (OIDC)", async () => {
    for (const email of ["greg.m@petrasoap.com", "stranger@petrasoap.com"]) {
      state.session = { user: { email, oid: `oid-${email}` } };
      const res = await post({ repo });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("not_approver");
    }
    expect(state.upserts).toHaveLength(0);
  });

  it("refuses a revoked owner row and a session without an Entra oid (OIDC)", async () => {
    state.session = { user: { email: "vince@petrasoap.com", oid: "oid-vince" } };
    state.mcUsers = { "oid-vince": { accessRole: "owner", status: "revoked" } };
    expect((await post({ repo })).status).toBe(403);
    state.session = { user: { email: "vince@petrasoap.com" } };
    const res = await post({ repo });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("not_authenticated");
    expect(state.upserts).toHaveLength(0);
  });

  it("keeps the body actor only in dormant (no OIDC) mode", async () => {
    state.oidc = false;
    expect((await post({ actor: "greg", repo })).status).toBe(403);
    expect((await post({ actor: "vince", repo })).status).toBe(200);
    expect(state.upserts).toHaveLength(1);
  });

  it("refuses to add a repo the session itself has a pending request for (TASK-3011)", async () => {
    state.session = { user: { email: "vince@petrasoap.com", oid: "oid-vince" } };
    state.mcUsers = { "oid-vince": { accessRole: "owner", status: "active" } };
    state.requests = [
      { id: "RR-1", name: "spoofed", owner: "petralabx", requestedBy: "vince", requestedTs: "t", status: "pending", verified: true },
    ];
    const res = await post({ repo });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("self_approval");
    expect(state.upserts).toHaveLength(0);
  });
});
