// GET|PATCH /api/nav-prefs (TASK-3855): the envelope, a change of one or both
// preferences (a field left out keeps its value), the body rules, whose
// preferences they are (the session's Entra object id, never the body; the
// operator in dormant local/test mode), and the store's two paths: the memory
// fallback and the single statement on nav_prefs. The route runs the real
// requireSessionActor; only the session, the identity row and the decision log
// are seams (as in tests/stars-routes.test.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  oidc: true,
  session: null as { user?: { oid?: string | null; email?: string | null } } | null,
  status: "active" as "active" | "revoked",
}));

vi.mock("@/lib/auth", () => ({
  auth: async () => authState.session,
  oidcEnabled: () => authState.oidc,
}));

vi.mock("@/lib/permissions/repository", () => ({
  findMcUserByEntraOid: async (oid: string) => ({
    id: "u1",
    entraOid: oid,
    email: "member@petrasoap.com",
    accessRole: "member",
    status: authState.status,
  }),
  findServicePrincipalById: async () => null,
}));

vi.mock("@/lib/permissions/decision-log", () => ({
  recordPermissionDecision: vi.fn(async () => true),
}));

const db = vi.hoisted(() => ({
  calls: [] as { text: string; params: unknown[] }[],
  rows: [] as unknown[],
}));

vi.mock("@/lib/db", () => ({
  async query(text: string, params: unknown[] = []) {
    db.calls.push({ text, params });
    return db.rows;
  },
  async assertSchemaReady() {},
}));

import { GET, PATCH } from "@/app/api/nav-prefs/route";
import type { NavPrefs } from "@/lib/nav-prefs";
import { __resetNavPrefsMemoryForTests } from "@/lib/nav-prefs/store";

const ctx = { params: Promise.resolve({} as Record<string, string>) };
const get = () => GET(new Request("http://mc.test/api/nav-prefs"), ctx);
const patch = (body: unknown) =>
  PATCH(
    new Request("http://mc.test/api/nav-prefs", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    ctx
  );
const signIn = (email: string, oid = `oid-${email}`) => {
  authState.session = { user: { oid, email } };
};
const read = async () => ((await (await get()).json()) as { data: NavPrefs }).data;

beforeEach(() => {
  vi.stubEnv("PLX_MC_DATABASE_URL", "");
  authState.oidc = true;
  authState.status = "active";
  signIn("greg.m@petrasoap.com");
  __resetNavPrefsMemoryForTests();
  db.calls.length = 0;
  db.rows = [];
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET|PATCH /api/nav-prefs", () => {
  it("starts with the switch never used and the tour unseen", async () => {
    expect(await (await get()).json()).toEqual({ data: { zones: null, tourSeen: false } });
  });

  it("turns the switch on, records the tour, switches back, and returns what is stored", async () => {
    const on = await patch({ zones: true });
    expect(on.status).toBe(200);
    expect(await on.json()).toEqual({ data: { zones: true, tourSeen: false } });
    expect(await (await patch({ tourSeen: true })).json()).toEqual({ data: { zones: true, tourSeen: true } });
    expect(await (await patch({ zones: false })).json()).toEqual({ data: { zones: false, tourSeen: true } });
    expect(await read()).toEqual({ zones: false, tourSeen: true });
  });

  it("changes both at once: Switch back from the tour", async () => {
    await patch({ zones: true });
    expect(await (await patch({ zones: false, tourSeen: true })).json()).toEqual({ data: { zones: false, tourSeen: true } });
  });

  it("keeps a field the body leaves out, so two devices changing different ones both land", async () => {
    await patch({ zones: true });
    // The phone closes the tour while the laptop's page still shows it unseen.
    await patch({ tourSeen: true });
    // The laptop switches back: the phone's tour stays seen.
    await patch({ zones: false });
    expect(await read()).toEqual({ zones: false, tourSeen: true });
  });

  it("forgets the switch with null and shows the tour again with false", async () => {
    await patch({ zones: true, tourSeen: true });
    expect(await (await patch({ zones: null, tourSeen: false })).json()).toEqual({ data: { zones: null, tourSeen: false } });
  });

  it("follows the person's Entra object id, not their email, and keeps each person's own", async () => {
    await patch({ zones: true });
    signIn("greg.mitchell@petrasoap.com", "oid-greg.m@petrasoap.com");
    expect(await read()).toEqual({ zones: true, tourSeen: false });
    signIn("ross@petrasoap.com");
    expect(await read()).toEqual({ zones: null, tourSeen: false });
  });

  it("never takes the person from the body", async () => {
    const resp = await patch({ zones: true, person: "ross", personId: "oid-ross@petrasoap.com" });
    expect(resp.status).toBe(400);
    signIn("ross@petrasoap.com");
    expect(await read()).toEqual({ zones: null, tourSeen: false });
  });

  it.each([
    ["an empty change", {}, "give zones, tourSeen or both"],
    ["a switch that is not true, false or null", { zones: "on" }, "zones"],
    ["a tour that is not true or false", { tourSeen: 1 }, "tourSeen"],
    ["an unknown preference", { zones: true, sidebar: "wide" }, "sidebar"],
    ["a list", [{ zones: true }], "expected object"],
  ])("refuses %s with 400 and keeps what is stored", async (_name, body, message) => {
    await patch({ zones: true });
    const resp = await patch(body);
    expect(resp.status).toBe(400);
    const json = (await resp.json()) as { error: { code: string; message: string } };
    expect(json.error.code).toBe("invalid_request");
    expect(json.error.message).toContain(message);
    expect(await read()).toEqual({ zones: true, tourSeen: false });
  });

  it("refuses a body that is not JSON", async () => {
    const resp = await patch("{not json");
    expect(resp.status).toBe(400);
    expect(((await resp.json()) as { error: { code: string } }).error.code).toBe("invalid_json");
  });

  it("refuses a session without an Entra oid, for reads and writes", async () => {
    authState.session = { user: { email: "greg.m@petrasoap.com" } };
    expect((await get()).status).toBe(403);
    expect((await patch({ zones: true })).status).toBe(403);
    authState.session = null;
    expect((await get()).status).toBe(403);
  });

  it("refuses a revoked person under enforcement and writes nothing", async () => {
    vi.stubEnv("PLX_MC_PERMISSIONS_ENFORCEMENT_MODE", "enforce");
    authState.status = "revoked";
    expect((await patch({ zones: true })).status).toBe(403);
    authState.status = "active";
    expect(await read()).toEqual({ zones: null, tourSeen: false });
  });

  it("lets a member under enforcement use the switch: task.read is enough", async () => {
    vi.stubEnv("PLX_MC_PERMISSIONS_ENFORCEMENT_MODE", "enforce");
    expect((await patch({ zones: true })).status).toBe(200);
    expect(await read()).toEqual({ zones: true, tourSeen: false });
  });

  it("uses the operator in dormant local/test mode, which has no session", async () => {
    authState.oidc = false;
    authState.session = null;
    expect((await patch({ zones: true })).status).toBe(200);
    expect(await read()).toEqual({ zones: true, tourSeen: false });
  });
});

describe("the nav_prefs store on Postgres", () => {
  beforeEach(() => {
    vi.stubEnv("PLX_MC_DATABASE_URL", "postgres://mc:synthetic@localhost/test");
  });

  it("reads one row by the session's object id, bound as a parameter", async () => {
    db.rows = [{ zones: true, tour_seen: true }];
    expect(await read()).toEqual({ zones: true, tourSeen: true });
    expect(db.calls).toEqual([
      {
        text: "SELECT zones, tour_seen_at IS NOT NULL AS tour_seen FROM nav_prefs WHERE person_id = $1",
        params: ["oid-greg.m@petrasoap.com"],
      },
    ]);
    db.rows = [];
    expect(await read()).toEqual({ zones: null, tourSeen: false });
  });

  it("changes in one statement that keeps a field the change leaves out", async () => {
    db.rows = [{ zones: true, tour_seen: false }];
    expect(await (await patch({ zones: true })).json()).toEqual({ data: { zones: true, tourSeen: false } });
    const [write] = db.calls;
    expect(write.text).toContain("INSERT INTO nav_prefs AS p (person_id, zones, tour_seen_at)");
    expect(write.text).toContain("ON CONFLICT (person_id) DO UPDATE SET");
    expect(write.text).toContain("zones = CASE WHEN $3::boolean THEN EXCLUDED.zones ELSE p.zones END");
    expect(write.text).toContain("WHEN $4::boolean THEN coalesce(p.tour_seen_at, now())");
    // [person, zones, zones given, tourSeen, tourSeen given]
    expect(write.params).toEqual(["oid-greg.m@petrasoap.com", true, true, false, false]);
  });

  it("binds each change's fields and whether it gives them", async () => {
    db.rows = [{ zones: true, tour_seen: true }];
    await patch({ tourSeen: true });
    await patch({ zones: false, tourSeen: true });
    await patch({ zones: null });
    expect(db.calls.map((c) => c.params)).toEqual([
      ["oid-greg.m@petrasoap.com", null, false, true, true],
      ["oid-greg.m@petrasoap.com", false, true, true, true],
      ["oid-greg.m@petrasoap.com", null, true, false, false],
    ]);
  });

  it("writes nothing for a refused body", async () => {
    await patch({ zones: "on" });
    expect(db.calls).toEqual([]);
  });
});
