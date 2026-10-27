// GET|PATCH /api/stars (TASK-3842; v2, TASK-3956): the envelope, one change per
// request (add, remove or move; a new star last, at most STAR_CAP, 409
// stars_full; a move to a place, 0 first), the key
// rules, whose stars they are (the session's Entra object id, never the body;
// the operator in dormant local/test mode), and the store's two paths: the
// memory fallback and the single-statement changes on nav_stars. The writes run
// the real requireSessionActor; only the session, the identity row and the
// decision log are seams (as in tests/vendor-spend-routes.test.ts).
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

import { GET, PATCH } from "@/app/api/stars/route";
import { STAR_CAP } from "@/lib/stars";
import { __resetStarsMemoryForTests } from "@/lib/stars/store";

const ctx = { params: Promise.resolve({} as Record<string, string>) };
const get = () => GET(new Request("http://mc.test/api/stars"), ctx);
const patch = (body: unknown) =>
  PATCH(
    new Request("http://mc.test/api/stars", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    ctx
  );
const add = (key: string) => patch({ op: "add", key });
const remove = (key: string) => patch({ op: "remove", key });
const move = (key: string, to: number) => patch({ op: "move", key, to });
const signIn = (email: string, oid = `oid-${email}`) => {
  authState.session = { user: { oid, email } };
};
const read = async () => ((await (await get()).json()) as { data: { stars: string[] } }).data.stars;

const STARS = ["screen:goals", "project:PRJ-PORTAL-GOLIVE", "bucket:BKT-NAVIGATION-REDESIGN"];

beforeEach(() => {
  vi.stubEnv("PLX_MC_DATABASE_URL", "");
  authState.oidc = true;
  authState.status = "active";
  signIn("greg.m@petrasoap.com");
  __resetStarsMemoryForTests();
  db.calls.length = 0;
  db.rows = [];
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET|PATCH /api/stars", () => {
  it("starts empty, adds each star last, and removes one, returning the stored list", async () => {
    expect(await (await get()).json()).toEqual({ data: { stars: [] } });
    for (const key of STARS) expect((await add(key)).status).toBe(200);
    expect(await read()).toEqual(STARS);
    const resp = await remove(STARS[1]);
    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual({ data: { stars: [STARS[0], STARS[2]] } });
    expect(await read()).toEqual([STARS[0], STARS[2]]);
  });

  it("changes nothing on a second add or a remove of a star not there", async () => {
    await add("screen:goals");
    expect(await (await add("screen:goals")).json()).toEqual({ data: { stars: ["screen:goals"] } });
    expect(await (await remove("screen:home")).json()).toEqual({ data: { stars: ["screen:goals"] } });
  });

  it("keeps a star added on another device: each request is one change, never a whole list", async () => {
    await add("screen:goals");
    // A stale tab still shows [goals]; the phone adds a project meanwhile.
    signIn("greg.m@petrasoap.com", "oid-greg.m@petrasoap.com");
    await add("project:PRJ-PORTAL-GOLIVE");
    // The stale tab now adds Help: the phone's project stays.
    await add("screen:help");
    expect(await read()).toEqual(["screen:goals", "project:PRJ-PORTAL-GOLIVE", "screen:help"]);
  });

  it("keeps 10 and refuses an eleventh with 409 stars_full, keeping the list", async () => {
    expect(STAR_CAP).toBe(10);
    const full = Array.from({ length: STAR_CAP }, (_, i) => `project:PRJ-${i}`);
    for (const key of full) expect((await add(key)).status).toBe(200);
    const resp = await add("screen:goals");
    expect(resp.status).toBe(409);
    expect(await resp.json()).toEqual({
      error: { code: "stars_full", message: "Starred is full. Unstar one to add another." },
    });
    expect(await read()).toEqual(full);
    // A star already there is no new star, and unstarring makes room.
    expect((await add(full[0])).status).toBe(200);
    await remove(full[0]);
    expect((await add("screen:goals")).status).toBe(200);
  });

  it("moves a star to a place, 0 first, and changes nothing for a star not there", async () => {
    for (const key of STARS) await add(key);
    expect(await (await move(STARS[2], 0)).json()).toEqual({ data: { stars: [STARS[2], STARS[0], STARS[1]] } });
    expect(await (await move(STARS[2], 2)).json()).toEqual({ data: { stars: [STARS[0], STARS[1], STARS[2]] } });
    // Past the end means last.
    expect(await (await move(STARS[0], 9)).json()).toEqual({ data: { stars: [STARS[1], STARS[2], STARS[0]] } });
    expect(await (await move("screen:home", 0)).json()).toEqual({ data: { stars: [STARS[1], STARS[2], STARS[0]] } });
  });

  it("follows the person's Entra object id, not their email, and keeps each person's own", async () => {
    await add("screen:goals");
    // The same person after an email change: the same object id.
    signIn("greg.mitchell@petrasoap.com", "oid-greg.m@petrasoap.com");
    expect(await read()).toEqual(["screen:goals"]);
    signIn("ross@petrasoap.com");
    expect(await read()).toEqual([]);
  });

  it("never takes the person from the body", async () => {
    await patch({ op: "add", key: "screen:goals", person: "ross", personId: "oid-ross@petrasoap.com" });
    signIn("ross@petrasoap.com");
    expect(await read()).toEqual([]);
  });

  it.each([
    ["a task", { op: "add", key: "task:TASK-1" }, "not a screen, project or initiative"],
    ["a project id that is not PRJ-*", { op: "add", key: "project:not-an-id" }, "not a screen, project or initiative"],
    ["an initiative id that is not BKT-*", { op: "add", key: "bucket:" }, "not a screen, project or initiative"],
    ["a screen that does not exist", { op: "add", key: "screen:zzz" }, "not a screen, project or initiative"],
    ["a detail screen", { op: "add", key: "screen:project" }, "not a screen, project or initiative"],
    ["List, a view of All work (starred as Board)", { op: "add", key: "screen:list" }, "not a screen, project or initiative"],
    ["Timeline, a view of All work", { op: "add", key: "screen:timeline" }, "not a screen, project or initiative"],
    ["a key over 120 characters", { op: "add", key: `project:PRJ-${"X".repeat(120)}` }, "not a screen, project or initiative"],
    ["an unknown change", { op: "replace", key: "screen:goals" }, "op"],
    ["a whole list", { stars: ["screen:goals"] }, "op"],
    ["no key", { op: "add" }, "key"],
    ["an empty key to remove", { op: "remove", key: "" }, "key"],
    ["a remove over 120 characters", { op: "remove", key: "x".repeat(121) }, "key"],
    ["a move with no place", { op: "move", key: "screen:goals" }, "to"],
    ["a move past the tenth place", { op: "move", key: "screen:goals", to: 10 }, "to"],
    ["a move to a negative place", { op: "move", key: "screen:goals", to: -1 }, "to"],
    ["a move to a fractional place", { op: "move", key: "screen:goals", to: 0.5 }, "to"],
    ["a move with an empty key", { op: "move", key: "", to: 0 }, "key"],
  ])("refuses %s with 400 and keeps the stored list", async (_name, body, message) => {
    await add("screen:goals");
    const resp = await patch(body);
    expect(resp.status).toBe(400);
    const json = (await resp.json()) as { error: { code: string; message: string } };
    expect(json.error.code).toBe("invalid_request");
    expect(json.error.message).toContain(message);
    expect(await read()).toEqual(["screen:goals"]);
  });

  it("removes any stored key, so a star that no longer checks out can still go", async () => {
    expect(await (await remove("screen:gone-screen")).json()).toEqual({ data: { stars: [] } });
    expect((await remove("anything at all")).status).toBe(200);
  });

  it("refuses a body that is not JSON", async () => {
    const resp = await patch("{not json");
    expect(resp.status).toBe(400);
    expect(((await resp.json()) as { error: { code: string } }).error.code).toBe("invalid_json");
  });

  it("refuses a session without an Entra oid, for reads and writes", async () => {
    authState.session = { user: { email: "greg.m@petrasoap.com" } };
    expect((await get()).status).toBe(403);
    expect((await add("screen:goals")).status).toBe(403);
    authState.session = null;
    expect((await get()).status).toBe(403);
  });

  it("refuses a revoked person under enforcement and writes nothing", async () => {
    vi.stubEnv("PLX_MC_PERMISSIONS_ENFORCEMENT_MODE", "enforce");
    authState.status = "revoked";
    expect((await add("screen:goals")).status).toBe(403);
    authState.status = "active";
    expect(await read()).toEqual([]);
  });

  it("lets a member under enforcement keep stars: task.read is enough", async () => {
    vi.stubEnv("PLX_MC_PERMISSIONS_ENFORCEMENT_MODE", "enforce");
    expect((await add("screen:goals")).status).toBe(200);
    expect(await read()).toEqual(["screen:goals"]);
  });

  it("uses the operator in dormant local/test mode, which has no session", async () => {
    authState.oidc = false;
    authState.session = null;
    expect((await add("screen:goals")).status).toBe(200);
    expect(await read()).toEqual(["screen:goals"]);
  });
});

describe("the nav_stars store on Postgres", () => {
  beforeEach(() => {
    vi.stubEnv("PLX_MC_DATABASE_URL", "postgres://mc:synthetic@localhost/test");
  });

  it("reads one row by the session's object id, bound as a parameter", async () => {
    db.rows = [{ stars: STARS }];
    expect(await read()).toEqual(STARS);
    expect(db.calls).toEqual([
      { text: "SELECT stars FROM nav_stars WHERE person_id = $1", params: ["oid-greg.m@petrasoap.com"] },
    ]);
    db.rows = [];
    expect(await read()).toEqual([]);
  });

  it("adds in one statement that appends once and leaves a full list alone", async () => {
    db.rows = [{ stars: STARS }];
    expect(await (await add("screen:goals")).json()).toEqual({ data: { stars: STARS } });
    const [write] = db.calls;
    expect(write.text).toContain("INSERT INTO nav_stars (person_id, stars, updated_at) VALUES ($1, ARRAY[$2::text], now())");
    expect(write.text).toContain("ON CONFLICT (person_id) DO UPDATE");
    expect(write.text).toContain("ELSE array_append(nav_stars.stars, $2::text) END");
    expect(write.text).toContain("WHERE $2::text = ANY (nav_stars.stars) OR cardinality(nav_stars.stars) < $3");
    expect(write.text).not.toContain("screen:goals");
    expect(write.params).toEqual(["oid-greg.m@petrasoap.com", "screen:goals", STAR_CAP]);
  });

  it("answers 409 when the full list leaves no row to return", async () => {
    db.rows = [];
    const resp = await add("screen:goals");
    expect(resp.status).toBe(409);
    expect(((await resp.json()) as { error: { code: string } }).error.code).toBe("stars_full");
  });

  it("removes with array_remove on the person's row", async () => {
    db.rows = [{ stars: ["screen:help"] }];
    expect(await (await remove("screen:goals")).json()).toEqual({ data: { stars: ["screen:help"] } });
    expect(db.calls).toEqual([
      {
        text: "UPDATE nav_stars SET stars = array_remove(stars, $2::text), updated_at = now() WHERE person_id = $1 RETURNING stars",
        params: ["oid-greg.m@petrasoap.com", "screen:goals"],
      },
    ]);
    db.rows = [];
    expect(await (await remove("screen:goals")).json()).toEqual({ data: { stars: [] } });
  });

  it("moves in one statement on the person's row, splicing the key in at place to", async () => {
    db.rows = [{ stars: [STARS[2], STARS[0], STARS[1]] }];
    expect(await (await move(STARS[2], 0)).json()).toEqual({ data: { stars: [STARS[2], STARS[0], STARS[1]] } });
    const [write] = db.calls;
    expect(write.text).toContain(
      "SET stars = (array_remove(stars, $2::text))[1:$3::int] || ARRAY[$2::text] || (array_remove(stars, $2::text))[$3::int + 1:]"
    );
    expect(write.text).toContain("WHERE person_id = $1 AND $2::text = ANY (stars)");
    expect(write.text).not.toContain(STARS[2]);
    expect(write.params).toEqual(["oid-greg.m@petrasoap.com", STARS[2], 0]);
  });

  it("reads the list back when a move finds no row holding the key", async () => {
    db.rows = [];
    expect(await (await move("screen:goals", 0)).json()).toEqual({ data: { stars: [] } });
    expect(db.calls.map((c) => c.text.split("\n")[0].trim())).toEqual([
      "UPDATE nav_stars",
      "SELECT stars FROM nav_stars WHERE person_id = $1",
    ]);
  });

  it("writes nothing for a refused body", async () => {
    await patch({ op: "add", key: "screen:zzz" });
    expect(db.calls).toEqual([]);
  });
});
