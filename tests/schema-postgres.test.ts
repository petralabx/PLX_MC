// Disposable local PG16 only: no external URLs or credentials are consumed.
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { randomBytes } from "node:crypto";
import { mkdtemp, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client, Pool, type ClientConfig } from "pg";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { expectedMigrations } from "../scripts/lib/migration-manifest.mjs";
import { main as deployCheck } from "../scripts/check-deploy-schema.mjs";
import { main as migrate } from "../scripts/migrate.mjs";

const state = vi.hoisted(() => ({ url: "" }));
vi.mock("@/lib/secrets", () => ({ databaseUrl: () => state.url, databaseConfigured: () => true, entraAuthConfigured: () => false }));
vi.mock("@/lib/db/tls", () => ({ resolveDbSsl: () => false }));
vi.mock("@/lib/mcp/auth", () => ({ verifyMcpRequest: vi.fn() }));
vi.mock("@/lib/mcp/audit", () => ({ recordMcpToolCall: vi.fn() }));
import { POST as mcpPost } from "@/app/api/cursor/mcp/route";
import { route } from "@/lib/api/route";
import { cursorRoute } from "@/lib/mcp/route";
import { query, withTransaction } from "@/lib/db";

class LocalClient extends Client {
  constructor(options: ClientConfig) { super({ ...options, ssl: false }); }
}
const name = `plx-mc-schema-pg-${randomBytes(4).toString("hex")}`;
let started = false;
let directory: string;
let adminUrl = "";
let readerUrl = "";
let databaseCreated = false;
let client: Client;
let files: string[];
const logs: string[] = [];
const env = () => ({ NODE_ENV: "test" as const, PLX_MC_SCHEMA_CHECK_DATABASE_URL: readerUrl, PLX_MC_DATABASE_URL: state.url });
const check = () => deployCheck({ env: env(), ClientClass: LocalClient, log: (line: string) => logs.push(line) });

beforeAll(async () => {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  const password = randomBytes(12).toString("hex");
  const run = spawnSync("docker", ["run", "-d", "--name", name, "-e", `POSTGRES_PASSWORD=${password}`, "-p", `127.0.0.1:${port}:5432`, "postgres:16-alpine"], { encoding: "utf8" });
  expect(run.status, run.stderr).toBe(0);
  started = true;
  state.url = `postgres://postgres:${password}@127.0.0.1:${port}/postgres`;
  for (let attempt = 0; ; attempt++) {
    client = new Client({ connectionString: state.url });
    try { await client.connect(); break; } catch {
      await client.end();
      if (attempt >= 60) throw new Error("local PG16 unavailable");
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  adminUrl = state.url;
  await client.query("CREATE DATABASE mc_schema_contract");
  databaseCreated = true;
  await client.end();
  state.url = adminUrl.replace(/\/postgres$/, "/mc_schema_contract");
  client = new Client({ connectionString: state.url });
  await client.connect();
  // All schema DDL goes through the numbered migration runner below.
  files = await expectedMigrations();
  directory = await mkdtemp(path.join(tmpdir(), "mc-schema-"));
  for (const file of files.slice(0, -1)) await copyFile(path.join("db/migrations", file), path.join(directory, file));
  expect(await migrate({ env: { NODE_ENV: "test", PLX_MC_DATABASE_URL: state.url }, ClientClass: LocalClient, migrationsDir: directory, log: () => {} })).toBe(0);
  // Dedicated credential in this disposable DB has only ledger read access.
  await client.query("CREATE ROLE schema_deploy_reader LOGIN PASSWORD 'disposable-test-password'");
  await client.query("GRANT USAGE ON SCHEMA public TO schema_deploy_reader");
  await client.query("GRANT SELECT ON public.schema_migrations TO schema_deploy_reader");
  const reader = new URL(state.url);
  reader.username = "schema_deploy_reader";
  reader.password = "disposable-test-password";
  readerUrl = reader.href;
}, 90_000);

afterAll(async () => {
  const globalDb = globalThis as typeof globalThis & { __plxMcPool?: Pool };
  await globalDb.__plxMcPool?.end();
  delete globalDb.__plxMcPool;
  await client?.end();
  if (databaseCreated) {
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    try { await admin.query("DROP DATABASE mc_schema_contract"); } finally { await admin.end(); }
  }
  if (directory) await rm(directory, { recursive: true, force: true });
  if (started) expect(spawnSync("docker", ["rm", "-f", name]).status).toBe(0);
});

it("blocks deploy and returns explicit API/self-check 503 before handlers against a DB missing latest", async () => {
  const reader = new Client({ connectionString: readerUrl });
  await reader.connect();
  try {
    await expect(reader.query("DELETE FROM schema_migrations WHERE filename = $1", [files.at(-1)])).rejects.toMatchObject({ code: "42501" });
  } finally { await reader.end(); }
  expect(await check()).toBe(1);
  expect(logs.join("\n")).toContain("schema behind: expected 032, db at 031");
  const handler = vi.fn();
  const ctx = { params: Promise.resolve({}) };
  for (const wrapped of [route(handler), cursorRoute("mc_self_check", handler)]) {
    const response = await wrapped(new Request("http://localhost/api/cursor/self-check"), ctx);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: "schema_behind", message: expect.stringContaining("schema behind: expected 032, db at 031"), schema: { missing: [files.at(-1)], ok: false } } });
  }
  const remote = await mcpPost(new Request("http://localhost/api/cursor/mcp", { method: "POST" }));
  expect(remote.status).toBe(503);
  expect(await remote.json()).toMatchObject({ error: { code: "schema_behind" } });
  expect(handler).not.toHaveBeenCalled();
  await expect(withTransaction(async () => { throw new Error("transaction must not start"); })).rejects.toMatchObject({ status: 503 });
  await expect(query("SELECT 1")).rejects.toMatchObject({ status: 503, code: "schema_behind" });
  const ledger = await client.query("SELECT filename FROM schema_migrations");
  expect(ledger.rows).toHaveLength(files.length - 1); // check did not migrate
});

it("accepts equal and ahead DBs and runtime recovers after migration", async () => {
  expect(await migrate({ env: { NODE_ENV: "test", PLX_MC_DATABASE_URL: state.url }, ClientClass: LocalClient, log: () => {} })).toBe(0);
  expect(await check()).toBe(0);
  expect(await query("SELECT 1 AS value")).toEqual([{ value: 1 }]);
  expect(await withTransaction(q => q("SELECT 2 AS value"))).toEqual([{ value: 2 }]);
  const response = await route(async () => ({ ready: true }))(new Request("http://localhost/api/state"), { params: Promise.resolve({}) });
  expect(response.status).toBe(200);
  await client.query("INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING", ["999_future.sql"]);
  expect(await check()).toBe(0);
  const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 31_000);
  try { expect(await query("SELECT 3 AS value")).toEqual([{ value: 3 }]); }
  finally { clock.mockRestore(); }
});
