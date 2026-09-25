// POST /api/repos approver gate: in OIDC mode the approver is the signed-in
// Entra session, never the request body's `actor` field (review 2026-09-25).

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  oidc: true,
  session: null as { user?: { email?: string | null } } | null,
  upserts: [] as unknown[],
}));

vi.mock("@/lib/auth", () => ({
  auth: async () => state.session,
  oidcEnabled: () => state.oidc,
}));

vi.mock("@/lib/sync/repo", () => ({
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
  state.upserts = [];
});

describe("POST /api/repos approver gate", () => {
  it("rejects a body-named approver when no session exists (OIDC)", async () => {
    const res = await post({ actor: "vince", repo });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("not_authenticated");
    expect(state.upserts).toHaveLength(0);
  });

  it("uses the session user, not the body actor, for the approver check (OIDC)", async () => {
    state.session = { user: { email: "greg.m@petrasoap.com" } };
    const res = await post({ actor: "vince", repo });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("not_approver");
    expect(state.upserts).toHaveLength(0);
  });

  it("allows an approver session (OIDC) even without a body actor", async () => {
    state.session = { user: { email: "Vince@PetraSoap.com" } };
    const res = await post({ repo });
    expect(res.status).toBe(200);
    expect(state.upserts).toHaveLength(1);
  });

  it("keeps the body actor only in dormant (no OIDC) mode", async () => {
    state.oidc = false;
    expect((await post({ actor: "greg", repo })).status).toBe(403);
    expect((await post({ actor: "vince", repo })).status).toBe(200);
    expect(state.upserts).toHaveLength(1);
  });
});
