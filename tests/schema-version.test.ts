import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { compareMigrations, readSchemaVersion } from "../scripts/lib/schema-version.mjs";
import migrationManifest from "../src/lib/db/migration-manifest.json";
import { expectedMigrations } from "../scripts/lib/migration-manifest.mjs";
import { main } from "../scripts/check-deploy-schema.mjs";

const files = ["031_project_status.sql", "032_task_search_indexes.sql"];
const url = "postgres://reader:synthetic@localhost/test";

describe("schema version contract", () => {
  it("blocks a database missing the newest migration with clear versions", () => {
    expect(compareMigrations(files, files.slice(0, -1))).toMatchObject({ ok: false, expectedVersion: "032", appliedVersion: "031", missing: [files[1]] });
  });
  it.each([{ applied: files }, { applied: [...files, "033_future.sql"] }])("accepts an equal or ahead database: %j", ({ applied }) => {
    expect(compareMigrations(files, applied).ok).toBe(true);
  });
  it("rejects a gap even when the DB version is ahead", () => {
    expect(compareMigrations(files, [files[1], "033_future.sql"]).missing).toEqual([files[0]]);
  });
  it("treats an absent ledger as version 000 without creating it", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ ledger: null }] });
    expect(await readSchemaVersion(query, files)).toMatchObject({ ok: false, appliedVersion: "000", missing: files });
    expect(query).toHaveBeenCalledTimes(1);
  });
  it("blocks a Vercel build before Next runs when the check credential is missing", () => {
    const result = spawnSync(process.execPath, ["scripts/check-deploy-schema.mjs", "--build"], { encoding: "utf8", env: { NODE_ENV: "test", PATH: process.env.PATH, VERCEL: "1" } });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("deploy blocked: PLX_MC_SCHEMA_CHECK_DATABASE_URL is required");
  });
  it("fails closed without a read-only credential", async () => {
    expect(await main({ env: { NODE_ENV: "test" }, log: vi.fn() })).toBe(1);
  });
  it.each([undefined, ""])("skips preview without a runtime URL (%j) with one warning and no client", async (runtimeUrl) => {
    const log = vi.fn();
    const connect = vi.fn();
    const ClientClass = vi.fn(function () { return { connect }; });
    expect(await main({ env: { NODE_ENV: "test", VERCEL_ENV: "preview", PLX_MC_SCHEMA_CHECK_DATABASE_URL: url, PLX_MC_DATABASE_URL: runtimeUrl }, ClientClass: ClientClass as never, log })).toBe(0);
    expect(log.mock.calls).toEqual([["WARNING: schema deploy check SKIPPED on Vercel preview: PLX_MC_DATABASE_URL is not set (production stays fail-closed)"]]);
    expect(ClientClass).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toContain(url);
  });
  it.each(["production", "development", undefined])("fails closed without a runtime URL in non-preview Vercel builds (%j)", async (vercelEnv) => {
    expect(await main({ env: { NODE_ENV: "test", VERCEL: "1", VERCEL_ENV: vercelEnv, PLX_MC_SCHEMA_CHECK_DATABASE_URL: url }, log: vi.fn() })).toBe(1);
  });
  it.each(["production", "preview"])("requires the schema-check URL in %s even without a runtime URL", async (vercelEnv) => {
    const log = vi.fn();
    expect(await main({ env: { NODE_ENV: "test", VERCEL_ENV: vercelEnv }, log })).toBe(1);
    expect(log).toHaveBeenCalledExactlyOnceWith("deploy blocked: PLX_MC_SCHEMA_CHECK_DATABASE_URL is required (dedicated read-only target credential)");
  });
  it("runs the full read-only check on preview with a runtime URL", async () => {
    const connect = vi.fn();
    const query = vi.fn(async (sql: string) => ({ rows: sql.includes("to_regclass") ? [{ ledger: "schema_migrations" }] : sql.includes("SELECT filename") ? migrationManifest.map(filename => ({ filename })) : [] }));
    const end = vi.fn();
    class FakeClient { connect = connect; query = query; end = end; }
    const log = vi.fn();
    expect(await main({ env: { NODE_ENV: "test", VERCEL_ENV: "preview", PLX_MC_SCHEMA_CHECK_DATABASE_URL: url, PLX_MC_DATABASE_URL: url }, ClientClass: FakeClient as never, log })).toBe(0);
    expect(connect).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledWith("BEGIN READ ONLY");
    expect(query).toHaveBeenCalledWith("ROLLBACK");
    expect(end).toHaveBeenCalledOnce();
    expect(JSON.stringify(log.mock.calls)).not.toContain("SKIPPED");
  });
  it("refuses a reader credential targeting a different runtime DB", async () => {
    const connect = vi.fn();
    class FakeClient { connect = connect; }
    expect(await main({ env: { NODE_ENV: "test", PLX_MC_SCHEMA_CHECK_DATABASE_URL: url, PLX_MC_DATABASE_URL: url.replace('/test', '/other') }, ClientClass: FakeClient as never, log: vi.fn() })).toBe(1);
    expect(connect).not.toHaveBeenCalled();
  });
  it("fails closed and redacts driver errors", async () => {
    const log = vi.fn();
    class FakeClient {
      async connect() { throw new Error("secret-value"); }
      async query() { return { rows: [] }; }
      async end() {}
    }
    expect(await main({ env: { NODE_ENV: "test", PLX_MC_SCHEMA_CHECK_DATABASE_URL: url, PLX_MC_DATABASE_URL: url }, ClientClass: FakeClient as never, log })).toBe(1);
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret-value");
  });
  it("rejects empty, malformed and duplicate-prefix manifests", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "mc-manifest-"));
    try {
      await expect(expectedMigrations(directory)).rejects.toThrow("empty migration manifest");
      await writeFile(path.join(directory, "bad.sql"), "");
      await expect(expectedMigrations(directory)).rejects.toThrow("invalid migration manifest");
      await rm(path.join(directory, "bad.sql"));
      await writeFile(path.join(directory, "001_one.sql"), "");
      await writeFile(path.join(directory, "001_two.sql"), "");
      await expect(expectedMigrations(directory)).rejects.toThrow("invalid migration manifest");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it("loads the repository migration manifest automatically", async () => {
    expect(await expectedMigrations()).toEqual(migrationManifest);
  });
});
