// The navigation switch (TASK-3855) against real Postgres: every migration on
// a disposable PG16, then the real GET|PATCH /api/nav-prefs through the real
// db pool. Covers one row per person by Entra object id, a field a change
// leaves out keeping its value (so two devices changing different preferences
// at once both land), the tour keeping the first time it was closed, the
// nav_prefs CHECK refusing an empty person, and the rollback file undoing 050
// so the runner can apply it again.
// Disposable local PG16 only: no external URLs or credentials are consumed.

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:net";

import { Client, type ClientConfig, type Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { main as migrate } from "../scripts/migrate.mjs";
import { POSTGRES_IMAGE, ensurePostgresImage } from "../scripts/lib/postgres-image.mjs";

const h = vi.hoisted(() => ({
  mcUrl: "",
  session: null as null | { user: { oid: string; email: string } },
}));
vi.mock("@/lib/secrets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/secrets")>()),
  databaseUrl: () => h.mcUrl,
  databaseConfigured: () => true,
}));
vi.mock("@/lib/db/tls", () => ({ resolveDbSsl: () => false }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => h.session), oidcEnabled: () => true }));
vi.mock("@/lib/permissions/decision-log", () => ({ recordPermissionDecision: vi.fn(async () => true) }));

import { GET, PATCH } from "@/app/api/nav-prefs/route";
import type { NavPrefs, NavPrefsChange } from "@/lib/nav-prefs";

class LocalClient extends Client {
  constructor(options: ClientConfig) {
    super({ ...options, ssl: false });
  }
}

const NAME = `plx-mc-nav-prefs-pg-${randomBytes(4).toString("hex")}`;
let started = false;
let db: Client;

async function connect(url: string): Promise<Client> {
  for (let attempt = 0; ; attempt++) {
    const client = new LocalClient({ connectionString: url });
    try {
      await client.connect();
      return client;
    } catch {
      await client.end().catch(() => undefined);
      if (attempt >= 60) throw new Error("local PG16 unavailable");
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

const runMigrations = () =>
  migrate({ env: { NODE_ENV: "test", PLX_MC_DATABASE_URL: h.mcUrl }, ClientClass: LocalClient, log: () => {} });

beforeAll(async () => {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  const password = randomBytes(12).toString("hex");
  expect(ensurePostgresImage()).toMatchObject({ ok: true });
  const run = spawnSync("docker", ["run", "-d", "--name", NAME, "-e", `POSTGRES_PASSWORD=${password}`, "-p", `127.0.0.1:${port}:5432`, POSTGRES_IMAGE], { encoding: "utf8" });
  expect(run.status, run.stderr).toBe(0);
  started = true;
  const adminUrl = `postgres://postgres:${password}@127.0.0.1:${port}/postgres`;
  const bootstrap = await connect(adminUrl);
  await bootstrap.query("CREATE DATABASE mc_nav_prefs");
  await bootstrap.end();
  h.mcUrl = adminUrl.replace(/\/postgres$/, "/mc_nav_prefs");
  expect(await runMigrations()).toBe(0);
  db = await connect(h.mcUrl);
}, 120_000);

afterAll(async () => {
  const pools = globalThis as typeof globalThis & { __plxMcPool?: Pool };
  await pools.__plxMcPool?.end();
  delete pools.__plxMcPool;
  await db?.end();
  if (started) expect(spawnSync("docker", ["rm", "-f", NAME]).status).toBe(0);
});

const ctx = { params: Promise.resolve({} as Record<string, string>) };
const signIn = (email: string) => {
  h.session = { user: { oid: `oid-${email}`, email } };
};
async function read(): Promise<NavPrefs> {
  const resp = await GET(new Request("http://localhost/api/nav-prefs"), ctx);
  expect(resp.status).toBe(200);
  return ((await resp.json()) as { data: NavPrefs }).data;
}
const change = (body: NavPrefsChange) =>
  PATCH(new Request("http://localhost/api/nav-prefs", { method: "PATCH", body: JSON.stringify(body) }), ctx);
const tourSeenAt = async (personId: string) =>
  (await db.query("SELECT tour_seen_at FROM nav_prefs WHERE person_id = $1", [personId])).rows[0]?.tour_seen_at as Date | null;

describe("the navigation switch on Postgres", () => {
  it("keeps the switch and the tour per person, one row each, by Entra object id", async () => {
    signIn("greg.m@petrasoap.com");
    expect(await read()).toEqual({ zones: null, tourSeen: false });
    expect((await change({ zones: true })).status).toBe(200);
    expect(await read()).toEqual({ zones: true, tourSeen: false });
    expect((await change({ tourSeen: true })).status).toBe(200);
    expect((await change({ zones: false })).status).toBe(200);
    expect(await read()).toEqual({ zones: false, tourSeen: true });
    signIn("ross@petrasoap.com");
    expect(await read()).toEqual({ zones: null, tourSeen: false });
    const rows = await db.query("SELECT person_id, zones, tour_seen_at IS NOT NULL AS seen FROM nav_prefs ORDER BY person_id");
    expect(rows.rows).toEqual([{ person_id: "oid-greg.m@petrasoap.com", zones: false, seen: true }]);
  });

  it("lands both when two devices change different preferences at once", async () => {
    signIn("stephen@petrasoap.com");
    await change({ zones: true });
    const answers = await Promise.all([change({ tourSeen: true }), change({ zones: false })]);
    expect(answers.map((a) => a.status)).toEqual([200, 200]);
    expect(await read()).toEqual({ zones: false, tourSeen: true });
  });

  it("keeps the first time the tour was closed, forgets it on false, and the switch on null", async () => {
    signIn("rishi@petrasoap.com");
    await change({ zones: true, tourSeen: true });
    const first = await tourSeenAt("oid-rishi@petrasoap.com");
    expect(first).toBeInstanceOf(Date);
    await change({ tourSeen: true });
    expect(await tourSeenAt("oid-rishi@petrasoap.com")).toEqual(first);
    await change({ zones: null, tourSeen: false });
    expect(await read()).toEqual({ zones: null, tourSeen: false });
    expect(await tourSeenAt("oid-rishi@petrasoap.com")).toBeNull();
    await expect(db.query("INSERT INTO nav_prefs (person_id) VALUES ('')")).rejects.toThrow(/nav_prefs_person_id_check/);
  });

  it("rolls 050 back with its rollback file, and the runner applies it again", async () => {
    await db.query(await readFile("db/rollback/050_nav_prefs_rollback.sql", "utf8"));
    const gone = await db.query(
      "SELECT to_regclass('public.nav_prefs') AS rel, (SELECT count(*)::int FROM schema_migrations WHERE filename = '050_nav_prefs.sql') AS ledger"
    );
    expect(gone.rows).toEqual([{ rel: null, ledger: 0 }]);
    expect(await runMigrations()).toBe(0);
    const back = await db.query("SELECT to_regclass('public.nav_prefs')::text AS rel, (SELECT count(*)::int FROM nav_prefs) AS n");
    expect(back.rows).toEqual([{ rel: "nav_prefs", n: 0 }]);
  });
});
