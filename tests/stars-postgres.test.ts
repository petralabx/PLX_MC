// Starred (TASK-3842) against real Postgres: every migration on a disposable
// PG16, then the real GET|PATCH /api/stars through the real db pool. Covers the
// person's order across devices, changes from two devices at once all landing,
// racing adds stopping at 6, the nav_stars CHECKs (at most 6 stars, no NULL
// star, no empty person) refusing what the API would never send, and the
// rollback file undoing 049 so the runner can apply it again.
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

import { GET, PATCH } from "@/app/api/stars/route";

class LocalClient extends Client {
  constructor(options: ClientConfig) {
    super({ ...options, ssl: false });
  }
}

const NAME = `plx-mc-stars-pg-${randomBytes(4).toString("hex")}`;
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
  await bootstrap.query("CREATE DATABASE mc_stars");
  await bootstrap.end();
  h.mcUrl = adminUrl.replace(/\/postgres$/, "/mc_stars");
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
async function read(): Promise<string[]> {
  const resp = await GET(new Request("http://localhost/api/stars"), ctx);
  expect(resp.status).toBe(200);
  return ((await resp.json()) as { data: { stars: string[] } }).data.stars;
}
const change = (op: "add" | "remove", key: string) =>
  PATCH(new Request("http://localhost/api/stars", { method: "PATCH", body: JSON.stringify({ op, key }) }), ctx);

describe("Starred on Postgres", () => {
  it("keeps the person's stars in their order, one row per person, by Entra object id", async () => {
    signIn("greg.m@petrasoap.com");
    expect(await read()).toEqual([]);
    const stars = ["screen:goals", "project:PRJ-PORTAL-GOLIVE", "bucket:BKT-NAVIGATION-REDESIGN"];
    for (const key of stars) expect((await change("add", key)).status).toBe(200);
    expect((await change("remove", stars[1])).status).toBe(200);
    expect(await read()).toEqual([stars[0], stars[2]]);
    signIn("ross@petrasoap.com");
    expect(await read()).toEqual([]);
    const rows = await db.query("SELECT person_id, stars FROM nav_stars ORDER BY person_id");
    expect(rows.rows).toEqual([{ person_id: "oid-greg.m@petrasoap.com", stars: [stars[0], stars[2]] }]);
  });

  it("lands every change when two devices star at once", async () => {
    signIn("stephen@petrasoap.com");
    const keys = ["screen:goals", "screen:help", "screen:home", "project:PRJ-A", "bucket:BKT-B"];
    const answers = await Promise.all(keys.map((key) => change("add", key)));
    expect(answers.map((a) => a.status)).toEqual([200, 200, 200, 200, 200]);
    expect((await read()).sort()).toEqual([...keys].sort());
  });

  it("stops racing adds at six, in the API and in the table", async () => {
    signIn("rishi@petrasoap.com");
    const keys = Array.from({ length: 8 }, (_, i) => `project:PRJ-${i}`);
    const answers = await Promise.all(keys.map((key) => change("add", key)));
    expect(answers.filter((a) => a.status === 200)).toHaveLength(6);
    expect(answers.filter((a) => a.status === 409)).toHaveLength(2);
    const stored = await read();
    expect(stored).toHaveLength(6);
    const seven = [...stored, "screen:goals"];
    await expect(db.query("UPDATE nav_stars SET stars = $2 WHERE person_id = $1", ["oid-rishi@petrasoap.com", seven])).rejects.toThrow(
      /nav_stars_stars_check/
    );
    await expect(db.query("INSERT INTO nav_stars (person_id, stars) VALUES ($1, $2)", ["nulls", ["screen:goals", null]])).rejects.toThrow(
      /nav_stars_stars_check/
    );
    await expect(db.query("INSERT INTO nav_stars (person_id) VALUES ('')")).rejects.toThrow(/nav_stars_person_id_check/);
    expect(await read()).toEqual(stored);
  });

  it("rolls 049 back with its rollback file, and the runner applies it again", async () => {
    await db.query(await readFile("db/rollback/049_nav_stars_rollback.sql", "utf8"));
    const gone = await db.query(
      "SELECT to_regclass('public.nav_stars') AS rel, (SELECT count(*)::int FROM schema_migrations WHERE filename = '049_nav_stars.sql') AS ledger"
    );
    expect(gone.rows).toEqual([{ rel: null, ledger: 0 }]);
    expect(await runMigrations()).toBe(0);
    const back = await db.query("SELECT to_regclass('public.nav_stars')::text AS rel, (SELECT count(*)::int FROM nav_stars) AS n");
    expect(back.rows).toEqual([{ rel: "nav_stars", n: 0 }]);
  });
});
